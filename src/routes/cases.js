import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { Case } from '../models/Case.js';
import { Bank } from '../models/Bank.js';
import { User } from '../models/User.js';
import { nextSeq } from '../models/Counter.js';
import { actor } from '../middleware/auth.js';
import { ah, badRequest, notFound } from '../middleware/errors.js';
import { publicUrl, uploader } from '../middleware/upload.js';
import { env } from '../config/env.js';
import { OUTCOMES, QA_PARAMS, VERIFICATION_TYPES } from '../config/verification.js';
import { deadlineFor, tabFilter } from '../utils/caseState.js';
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
const coord = z.union([z.string(), z.number()]).optional().transform((v) => (v == null ? '' : String(v).trim()));

const legBody = z
  .object({
    type: z.enum(Object.keys(VERIFICATION_TYPES)),
    address: z.string().trim().max(500).optional().default(''),
    mapLink: httpsUrl,
    lat: coord,
    lng: coord,
    fromPlace: z.string().trim().max(120).optional().default(''),
    toPlace: z.string().trim().max(120).optional().default(''),
    km: z.union([z.number().min(0).max(5000), z.null()]).optional().default(null),
    contact: z.string().trim().max(20).optional().default(''),
    trigger: z.string().trim().max(1000).optional().default(''),
    executiveId: z.string().min(1, 'Assign an executive'),
    documentName: z.string().trim().max(80).optional().default(''),
    contactPerson: z.string().trim().max(20).optional().default(''),
  })
  .superRefine((l, ctx) => {
    const t = VERIFICATION_TYPES[l.type];
    if (!t.isDocument && !l.address) ctx.addIssue({ code: 'custom', path: ['address'], message: 'Address is required' });
    if (t.isDocument && !l.documentName) ctx.addIssue({ code: 'custom', path: ['documentName'], message: 'Document name is required' });
  });

const caseBody = z.object({
  bankId: z.string().min(1),
  customerName: z.string().trim().min(2).max(120),
  product: z.string().trim().min(2).max(80),
  contact: z.string().trim().regex(/^\d{10}$/, 'must be a 10-digit number'),
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
      filter.$or = [{ caseNo: rx }, { customerName: rx }, { product: rx }];
    }
    const cases = await Case.find(filter).sort({ createdAt: -1 }).limit(q.limit);
    res.json({ items: cases.map(caseOut) });
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
    for (const l of data.legs) await activeExecutive(l.executiveId);

    const now = new Date();
    const yymm = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const seq = await nextSeq(`case-${yymm}`);

    const c = await Case.create({
      caseNo: `RS-${yymm}-${String(seq).padStart(4, '0')}`,
      bank: bank._id,
      customerName: data.customerName,
      product: data.product,
      contact: data.contact,
      tatType: data.tatType,
      deadlineAt: deadlineFor(now, data.tatType),
      createdBy: actor(req.user),
      legs: data.legs.map(({ executiveId, ...l }) => ({
        ...l,
        executive: executiveId,
        contact: l.contact || data.contact,
        mapLink: l.mapLink || (l.lat && l.lng ? `https://www.google.com/maps/search/?api=1&query=${l.lat},${l.lng}` : ''),
      })),
      feedbackToken: crypto.randomBytes(12).toString('base64url'),
    });
    res.status(201).json({ case: caseOut(c) });
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
    if (leg.status === 'SUBMITTED') throw badRequest('This verification is already submitted.');
    await activeExecutive(executiveId);
    leg.executive = executiveId;
    leg.status = 'ASSIGNED';
    leg.startedAt = null;
    c.refreshState();
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
