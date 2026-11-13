import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { requireAuth, requireRole } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import authRoutes from './routes/auth.js';
import bankRoutes from './routes/banks.js';
import userRoutes from './routes/users.js';
import caseRoutes from './routes/cases.js';
import loginRoutes from './routes/logins.js';
import samplingRoutes from './routes/sampling.js';
import executiveRoutes from './routes/executive.js';
import feedbackRoutes from './routes/feedback.js';
import attendanceRoutes from './routes/attendance.js';
import chatRoutes from './routes/chat.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: env.corsOrigin, credentials: false }));
  app.use(express.json({ limit: '3mb' })); // profile photo arrives as a small data URL
  if (!env.isProd) app.use(morgan('dev'));

  // Uploaded files (random, unguessable names)
  fs.mkdirSync(path.join(env.uploadDir, 'demo'), { recursive: true });
  const placeholder = path.join(env.uploadDir, 'demo', 'placeholder.svg');
  if (!fs.existsSync(placeholder)) {
    fs.writeFileSync(
      placeholder,
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#2b2826"/><text x="200" y="158" font-family="Arial" font-size="22" fill="#f2b705" text-anchor="middle">Demo photo</text></svg>',
    );
  }
  app.use('/uploads', express.static(env.uploadDir, { maxAge: '7d', fallthrough: false }));

  app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  // Public
  app.use('/api/auth', authRoutes);
  app.use('/api/public/feedback', feedbackRoutes);

  // Admin + operational lead panel
  const panel = [requireAuth, requireRole('ADMIN', 'OL')];
  app.use('/api/banks', panel, bankRoutes);
  app.use('/api/users', panel, userRoutes);
  app.use('/api/cases', panel, caseRoutes);
  app.use('/api/sampling-logins', panel, loginRoutes); // executive app sessions
  app.use('/api/sampling', panel, samplingRoutes); // daily bank-branch sampling entries
  app.use('/api/attendance', panel, attendanceRoutes); // OL check-in / check-out
  app.use('/api/chat', panel, chatRoutes); // Discussion – Core chat

  // Field executive mobile app
  app.use('/api/executive', requireAuth, requireRole('EXECUTIVE'), executiveRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
