// Operational lead attendance — check in / check out from the panel.
//   GET  /api/attendance/today        my record for today (OL)
//   POST /api/attendance/check-in     { note? }  (OL)
//   POST /api/attendance/check-out    (OL)
//   GET  /api/attendance?from=&to=&userId=   admin: everyone · OL: only themselves
import { Router } from 'express';
import { z } from 'zod';
import { Attendance } from '../models/Attendance.js';
import { requireRole } from '../middleware/auth.js';
import { ah, badRequest } from '../middleware/errors.js';
import { today } from './sampling.js';

const r = Router();
const out = (a) =>
  a && {
    id: String(a._id),
    userId: String(a.user),
    name: a.name,
    date: a.date,
    checkIn: a.checkIn?.toISOString() || null,
    checkOut: a.checkOut?.toISOString() || null,
    note: a.note || '',
  };

r.get(
  '/today',
  ah(async (req, res) => res.json({ record: out(await Attendance.findOne({ user: req.user._id, date: today() })) })),
);

r.post(
  '/check-in',
  requireRole('OL'),
  ah(async (req, res) => {
    const { note } = z.object({ note: z.string().trim().max(200).optional().default('') }).parse(req.body || {});
    const date = today();
    if (await Attendance.exists({ user: req.user._id, date })) throw badRequest('You have already checked in today.');
    const a = await Attendance.create({ user: req.user._id, name: req.user.name, date, checkIn: new Date(), note });
    res.status(201).json({ record: out(a) });
  }),
);

r.post(
  '/check-out',
  requireRole('OL'),
  ah(async (req, res) => {
    const a = await Attendance.findOne({ user: req.user._id, date: today() });
    if (!a) throw badRequest('Check in first.');
    if (a.checkOut) throw badRequest('You have already checked out today.');
    a.checkOut = new Date();
    await a.save();
    res.json({ record: out(a) });
  }),
);

r.get(
  '/',
  ah(async (req, res) => {
    const q = z
      .object({ from: z.string().optional(), to: z.string().optional(), userId: z.string().optional() })
      .parse(req.query);
    const filter = {};
    if (req.user.role === 'OL') filter.user = req.user._id;
    else if (q.userId) filter.user = q.userId;
    if (q.from || q.to) filter.date = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) };
    const rows = await Attendance.find(filter).sort({ date: -1 }).limit(2000);
    res.json({ items: rows.map(out) });
  }),
);

export default r;
