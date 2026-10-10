import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { User } from '../models/User.js';
import { LoginSession } from '../models/LoginSession.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { ApiError, ah, badRequest } from '../middleware/errors.js';
import { userOut } from '../utils/serialize.js';

const r = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many sign-in attempts. Try again in a few minutes.' } });

const loginBody = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
  app: z.enum(['panel', 'executive']).default('panel'),
  // executive app only — recorded in sampling logins
  device: z.string().max(120).optional(),
  lat: z.union([z.string(), z.number()]).optional(),
  lng: z.union([z.string(), z.number()]).optional(),
  location: z.string().max(120).optional(),
});

// POST /api/auth/login
r.post(
  '/login',
  loginLimiter,
  ah(async (req, res) => {
    const body = loginBody.parse(req.body);
    const user = await User.findOne({ email: body.email.toLowerCase() }).select('+passwordHash');
    if (!user || !(await user.checkPassword(body.password))) throw new ApiError(401, 'Email or password is incorrect.');
    if (user.status !== 'Active') throw new ApiError(403, `This account is ${user.status.toLowerCase()}. Contact the admin.`);

    const panel = body.app === 'panel';
    if (panel && user.role === 'EXECUTIVE') throw new ApiError(403, 'Field executives sign in through the mobile app.');
    if (!panel && user.role !== 'EXECUTIVE') throw new ApiError(403, 'The mobile app is for field executives. Use the web panel.');

    let sessionId = null;
    if (!panel) {
      // close any session left open (app killed, phone switched off…)
      await LoginSession.updateMany({ executive: user._id, logoutAt: null }, { logoutAt: new Date() });
      const s = await LoginSession.create({
        executive: user._id,
        device: body.device || '',
        lat: body.lat != null ? String(body.lat) : '',
        lng: body.lng != null ? String(body.lng) : '',
        location: body.location || user.location || '',
      });
      sessionId = s._id;
    }
    user.lastLoginAt = new Date();
    await user.save();
    res.json({ token: signToken(user, sessionId), user: userOut(user) });
  }),
);

// GET /api/auth/me
r.get('/me', requireAuth, (req, res) => res.json({ user: userOut(req.user) }));

// POST /api/auth/logout — closes the executive's sampling-login session
r.post(
  '/logout',
  requireAuth,
  ah(async (req, res) => {
    if (req.sessionId) await LoginSession.updateOne({ _id: req.sessionId, logoutAt: null }, { logoutAt: new Date() });
    res.json({ ok: true });
  }),
);

// POST /api/auth/change-password
r.post(
  '/change-password',
  requireAuth,
  ah(async (req, res) => {
    const { currentPassword, newPassword } = z
      .object({ currentPassword: z.string().min(1), newPassword: z.string().min(8, 'New password must be at least 8 characters') })
      .parse(req.body);
    const user = await User.findById(req.user._id).select('+passwordHash');
    if (!(await user.checkPassword(currentPassword))) throw badRequest('Current password is incorrect.');
    await user.setPassword(newPassword);
    user.mustChangePassword = false;
    await user.save();
    res.json({ ok: true });
  }),
);

export default r;
