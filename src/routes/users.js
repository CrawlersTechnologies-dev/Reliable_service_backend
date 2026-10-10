import { Router } from 'express';
import { z } from 'zod';
import { User, USER_STATUS } from '../models/User.js';
import { requireRole } from '../middleware/auth.js';
import { ah, badRequest, forbidden, notFound } from '../middleware/errors.js';
import { saveDataUrlImage } from '../middleware/upload.js';
import { tempPassword } from '../utils/password.js';
import { userOut } from '../utils/serialize.js';

const r = Router();

const mobile = z.string().trim().regex(/^\d{10}$/, 'must be a 10-digit number');
const base = {
  employeeId: z.string().trim().min(2).max(20),
  name: z.string().trim().min(2).max(80),
  mobile,
  email: z.string().trim().email(),
  doj: z.string().trim().min(8), // YYYY-MM-DD
  status: z.enum(USER_STATUS).default('Active'),
  photo: z.string().optional(), // data URL (new photo), existing /uploads URL, or '' to remove
};
const olBody = z.object({ ...base, role: z.literal('OL') });
const execBody = z.object({
  ...base,
  role: z.literal('EXECUTIVE'),
  altMobile: z.union([mobile, z.literal('')]).optional().default(''),
  address: z.string().trim().min(5),
  location: z.string().trim().min(2),
});
const createBody = z.discriminatedUnion('role', [olBody, execBody]);

const DESIGNATION = { OL: 'Operations', EXECUTIVE: 'Field Executive' };
const PREFIX = { OL: 'OL', EXECUTIVE: 'FE' };

function applyPhoto(user, photo) {
  if (photo === undefined || photo.startsWith('/uploads/')) return;
  user.photoUrl = photo === '' ? '' : saveDataUrlImage(photo, 'photos');
}

// GET /api/users?role=OL|EXECUTIVE   (admin: both; OL: executives only)
r.get(
  '/',
  ah(async (req, res) => {
    const role = z.enum(['OL', 'EXECUTIVE']).parse(req.query.role);
    if (req.user.role === 'OL' && role !== 'EXECUTIVE') throw forbidden();
    const users = await User.find({ role }).sort({ employeeId: 1 });
    res.json({ items: users.map(userOut) });
  }),
);

// GET /api/users/next-id?role=OL|EXECUTIVE   (admin) — suggested next Employee ID
r.get(
  '/next-id',
  requireRole('ADMIN'),
  ah(async (req, res) => {
    const role = z.enum(['OL', 'EXECUTIVE']).parse(req.query.role);
    const users = await User.find({ role }, { employeeId: 1 });
    const max = Math.max(0, ...users.map((u) => parseInt(u.employeeId.split('-')[1], 10) || 0));
    res.json({ employeeId: `${PREFIX[role]}-${String(max + 1).padStart(3, '0')}` });
  }),
);

// POST /api/users   (admin) → returns a one-time temporary password to hand over
r.post(
  '/',
  requireRole('ADMIN'),
  ah(async (req, res) => {
    const data = createBody.parse(req.body);
    const user = new User({ ...data, photo: undefined, designation: DESIGNATION[data.role], doj: new Date(data.doj), mustChangePassword: true });
    applyPhoto(user, data.photo);
    const password = tempPassword();
    await user.setPassword(password);
    await user.save();
    res.status(201).json({ user: userOut(user), tempPassword: password });
  }),
);

// PATCH /api/users/:id   (admin) — role and designation never change
r.patch(
  '/:id',
  requireRole('ADMIN'),
  ah(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) throw notFound('User not found.');
    if (user.role === 'ADMIN') throw forbidden('Admin accounts cannot be edited here.');
    const schema = (user.role === 'OL' ? olBody : execBody).omit({ role: true, employeeId: true }).partial();
    const data = schema.parse(req.body);
    const { photo, doj, ...rest } = data;
    Object.assign(user, rest);
    if (doj) user.doj = new Date(doj);
    applyPhoto(user, photo);
    await user.save();
    res.json({ user: userOut(user) });
  }),
);

// POST /api/users/:id/reset-password   (admin) → new temporary password
r.post(
  '/:id/reset-password',
  requireRole('ADMIN'),
  ah(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) throw notFound('User not found.');
    if (user.role === 'ADMIN' && String(user._id) !== String(req.user._id)) throw badRequest('Cannot reset another admin.');
    const password = tempPassword();
    await user.setPassword(password);
    user.mustChangePassword = true;
    await user.save();
    res.json({ tempPassword: password });
  }),
);

export default r;
