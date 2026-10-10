import { Router } from 'express';
import { z } from 'zod';
import { Bank } from '../models/Bank.js';
import { requireRole } from '../middleware/auth.js';
import { ah, notFound } from '../middleware/errors.js';
import { bankOut } from '../utils/serialize.js';

const r = Router();

const bankBody = z.object({
  name: z.string().trim().min(2),
  code: z.string().trim().min(2).max(8),
  contactPerson: z.string().trim().max(80).optional().default(''),
  contactNumber: z.string().trim().max(20).optional().default(''),
  email: z.union([z.string().trim().email(), z.literal('')]).optional().default(''),
  city: z.string().trim().max(60).optional().default(''),
  status: z.enum(['Active', 'Inactive']).optional().default('Active'),
});

// GET /api/banks  (admin + OL)
r.get(
  '/',
  ah(async (req, res) => {
    const banks = await Bank.find().sort({ name: 1 });
    res.json({ items: banks.map(bankOut) });
  }),
);

// POST /api/banks  (admin)
r.post(
  '/',
  requireRole('ADMIN'),
  ah(async (req, res) => {
    const bank = await Bank.create(bankBody.parse(req.body));
    res.status(201).json({ bank: bankOut(bank) });
  }),
);

// PATCH /api/banks/:id  (admin)
r.patch(
  '/:id',
  requireRole('ADMIN'),
  ah(async (req, res) => {
    const data = bankBody.partial().parse(req.body);
    const bank = await Bank.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
    if (!bank) throw notFound('Bank not found.');
    res.json({ bank: bankOut(bank) });
  }),
);

export default r;
