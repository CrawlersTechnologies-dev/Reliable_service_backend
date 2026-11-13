import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { Case } from '../models/Case.js';
import { Bank } from '../models/Bank.js';
import { User } from '../models/User.js';
import { nextSeq } from '../models/Counter.js';
import { caseCounterKey, caseDay, formatCaseNo } from '../utils/caseNo.js';
import { actor, requireRole } from '../middleware/auth.js';
import { PurgeLog } from '../models/PurgeLog.js';
import { casesDueWithin, retentionDays } from '../services/retention.js';
import { ah, badRequest, notFound } from '../middleware/errors.js';
import { publicUrl, uploader } from '../middleware/upload.js';
import { env } from '../config/env.js';
import { CUSTOMER_PROFILES, MAX_OTHER_NAMES, OUTCOMES, PAN_RE, PINCODE_RE, QA_PARAMS, SOURCING_CHANNELS, VERIFICATION_TYPES } from '../config/verification.js';
import { cleanFindings, coordsFromLink, deadlineFor, tabFilter } from '../utils/caseState.js';
import { caseOut } from '../utils/serialize.js';
import { sampleFindings } from '../demo/demoData.js';

const r = Router();

const httpsUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => v === '' || /^https:\/\//i.test(v), 'must be an https:// link')
  .optional()
  .default('');
const legBody = z
  .object({
    type: z.enum(Object.keys(VERIFICATION_TYPES)),
    address: z.string().trim().max(500).optional().default(''),
    pincode: z.union([z.string().trim().regex(PINCODE_RE, 'must be a 6-digit PIN code'), z.literal('')]).optional().default(''),
    mapLink: httpsUrl,
    fromPlace: z.string().trim().max(120).optional().default(''),
    toPlace: z.string().trim().max(120).optional().default(''),
    km: z.union([z.number().min(0).max(5000), z.null()]).optional().default(null),
    contact: z.string().trim().max(20).optional().default(''),
    trigger: z.string().trim().max(1000).optional().default(''),
    executiveId: z.string().optional().default(''),
    documentName: z.string().trim().max(80).optional().default(''),
    contactPerson: z.string().trim().max(20).optional().default(''),
    // internal checks (Document check) can be filled in while creating the case
    findings: z.record(z.any()).optional().default({}),
  })
  .superRefine((l, ctx) => {
    const t = VERIFICATION_TYPES[l.type];
    const field = !t.isDocument && !t.internal;
    if (field && !l.address) ctx.addIssue({ code: 'custom', path: ['address'], message: 'Address is required' });
    if (field && !l.pincode) ctx.addIssue({ code: 'custom', path: ['pincode'], message: 'PIN code is required' });
    if (!t.internal && !l.executiveId) ctx.addIssue({ code: 'custom', path: ['executiveId'], message: 'Assign an executive' });
    if (t.isDocument && !l.documentName) ctx.addIssue({ code: 'custom', path: ['documentName'], message: 'Document name is required' });
  });

// Customer + bank details — used when creating a case and when editing its details
const detailsBody = z.object({
  customerName: z.string().trim().min(2).max(120),
  otherNames: z.array(z.string().trim().min(2, 'Each extra name needs at least 2 letters').max(120)).max(MAX_OTHER_NAMES).optional().default([]),
  product: z.string().trim().min(2).max(80),
  contact: z.string().trim().regex(/^\d{10}$/, 'must be a 10-digit number'),
  altContact: z.union([z.string().trim().regex(/^\d{10}$/, 'must be a 10-digit number'), z.literal('')]).optional().default(''),
  coApplicantName: z.string().trim().max(120).optional().default(''),
  coApplicantContact: z.union([z.string().trim().regex(/^\d{10}$/, 'must be a 10-digit number'), z.literal('')]).optional().default(''),
  bankerCaseId: z.string().trim().min(1, 'Banker case ID is required').max(60),
  branchName: z.string().trim().min(2, 'Branch name is required').max(120),
  branchCode: z.string().trim().max(30).optional().default(''),
  loanAmount: z.coerce.number({ invalid_type_error: 'Loan amount must be a number' }).positive('Loan amount must be more than 0').max(1e11),
  dedupeCheck: z.enum(['Yes', 'No'], { errorMap: () => ({ message: 'Choose Yes or No for the dedupe check' }) }),
  pan: z.union([z.string().trim().toUpperCase().regex(PAN_RE, 'PAN must look like ABCDE1234F'), z.literal('')]).optional().default(''),
  profile: z.enum(CUSTOMER_PROFILES, { errorMap: () => ({ message: 'Choose the customer profile' }) }),
  sourcing: z.union([z.enum(SOURCING_CHANNELS), z.literal('')]).optional().default(''),
  sourcingName: z.string().trim().max(120).optional().default(''),
});
const DETAIL_KEYS = Object.keys(detailsBody.shape);

