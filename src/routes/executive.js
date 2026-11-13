// Endpoints for the field executive mobile app (built next).
import { Router } from 'express';
import { z } from 'zod';
import { Case } from '../models/Case.js';
import { Bank } from '../models/Bank.js';
import { LoginSession } from '../models/LoginSession.js';
import { ah, badRequest, notFound } from '../middleware/errors.js';
import { publicUrl, uploader } from '../middleware/upload.js';
import { VERIFICATION_TYPES } from '../config/verification.js';
import { cleanFindings, tatState } from '../utils/caseState.js';
import { executiveLegOut, samplingOut } from '../utils/serialize.js';
import { SamplingEntry } from '../models/SamplingEntry.js';
import { createEntry, sheetUpload } from './sampling.js';
import { actor } from '../middleware/auth.js';

const r = Router();
const REQUIRED_PHOTOS = 4; // slots 0-3 are mandatory, 4-5 are extras
export const NOT_TRACED_PHOTOS = 3; // untraceable / refused: 1 location photo required, up to 3

async function myLeg(req) {
  const c = await Case.findOne({ 'legs._id': req.params.legId });
  const leg = c?.legs.id(req.params.legId);
  if (!leg || String(leg.executive) !== String(req.user._id)) throw notFound('Verification not found.');
  return { c, leg };
}
const point = (body) => ({ lat: body.lat != null ? String(body.lat) : '', lng: body.lng != null ? String(body.lng) : '', at: new Date() });

// GET /api/executive/legs?scope=open|rework|done
// open = assigned / in progress, overdue first (red alert in the app), then nearest deadline.
// rework = sent back by Admin / OL to correct.  done = submitted in the last 7 days.
r.get(
  '/legs',
  ah(async (req, res) => {
    const scope = z.enum(['open', 'rework', 'done']).default('open').parse(req.query.scope);
    const me = req.user._id;
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const cases = await Case.find(
      scope === 'done'
        ? { legs: { $elemMatch: { executive: me, status: 'SUBMITTED', submittedAt: { $gte: since } } } }
        : { legs: { $elemMatch: { executive: me, status: { $ne: 'SUBMITTED' } } } },
    ).sort({ deadlineAt: 1 });
    const inRework = (l) => !!l.rework && !l.rework.resolvedAt;
    const wanted = (l) =>
      String(l.executive) === String(me) &&
      (scope === 'done' ? l.status === 'SUBMITTED' : l.status !== 'SUBMITTED' && (scope === 'rework' ? inRework(l) : !inRework(l)));
    const banks = Object.fromEntries((await Bank.find({ _id: { $in: cases.map((c) => c.bank) } })).map((b) => [String(b._id), b.name]));
    const now = Date.now();
    const items = cases.flatMap((c) =>
      c.legs
        .filter(wanted)
        .map((l) => ({
          ...executiveLegOut(c, l, banks[String(c.bank)]),
          tat: tatState({ deadlineAt: c.deadlineAt, stopAt: l.submittedAt, now }),
          overdueMs: Math.max(0, now - c.deadlineAt.getTime()),
        })),
    );
    items.sort((a, b) => b.overdueMs - a.overdueMs || a.deadlineAt.localeCompare(b.deadlineAt));
    res.json({ items, fields: VERIFICATION_TYPES });
  }),
);

// POST /api/executive/legs/:legId/start  { lat, lng }
r.post(
  '/legs/:legId/start',
  ah(async (req, res) => {
    const { c, leg } = await myLeg(req);
    if (leg.status === 'SUBMITTED') throw badRequest('Already submitted.');
    if (leg.status === 'ASSIGNED') {
      leg.status = 'IN_PROGRESS';
      leg.startedAt = new Date();
      leg.startPoint = point(req.body || {});
      c.refreshState();
      await c.save();
    }
    res.json({ ok: true, startedAt: leg.startedAt });
  }),
);

