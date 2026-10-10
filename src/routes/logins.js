import { Router } from 'express';
import { z } from 'zod';
import { LoginSession } from '../models/LoginSession.js';
import { ah } from '../middleware/errors.js';
import { loginOut } from '../utils/serialize.js';

const r = Router();

// GET /api/sampling-logins?executiveId=&from=YYYY-MM-DD&to=YYYY-MM-DD   (admin + OL)
// Defaults to the last 31 days.
r.get(
  '/',
  ah(async (req, res) => {
    const q = z.object({ executiveId: z.string().optional(), from: z.string().optional(), to: z.string().optional() }).parse(req.query);
    const filter = {};
    if (q.executiveId) filter.executive = q.executiveId;
    filter.loginAt = {
      $gte: q.from ? new Date(`${q.from}T00:00:00`) : new Date(Date.now() - 31 * 24 * 3600 * 1000),
      ...(q.to ? { $lte: new Date(`${q.to}T23:59:59.999`) } : {}),
    };
    const rows = await LoginSession.find(filter).sort({ loginAt: -1 }).limit(5000);
    res.json({ items: rows.map(loginOut) });
  }),
);

export default r;
