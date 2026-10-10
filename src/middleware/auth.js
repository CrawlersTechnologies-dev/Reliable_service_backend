import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { ApiError, forbidden } from './errors.js';

export function signToken(user, sessionId) {
  const payload = { sub: String(user._id), role: user.role };
  if (sessionId) payload.sid = String(sessionId);
  return jwt.sign(payload, env.jwtSecret, { expiresIn: user.role === 'EXECUTIVE' ? env.jwtExecExpiresIn : env.jwtExpiresIn });
}

// Verifies the Bearer token and loads the user. Re-checks status on every request,
// so suspending someone locks them out immediately.
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new ApiError(401, 'Please sign in.');
    let payload;
    try {
      payload = jwt.verify(token, env.jwtSecret);
    } catch {
      throw new ApiError(401, 'Your session has expired. Please sign in again.');
    }
    const user = await User.findById(payload.sub);
    if (!user) throw new ApiError(401, 'Account not found.');
    if (user.status !== 'Active') throw new ApiError(401, `This account is ${user.status.toLowerCase()}.`);
    req.user = user;
    req.sessionId = payload.sid || null;
    next();
  } catch (e) {
    next(e);
  }
}

export const requireRole =
  (...roles) =>
  (req, res, next) =>
    roles.includes(req.user?.role) ? next() : next(forbidden());

export const actor = (u) => ({ id: u._id, name: u.name, role: u.role });
