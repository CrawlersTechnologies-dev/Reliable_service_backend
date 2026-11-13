import { Router } from 'express';
import { z } from 'zod';
import { Bank } from '../models/Bank.js';
import { requireRole } from '../middleware/auth.js';
import { ah, notFound } from '../middleware/errors.js';
import { bankOut } from '../utils/serialize.js';

const r = Router();

const manager = z.object({
  name: z.string().trim().min(2, 'Manager name is required').max(80),
  designation: z.string().trim().max(60).optional().default(''),
  mobile: z.union([z.string().trim().regex(/^\d{10}$/, 'must be a 10-digit number'), z.literal('')]).optional().default(''),
  email: z.union([z.string().trim().email(), z.literal('')]).optional().default(''),
});

const bankBody = z.object({
  name: z.string().trim().min(2),
  code: z.string().trim().min(2).max(8),
  managers: z.array(manager).max(20).optional().default([]),
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
    // once managers are saved as a list, clear the old single-contact fields
    const update = data.managers ? { ...data, contactPerson: '', contactNumber: '', email: '' } : data;
    const bank = await Bank.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!bank) throw notFound('Bank not found.');
    res.json({ bank: bankOut(bank) });
  }),
);

export default r;