const caseBody = detailsBody.extend({
  bankId: z.string().min(1),
  tatType: z.enum(['LOCAL', 'OGL']),
  legs: z.array(legBody).min(1).max(10),
});

async function loadCase(id) {
  const c = await Case.findById(id);
  if (!c) throw notFound('Case not found.');
  return c;
}
function legOf(c, legId) {
  const leg = c.legs.id(legId);
  if (!leg) throw notFound('Verification not found in this case.');
  return leg;
}
async function activeExecutive(id) {
  const e = await User.findOne({ _id: id, role: 'EXECUTIVE' });
  if (!e) throw badRequest('Selected executive does not exist.');
  if (e.status !== 'Active') throw badRequest(`${e.name} is ${e.status.toLowerCase()} and cannot be assigned.`);
  return e;
}

// GET /api/cases?tab=&bankId=&type=&executiveId=&tatType=&outcome=&from=&to=&q=&limit=
r.get(
  '/',
  ah(async (req, res) => {
    const q = z
      .object({
        tab: z.enum(['all', 'in-tat', 'out-of-tat', 'qa', 'closed']).optional(),
        bankId: z.string().optional(),
        type: z.string().optional(),
        executiveId: z.string().optional(),
        tatType: z.enum(['LOCAL', 'OGL']).optional(),
        outcome: z.string().optional(),
        from: z.string().optional(), // YYYY-MM-DD
        to: z.string().optional(),
        q: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(5000).default(2000),
      })
      .parse(req.query);

    const filter = { ...tabFilter(q.tab) };
    if (q.bankId) filter.bank = q.bankId;
    if (q.type) filter['legs.type'] = q.type;
    if (q.executiveId) filter['legs.executive'] = q.executiveId;
    if (q.tatType) filter.tatType = q.tatType;
    if (q.outcome) filter.outcome = q.outcome;
    if (q.from || q.to) {
      filter.createdAt = {};
      if (q.from) filter.createdAt.$gte = new Date(`${q.from}T00:00:00`);
      if (q.to) filter.createdAt.$lte = new Date(`${q.to}T23:59:59.999`);
    }
    if (q.q) {
      const rx = new RegExp(q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ caseNo: rx }, { customerName: rx }, { otherNames: rx }, { product: rx }, { bankerCaseId: rx }, { pan: rx }, { contact: rx }];
    }
    const cases = await Case.find(filter).sort({ createdAt: -1 }).limit(q.limit);
    res.json({ items: cases.map(caseOut) });
  }),
);

// GET /api/cases/dedupe?mobile=9xxxxxxxxx,9yyyyyyyyy&pan=&excludeId=   (admin + OL)
// Cases of the last 3 months with the same customer mobile (any contact field) or PAN.
r.get(
  '/dedupe',
  ah(async (req, res) => {
    const q = z
      .object({
        mobile: z.string().optional().default(''),
        pan: z.string().optional().default(''),
        excludeId: z.string().optional().default(''),
      })
      .parse(req.query);
    const mobiles = [...new Set(q.mobile.split(',').map((m) => m.replace(/\D/g, '').slice(-10)).filter((m) => m.length === 10))];
    const pan = q.pan.trim().toUpperCase();
    if (!mobiles.length && !PAN_RE.test(pan)) throw badRequest('Enter a 10-digit mobile number or a valid PAN to run the dedupe check.');
    const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
    const or = [];
    if (mobiles.length) {
      const inM = { $in: mobiles };
      or.push({ contact: inM }, { altContact: inM }, { coApplicantContact: inM }, { 'legs.contact': inM });
    }
    if (PAN_RE.test(pan)) or.push({ pan });
    const filter = { createdAt: { $gte: since }, $or: or };
    if (q.excludeId && /^[a-f\d]{24}$/i.test(q.excludeId)) filter._id = { $ne: q.excludeId };
    const found = await Case.find(filter).sort({ createdAt: -1 }).limit(50).populate('bank', 'name code');
    res.json({
      since: since.toISOString(),
      checked: { mobiles, pan: PAN_RE.test(pan) ? pan : '' },
      matches: found.map((c) => ({
        id: String(c._id),
        caseNo: c.caseNo,
        createdAt: c.createdAt.toISOString(),
        customerName: c.customerName,
        bankName: c.bank?.name || '',
        product: c.product,
        contact: c.contact,
        pan: c.pan || '',
        status: c.status,
        outcome: c.outcome || null,
        types: c.legs.map((l) => VERIFICATION_TYPES[l.type]?.label || l.type),
        matchedOn: [
          ...([c.contact, c.altContact, c.coApplicantContact, ...c.legs.map((l) => l.contact)].some((m) => m && mobiles.includes(m)) ? ['Mobile'] : []),
          ...(PAN_RE.test(pan) && c.pan === pan ? ['PAN'] : []),
        ],
      })),
    });
  }),
);

