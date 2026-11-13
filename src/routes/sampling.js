// Daily sampling entries (bank-branch login sampling).
//   Panel (admin + OL):  GET /api/sampling   POST /api/sampling   DELETE /api/sampling/:id (admin)
//   Executive app:       POST /api/executive/sampling  (sampler = the signed-in executive)
import fs from 'node:fs';
import { Router } from 'express';
import { z } from 'zod';
import { SamplingEntry } from '../models/SamplingEntry.js';
import { Bank } from '../models/Bank.js';
import { User } from '../models/User.js';
import { actor, requireRole } from '../middleware/auth.js';
import { ah, badRequest, conflict, notFound } from '../middleware/errors.js';
import { publicUrl, uploader } from '../middleware/upload.js';
import { samplingOut } from '../utils/serialize.js';

export const sheetUpload = uploader('sampling', { imagesOnly: true, maxBytes: 5 * 1024 * 1024 }).single('sheet');

const count = (label) => z.coerce.number({ invalid_type_error: `${label} must be a number` }).int(`${label} must be a whole number`).min(0, `${label} cannot be negative`).max(100000);
const entryBody = z
  .object({
    bankId: z.string().min(1, 'Choose the bank'),
    branch: z.string().trim().min(2, 'Enter the branch name').max(120),
    product: z.string().trim().max(80).optional().default(''),
    samplerCategory: z.enum(['Full-time', 'Part-time'], { errorMap: () => ({ message: 'Choose Full-time or Part-time' }) }),
    totalFiles: count('Total files'),
    totalScreened: count('Total screened'),
    totalSampled: count('Total sampled'),
    totalQuery: count('Total query'),
    remarks: z.string().trim().max(500).optional().default(''),
  })
  .superRefine((d, ctx) => {
    if (d.totalScreened > d.totalFiles) ctx.addIssue({ code: 'custom', path: ['totalScreened'], message: 'cannot be more than total files' });
    if (d.totalSampled > d.totalScreened) ctx.addIssue({ code: 'custom', path: ['totalSampled'], message: 'cannot be more than total screened' });
    if (d.totalQuery > d.totalFiles) ctx.addIssue({ code: 'custom', path: ['totalQuery'], message: 'cannot be more than total files' });
  });

// Visit date = today in the server's time zone (TZ=Asia/Kolkata in .env)
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Shared by the panel and the executive app. Removes the uploaded file if anything fails.
export async function createEntry({ body, file, samplerId, by }) {
  try {
    if (!file) throw badRequest('Attach the login sheet image (JPG or PNG, max 5 MB).');
    const data = entryBody.parse(body);
    const [bank, sampler] = await Promise.all([Bank.findById(data.bankId), User.findOne({ _id: samplerId, role: 'EXECUTIVE' })]);
    if (!bank) throw badRequest('Choose a valid bank.');
    if (!sampler) throw badRequest('Choose a valid sampler.');
    if (sampler.status !== 'Active') throw badRequest(`${sampler.name} is ${sampler.status.toLowerCase()}.`);
    const { bankId, ...rest } = data;
    return await SamplingEntry.create({ ...rest, date: today(), bank: bank._id, sampler: sampler._id, sheetUrl: publicUrl(file, 'sampling'), createdBy: by });
  } catch (e) {
    if (file) fs.rm(file.path, { force: true }, () => {});
    if (e?.code === 11000) throw conflict("Today's sampling for this bank branch is already submitted.");
    throw e;
  }
}

const r = Router();

// GET /api/sampling?from=&to=&samplerId=&bankId=   (defaults to the last 31 days)
r.get(
  '/',
  ah(async (req, res) => {
    const q = z.object({ from: z.string().optional(), to: z.string().optional(), samplerId: z.string().optional(), bankId: z.string().optional() }).parse(req.query);
    const since = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const filter = { date: { $gte: q.from || since, ...(q.to ? { $lte: q.to } : {}) } };
    if (q.samplerId) filter.sampler = q.samplerId;
    if (q.bankId) filter.bank = q.bankId;
    const rows = await SamplingEntry.find(filter).sort({ date: -1, createdAt: -1 }).limit(5000);
    res.json({ items: rows.map(samplingOut) });
  }),
);

// POST /api/sampling   multipart: samplerId, bankId, branch, totalFiles, totalScreened, totalSampled, totalQuery, remarks?, sheet (image)
r.post(
  '/',
  sheetUpload,
  ah(async (req, res) => {
    const samplerId = z.string().min(1, 'Choose the sampler').parse(req.body.samplerId);
    const entry = await createEntry({ body: req.body, file: req.file, samplerId, by: actor(req.user) });
    res.status(201).json({ entry: samplingOut(entry) });
  }),
);

// DELETE /api/sampling/:id   (admin) — e.g. an entry submitted by mistake
r.delete(
  '/:id',
  requireRole('ADMIN'),
  ah(async (req, res) => {
    const e = await SamplingEntry.findByIdAndDelete(req.params.id);
    if (!e) throw notFound('Entry not found.');
    res.json({ ok: true });
  }),
);

export default r;