// POST /api/executive/legs/:legId/submit   multipart:
//   findings = JSON string of questionnaire answers, lat, lng,
//   photo0 … photo5 = image files (photo0–photo3 required; not traced: photo0 required, photo1–2 optional), photoN_lat / photoN_lng optional GPS per photo
const photoUpload = uploader('photos', { imagesOnly: true }).fields(
  Array.from({ length: 6 }, (_, i) => ({ name: `photo${i}`, maxCount: 1 })),
);
r.post(
  '/legs/:legId/submit',
  photoUpload,
  ah(async (req, res) => {
    const { c, leg } = await myLeg(req);
    if (leg.status === 'SUBMITTED') throw badRequest('Already submitted.');
    const t = VERIFICATION_TYPES[leg.type];
    const files = req.files || {};
    // Traced → full questionnaire + 4 photos.  Untraceable / Refused → detailed reason + 1 to 3 location photos.
    const result = z.enum(['TRACED', 'UNTRACEABLE', 'REFUSED']).default('TRACED').parse(req.body.result || undefined);

    let findings = {};
    let reason = '';
    if (result === 'TRACED') {
      let raw;
      try {
        raw = JSON.parse(req.body.findings || '{}');
      } catch {
        throw badRequest('findings must be valid JSON.');
      }
      const cleaned = cleanFindings(t, raw);
      if (cleaned.missing.length) throw badRequest(`Please fill: ${cleaned.missing.join(', ')}`, { missing: cleaned.missing });
      findings = cleaned.findings;
      // on a re-work the photos already taken are kept unless a new one is sent for that slot
      const kept = leg.rework && !leg.rework.resolvedAt ? new Set(leg.photos.map((p) => p.slot)) : new Set();
      const absent = Array.from({ length: Math.min(REQUIRED_PHOTOS, t.photos.length) }, (_, i) => i).filter((i) => !files[`photo${i}`] && !kept.has(i));
      if (absent.length) throw badRequest(`Missing photos: ${absent.map((i) => t.photos[i]).join(', ')}`);
    } else {
      reason = String(req.body.reason || '').trim();
      if (reason.length < 20) throw badRequest('Write a detailed reason (at least 20 characters) why the verification could not be done.');
      if (!files.photo0) throw badRequest('Attach at least one photo of the location.');
      // only the location photos count here
      for (const k of Object.keys(files)) if (Number(k.slice(5)) >= NOT_TRACED_PHOTOS) delete files[k];
    }

    const now = new Date();
    leg.findings = findings;
    leg.visitResult = result;
    leg.nonVisitReason = reason;
    const fresh = Object.entries(files).map(([field, [f]]) => {
      const slot = Number(field.slice(5));
      const label = result === 'TRACED' ? t.photos[slot] : `Location photo ${slot + 1}`;
      return { slot, label, url: publicUrl(f, 'photos'), lat: req.body[`${field}_lat`] || '', lng: req.body[`${field}_lng`] || '', takenAt: now };
    });
    const reworking = leg.rework && !leg.rework.resolvedAt && result === 'TRACED';
    const old = reworking ? leg.photos.filter((p) => !fresh.some((n) => n.slot === p.slot)).map((p) => (p.toObject ? p.toObject() : p)) : [];
    leg.photos = [...old, ...fresh].sort((a, b) => a.slot - b.slot);
    if (leg.rework && !leg.rework.resolvedAt) leg.rework.resolvedAt = now;
    leg.status = 'SUBMITTED';
    leg.startedAt = leg.startedAt || now;
    leg.submittedAt = now;
    leg.submitPoint = point(req.body);
    c.refreshState();
    await c.save();
    if (req.sessionId) await LoginSession.updateOne({ _id: req.sessionId }, { $inc: { visits: 1 } });
    res.json({ ok: true, submittedAt: now, caseStatus: c.status });
  }),
);

// POST /api/executive/legs/:legId/attempt  { reason, lat, lng } — customer asked to visit later; the visit stays open
r.post(
  '/legs/:legId/attempt',
  ah(async (req, res) => {
    const { reason } = z.object({ reason: z.string().trim().min(10, 'Write why the visit has to be done later (at least 10 characters).').max(1000) }).parse(req.body);
    const { c, leg } = await myLeg(req);
    if (leg.status === 'SUBMITTED') throw badRequest('Already submitted.');
    const p = point(req.body || {});
    leg.attempts.push({ result: 'REVISIT', reason, at: p.at, lat: p.lat, lng: p.lng });
    if (leg.status === 'ASSIGNED') {
      leg.status = 'IN_PROGRESS';
      leg.startedAt = p.at;
      leg.startPoint = p;
    }
    c.refreshState();
    await c.save();
    res.json({ ok: true, attempts: leg.attempts.length });
  }),
);

// GET /api/executive/banks — active banks (name + code only) for the daily sampling form
r.get(
  '/banks',
  ah(async (req, res) => {
    const banks = await Bank.find({ status: 'Active' }).sort({ name: 1 });
    res.json({ items: banks.map((b) => ({ id: String(b._id), name: b.name, code: b.code })) });
  }),
);

// GET /api/executive/sampling — my entries, last 30 days
r.get(
  '/sampling',
  ah(async (req, res) => {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const rows = await SamplingEntry.find({ sampler: req.user._id, date: { $gte: since } }).sort({ date: -1 });
    res.json({ items: rows.map(samplingOut) });
  }),
);

// POST /api/executive/sampling   multipart: bankId, branch, totalFiles, totalScreened, totalSampled, totalQuery, remarks?, sheet
// The sampler is the signed-in executive; the visit date is set by the server.
r.post(
  '/sampling',
  sheetUpload,
  ah(async (req, res) => {
    const entry = await createEntry({ body: req.body, file: req.file, samplerId: req.user._id, by: actor(req.user) });
    res.status(201).json({ entry: samplingOut(entry) });
  }),
);

export default r;