// GET /api/cases/retention?days=7   (admin) — closed cases due for automatic deletion + recent deletions
r.get(
  '/retention',
  requireRole('ADMIN'),
  ah(async (req, res) => {
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }).parse(req.query);
    const [due, log] = await Promise.all([casesDueWithin(days), PurgeLog.find().sort({ deletedAt: -1 }).limit(100).lean()]);
    res.json({
      retentionDays: retentionDays(),
      days,
      due: due.map(caseOut),
      log: log.map((l) => ({ caseNo: l.caseNo, bankName: l.bankName, closedAt: l.closedAt, deletedAt: l.deletedAt, files: l.files })),
    });
  }),
);

// GET /api/cases/:id
r.get(
  '/:id',
  ah(async (req, res) => res.json({ case: caseOut(await loadCase(req.params.id)) })),
);

// POST /api/cases   (admin + OL). Date, case number, deadline and feedback link are set here.
r.post(
  '/',
  ah(async (req, res) => {
    const data = caseBody.parse(req.body);
    const bank = await Bank.findById(data.bankId);
    if (!bank || bank.status !== 'Active') throw badRequest('Choose an active client bank.');
    for (const l of data.legs) if (!VERIFICATION_TYPES[l.type].internal) await activeExecutive(l.executiveId);

    const now = new Date();
    const day = caseDay(now);
    const seq = await nextSeq(caseCounterKey(day));

    const c = await Case.create({
      caseNo: formatCaseNo(day, seq),
      bank: bank._id,
      ...Object.fromEntries(DETAIL_KEYS.map((k) => [k, data[k]])),
      tatType: data.tatType,
      deadlineAt: deadlineFor(now, data.tatType),
      createdBy: actor(req.user),
      legs: data.legs.map(({ executiveId, findings: raw, ...l }) => {
        const t = VERIFICATION_TYPES[l.type];
        const internal = t.internal;
        const c = coordsFromLink(l.mapLink); // lat / lng come from the pasted Maps link
        const leg = {
          ...l,
          executive: internal ? null : executiveId,
          contact: l.contact || data.contact,
          lat: c?.lat || '',
          lng: c?.lng || '',
        };
        // Document check filled in on the New case form → completed right away
        if (internal) {
          const { findings } = cleanFindings(t, raw, { partial: true });
          if (Object.keys(findings).length) {
            leg.findings = findings;
            if (findings.details || findings.documentStatus) {
              Object.assign(leg, { manual: true, completedBy: actor(req.user), status: 'SUBMITTED', startedAt: now, submittedAt: now });
            }
          }
        }
        return leg;
      }),
      feedbackToken: crypto.randomBytes(12).toString('base64url'),
    });
    c.refreshState();
    if (c.isModified()) await c.save();
    res.status(201).json({ case: caseOut(c) });
  }),
);

// PATCH /api/cases/:id/details   (admin + OL) — customer and bank details (also fills them in on older cases)
r.patch(
  '/:id/details',
  ah(async (req, res) => {
    const c = await loadCase(req.params.id);
    const data = detailsBody.parse(req.body);
    DETAIL_KEYS.forEach((k) => (c[k] = data[k]));
    await c.save();
    res.json({ case: caseOut(c) });
  }),
);

// POST /api/cases/:id/legs/:legId/attachments   multipart "files" — document verification uploads
const docUpload = uploader('documents');
r.post(
  '/:id/legs/:legId/attachments',
  docUpload.array('files', 20),
  ah(async (req, res) => {
    const c = await loadCase(req.params.id);
    const leg = legOf(c, req.params.legId);
    if (!req.files?.length) throw badRequest('No files received.');
    leg.attachments.push(...req.files.map((f) => ({ name: f.originalname, type: f.mimetype, size: f.size, url: publicUrl(f, 'documents') })));
    await c.save();
    res.json({ case: caseOut(c) });
  }),
);

