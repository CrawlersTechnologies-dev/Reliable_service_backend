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
import { executiveLegOut } from '../utils/serialize.js';

const r = Router();
const REQUIRED_PHOTOS = 4; // slots 0-3 are mandatory, 4-5 are extras

async function myLeg(req) {
  const c = await Case.findOne({ 'legs._id': req.params.legId });
  const leg = c?.legs.id(req.params.legId);
  if (!leg || String(leg.executive) !== String(req.user._id)) throw notFound('Verification not found.');
  return { c, leg };
}
const point = (body) => ({ lat: body.lat != null ? String(body.lat) : '', lng: body.lng != null ? String(body.lng) : '', at: new Date() });

// GET /api/executive/legs?scope=open|done
// open = assigned / in progress, overdue first (red alert in the app), then nearest deadline.
r.get(
  '/legs',
  ah(async (req, res) => {
    const scope = z.enum(['open', 'done']).default('open').parse(req.query.scope);
    const me = req.user._id;
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const cases = await Case.find(
      scope === 'open'
        ? { legs: { $elemMatch: { executive: me, status: { $ne: 'SUBMITTED' } } } }
        : { legs: { $elemMatch: { executive: me, status: 'SUBMITTED', submittedAt: { $gte: since } } } },
    ).sort({ deadlineAt: 1 });
    const banks = Object.fromEntries((await Bank.find({ _id: { $in: cases.map((c) => c.bank) } })).map((b) => [String(b._id), b.name]));
    const now = Date.now();
    const items = cases.flatMap((c) =>
      c.legs
        .filter((l) => String(l.executive) === String(me) && (scope === 'open' ? l.status !== 'SUBMITTED' : l.status === 'SUBMITTED'))
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
//   photo0 … photo5 = image files (photo0–photo3 required), photoN_lat / photoN_lng optional GPS per photo
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

    let raw;
    try {
      raw = JSON.parse(req.body.findings || '{}');
    } catch {
      throw badRequest('findings must be valid JSON.');
    }
    const { findings, missing } = cleanFindings(t, raw);
    if (missing.length) throw badRequest(`Please fill: ${missing.join(', ')}`, { missing });

    const files = req.files || {};
    const absent = Array.from({ length: REQUIRED_PHOTOS }, (_, i) => i).filter((i) => !files[`photo${i}`]);
    if (absent.length) throw badRequest(`Missing photos: ${absent.map((i) => t.photos[i]).join(', ')}`);

    const now = new Date();
    leg.findings = findings;
    leg.photos = Object.entries(files).map(([field, [f]]) => {
      const slot = Number(field.slice(5));
      return { slot, label: t.photos[slot], url: publicUrl(f, 'photos'), lat: req.body[`${field}_lat`] || '', lng: req.body[`${field}_lng`] || '', takenAt: now };
    });
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

export default r;
