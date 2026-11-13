import { Router } from 'express';
import { z } from 'zod';
import { User, USER_STATUS } from '../models/User.js';
import { requireRole } from '../middleware/auth.js';
import { ah, badRequest, forbidden, notFound } from '../middleware/errors.js';
import { saveDataUrlImage } from '../middleware/upload.js';
import { tempPassword } from '../utils/password.js';
import { BLOOD_GROUPS, PINCODE_RE } from '../config/verification.js';
import { userOut } from '../utils/serialize.js';

const r = Router();

const mobile = z.string().trim().regex(/^\d{10}$/, 'must be a 10-digit number');
const base = {
  employeeId: z.string().trim().min(2).max(20),
  name: z.string().trim().min(2).max(80),
  mobile,
  email: z.string().trim().email(),
  doj: z.string().trim().min(8), // YYYY-MM-DD
  dob: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date (YYYY-MM-DD)')
    .refine((d) => new Date(d) < new Date(), 'cannot be in the future'),
  pincode: z.string().trim().regex(PINCODE_RE, 'must be a 6-digit PIN code'),
  status: z.enum(USER_STATUS).default('Active'),
  photo: z.string().optional(), // data URL (new photo), existing /uploads URL, or '' to remove
  bloodGroup: z.union([z.enum(BLOOD_GROUPS), z.literal('')]).optional().default(''),
};
const olBody = z.object({
  ...base,
  role: z.literal('OL'),
  // null / '' = not given (checked before the number so they are not read as 0)
  salary: z.union([z.null(), z.literal(''), z.coerce.number().min(0).max(10000000)]).optional().transform((v) => (v === '' ? null : v)),
  relievedOn: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).optional().default(''),
});
const execBody = z.object({
  ...base,
  role: z.literal('EXECUTIVE'),
  altMobile: z.union([mobile, z.literal('')]).optional().default(''),
  address: z.string().trim().min(5),
  location: z.string().trim().min(2),
  companyName: z.string().trim().max(120).optional().default(''),
  reportingManagerId: z.string().optional().default(''),
  execType: z.enum(['FIELD_OFFICER', 'SAMPLER']).optional().default('FIELD_OFFICER'),
});
const createBody = z.discriminatedUnion('role', [olBody, execBody]);

const DESIGNATION = { OL: 'Operations', EXECUTIVE: 'Field Executive' };
const PREFIX = { OL: 'OL', EXECUTIVE: 'FE' };

// Reporting manager must be an operational lead ('' clears it)
async function applyManager(user, managerId) {
  if (managerId === undefined) return;
  if (!managerId) {
    user.reportingManager = null;
    return;
  }
  const m = await User.findOne({ _id: managerId, role: 'OL' });
  if (!m) throw badRequest('Reporting manager must be an operational lead.');
  user.reportingManager = m._id;
}

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
    const users = await User.find({ role }).sort({ employeeId: 1 }).populate('reportingManager', 'name');
    res.json({ items: users.map(userOut) });
  }),
);

// GET /api/users/birthdays?days=7   (admin + OL) — birthdays today and in the next N days, all roles
r.get(
  '/birthdays',
  ah(async (req, res) => {
    const days = z.coerce.number().int().min(0).max(31).default(7).parse(req.query.days);
    const users = await User.find({ dob: { $ne: null }, status: 'Active' }, { name: 1, role: 1, employeeId: 1, dob: 1, photoUrl: 1, designation: 1 });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const items = users
      .map((u) => {
        const d = new Date(u.dob);
        let next = new Date(today.getFullYear(), d.getMonth(), d.getDate());
        if (next < today) next = new Date(today.getFullYear() + 1, d.getMonth(), d.getDate());
        const inDays = Math.round((next - today) / 86400000);
        return { id: String(u._id), name: u.name, role: u.role, employeeId: u.employeeId, designation: u.designation, photo: u.photoUrl || '', inDays, date: next.toISOString().slice(0, 10) };
      })
      .filter((x) => x.inDays <= days)
      .sort((a, b) => a.inDays - b.inDays || a.name.localeCompare(b.name));
    res.json({ items });
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
    const { reportingManagerId, ...rest } = data;
    const user = new User({ ...rest, photo: undefined, designation: data.role === 'EXECUTIVE' && data.execType === 'SAMPLER' ? 'Sampler' : DESIGNATION[data.role], doj: new Date(data.doj), dob: new Date(data.dob), mustChangePassword: data.role !== 'EXECUTIVE' });
    applyPhoto(user, data.photo);
    if (data.role === 'EXECUTIVE') await applyManager(user, reportingManagerId);
    const password = tempPassword();
    await user.setPassword(password);
    await user.save();
    await user.populate('reportingManager', 'name');
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
    const { photo, doj, dob, reportingManagerId, ...rest } = data;
    Object.assign(user, rest);
    if (user.role === 'EXECUTIVE' && data.execType) user.designation = data.execType === 'SAMPLER' ? 'Sampler' : DESIGNATION.EXECUTIVE;
    if (user.role === 'EXECUTIVE') await applyManager(user, reportingManagerId);
    if (doj) user.doj = new Date(doj);
    if (dob) user.dob = new Date(dob);
    applyPhoto(user, photo);
    await user.save();
    await user.populate('reportingManager', 'name');
    res.json({ user: userOut(user) });
  }),
);

// POST /api/users/:id/reset-password  { password? }  (admin) → new password (typed by the admin, or generated)
// Field executives cannot change their own password — only the admin sets it.
r.post(
  '/:id/reset-password',
  requireRole('ADMIN'),
  ah(async (req, res) => {
    const { password: chosen } = z
      .object({ password: z.union([z.string().trim().min(8, 'Password must be at least 8 characters').max(64), z.literal('')]).optional() })
      .parse(req.body || {});
    const user = await User.findById(req.params.id);
    if (!user) throw notFound('User not found.');
    if (user.role === 'ADMIN' && String(user._id) !== String(req.user._id)) throw badRequest('Cannot reset another admin.');
    const password = chosen || tempPassword();
    await user.setPassword(password);
    user.mustChangePassword = user.role !== 'EXECUTIVE';
    await user.save();
    res.json({ tempPassword: password });
  }),
);

export default r;