// PATCH /api/cases/:id/legs/:legId/assign  { executiveId }
r.patch(
  '/:id/legs/:legId/assign',
  ah(async (req, res) => {
    const { executiveId } = z.object({ executiveId: z.string().min(1) }).parse(req.body);
    const c = await loadCase(req.params.id);
    const leg = legOf(c, req.params.legId);
    if (VERIFICATION_TYPES[leg.type].internal) throw badRequest('This verification is handled internally — it has no executive.');
    if (leg.status === 'SUBMITTED') throw badRequest('This verification is already submitted.');
    const to = await activeExecutive(executiveId);
    if (String(leg.executive) === String(to._id)) return res.json({ case: caseOut(c) });
    const from = leg.executive ? await User.findById(leg.executive, { name: 1, role: 1 }) : null;
    // history is kept for admin / OL; the old executive no longer sees the case and
    // only the current executive is shown on the case, the app and the report
    leg.transfers.push({ from: from ? actor(from) : null, to: actor(to), by: actor(req.user), at: new Date() });
    leg.executive = to._id;
    leg.status = 'ASSIGNED';
    leg.startedAt = null;
    leg.startPoint = undefined;
    c.refreshState();
    await c.save();
    res.json({ case: caseOut(c) });
  }),
);

// PATCH /api/cases/:id/tat-reason  { text }   — why the case crossed its TAT ('' clears it)
r.patch(
  '/:id/tat-reason',
  ah(async (req, res) => {
    const { text } = z.object({ text: z.string().trim().max(1000) }).parse(req.body);
    const c = await loadCase(req.params.id);
    const late = (c.fieldCompletedAt || new Date()) > c.deadlineAt;
    if (!late && text) throw badRequest('This case is still within its TAT.');
    c.tatReason = text ? { text, by: actor(req.user), at: new Date() } : null;
    await c.save();
    res.json({ case: caseOut(c) });
  }),
);

// POST /api/cases/:id/legs/:legId/manual  { findings, remarks }
// Admin / OL fill the details themselves (Bank statement, or any case handled in the office)
// — the verification is marked submitted so the case can be closed with a final status.
r.post(
  '/:id/legs/:legId/manual',
  ah(async (req, res) => {
    const body = z
      .object({ findings: z.record(z.any()).optional().default({}), remarks: z.string().trim().max(4000).optional().default('') })
      .parse(req.body);
    const c = await loadCase(req.params.id);
    const leg = legOf(c, req.params.legId);
    if (leg.status === 'SUBMITTED' && !leg.manual) throw badRequest('The executive has already submitted this verification.');
    const t = VERIFICATION_TYPES[leg.type];
    const { findings, missing } = cleanFindings(t, body.findings, { partial: true });
    if (missing.length) throw badRequest(`Please check: ${missing.join(', ')}`, { missing });
    if (!Object.keys(findings).length && !body.remarks) throw badRequest('Enter the details or remarks before completing.');
    const now = new Date();
    leg.findings = findings;
    leg.manualRemarks = body.remarks;
    leg.manual = true;
    leg.completedBy = actor(req.user);
    leg.status = 'SUBMITTED';
    leg.startedAt = leg.startedAt || now;
    leg.submittedAt = leg.submittedAt || now;
    c.refreshState();
    await c.save();
    res.json({ case: caseOut(c) });
  }),
);

// PATCH /api/cases/:id/holidays  { holidays: [{ date: 'YYYY-MM-DD', note }] }   (admin + OL)
// Each holiday inside the TAT window adds 24 h to the deadline, so the case is counted as within TAT.
r.patch(
  '/:id/holidays',
  ah(async (req, res) => {
    const { holidays } = z
      .object({
        holidays: z
          .array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date'), note: z.string().trim().max(200).optional().default('') }))
          .max(10),
      })
      .parse(req.body);
    const c = await loadCase(req.params.id);
    const unique = [...new Map(holidays.map((h) => [h.date, h])).values()];
    const base = c.originalDeadlineAt || c.deadlineAt;
    c.originalDeadlineAt = unique.length ? base : null;
    c.deadlineAt = new Date(base.getTime() + unique.length * 24 * 3600 * 1000);
    c.holidays = unique.map((h) => ({ ...h, by: actor(req.user), at: new Date() }));
    await c.save();
    res.json({ case: caseOut(c) });
  }),
);

