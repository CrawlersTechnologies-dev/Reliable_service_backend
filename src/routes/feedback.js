// Public customer feedback (no login) — opened from the link admin / OL share.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { Case } from '../models/Case.js';
import { Bank } from '../models/Bank.js';
import { User } from '../models/User.js';
import { ah, badRequest, conflict, notFound } from '../middleware/errors.js';

const r = Router();
r.use(rateLimit({ windowMs: 10 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false }));

async function byToken(token) {
  const c = await Case.findOne({ feedbackToken: token });
  if (!c) throw notFound('This feedback link is invalid or has expired.');
  return c;
}

// GET /api/public/feedback/:token — only what the customer needs to see
r.get(
  '/:token',
  ah(async (req, res) => {
    const c = await byToken(req.params.token);
    const [bank, execs] = await Promise.all([
      Bank.findById(c.bank),
      User.find({ _id: { $in: c.legs.map((l) => l.executive) } }, { name: 1 }),
    ]);
    const nameOf = Object.fromEntries(execs.map((e) => [String(e._id), e.name]));
    res.json({
      caseNo: c.caseNo,
      customerName: c.customerName,
      bankName: bank?.name,
      executives: c.legs.map((l) => ({ type: l.type, name: nameOf[String(l.executive)] })),
      alreadySubmitted: !!c.feedback?.submittedAt,
      visitStarted: c.legs.some((l) => l.status !== 'ASSIGNED'),
    });
  }),
);

// POST /api/public/feedback/:token
r.post(
  '/:token',
  ah(async (req, res) => {
    const data = z
      .object({
        rating: z.number().int().min(1).max(5),
        noMoney: z.boolean(),
        noPhotos: z.boolean(),
        noLoanPush: z.boolean(),
        professional: z.boolean(),
        comments: z.string().trim().max(1000).optional().default(''),
        respondentName: z.string().trim().max(80).optional().default(''),
      })
      .parse(req.body);
    const c = await byToken(req.params.token);
    if (c.feedback?.submittedAt) throw conflict('Feedback has already been submitted for this visit.');
    if (!c.legs.some((l) => l.status !== 'ASSIGNED')) throw badRequest('Feedback opens once the executive has visited.');
    c.feedback = { ...data, submittedAt: new Date(), ip: req.ip };
    await c.save();
    res.status(201).json({ ok: true });
  }),
);

export default r;