// POST /api/cases/:id/legs/:legId/rework  { reason }   (admin + OL) — send a submitted visit back to the executive
r.post(
  '/:id/legs/:legId/rework',
  ah(async (req, res) => {
    const { reason } = z.object({ reason: z.string().trim().min(5, 'Tell the executive what to redo').max(1000) }).parse(req.body);
    const c = await loadCase(req.params.id);
    const leg = legOf(c, req.params.legId);
    if (c.outcome) throw badRequest('This case is already closed.');
    if (VERIFICATION_TYPES[leg.type].internal || leg.manual) throw badRequest('This verification was handled in the office — edit it instead.');
    if (leg.status !== 'SUBMITTED') throw badRequest('Only a submitted verification can be sent back.');
    leg.rework = { reason, by: actor(req.user), at: new Date(), count: (leg.rework?.count || 0) + 1, resolvedAt: null };
    leg.status = 'IN_PROGRESS';
    leg.submittedAt = null;
    c.refreshState();
    await c.save();
    res.json({ case: caseOut(c) });
  }),
);

// PATCH /api/cases/:id/legs/:legId/details  { findings, nonVisitReason }   (admin + OL)
// Change what the executive submitted before the report goes out (photos stay as taken).
r.patch(
  '/:id/legs/:legId/details',
  ah(async (req, res) => {
    const body = z
      .object({ findings: z.record(z.any()).optional().default({}), nonVisitReason: z.string().trim().max(2000).optional() })
      .parse(req.body);
    const c = await loadCase(req.params.id);
    const leg = legOf(c, req.params.legId);
    if (leg.status !== 'SUBMITTED') throw badRequest('Only submitted details can be edited.');
    // changed answers are merged over what the executive sent; '' clears an answer
    const merged = { ...(leg.findings || {}), ...body.findings };
    const { findings, missing } = cleanFindings(VERIFICATION_TYPES[leg.type], merged, { partial: true });
    if (missing.length) throw badRequest(`Please check: ${missing.join(', ')}`, { missing });
    leg.findings = findings;
    if (body.nonVisitReason !== undefined) leg.nonVisitReason = body.nonVisitReason;
    leg.editedBy = actor(req.user);
    leg.editedAt = new Date();
    c.markModified('legs');
    await c.save();
    res.json({ case: caseOut(c) });
  }),
);

// POST /api/cases/:id/outcome  { outcome, qaRemarks, qaChecks }   (admin + OL)
r.post(
  '/:id/outcome',
  ah(async (req, res) => {
    const qaKeys = QA_PARAMS.map((p) => p.key);
    const data = z
      .object({
        outcome: z.enum(OUTCOMES.map((o) => o.key)),
        qaRemarks: z.string().trim().max(2000).optional().default(''),
        qaChecks: z.record(z.boolean()).optional().default({}),
      })
      .parse(req.body);
    const c = await loadCase(req.params.id);
    if (c.legs.some((l) => l.status !== 'SUBMITTED')) throw badRequest('All verifications must be submitted before closing the case.');
    c.outcome = data.outcome;
    c.qaRemarks = data.qaRemarks;
    c.qaChecks = Object.fromEntries(qaKeys.map((k) => [k, !!data.qaChecks[k]]));
    c.outcomeBy = actor(req.user);
    c.outcomeAt = new Date();
    c.refreshState();
    await c.save();
    res.json({ case: caseOut(c) });
  }),
);

// POST /api/cases/:id/legs/:legId/simulate — DEMO ONLY, stands in for the executive app.
r.post(
  '/:id/legs/:legId/simulate',
  ah(async (req, res) => {
    if (!env.demoTools) throw notFound('Demo tools are disabled.');
    const c = await loadCase(req.params.id);
    const leg = legOf(c, req.params.legId);
    if (VERIFICATION_TYPES[leg.type].internal) throw badRequest('Internal verification — use "Add details" instead.');
    const now = new Date();
    if (leg.status === 'ASSIGNED') {
      leg.status = 'IN_PROGRESS';
      leg.startedAt = now;
    } else if (leg.status === 'IN_PROGRESS') {
      const t = VERIFICATION_TYPES[leg.type];
      leg.status = 'SUBMITTED';
      leg.submittedAt = now;
      leg.findings = sampleFindings(leg.type);
      leg.photos = t.photos.slice(0, 5).map((label, slot) => ({ slot, label, url: '/uploads/demo/placeholder.svg', takenAt: now }));
    }
    c.refreshState();
    await c.save();
    res.json({ case: caseOut(c) });
  }),
);

export default r;
