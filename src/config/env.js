import 'dotenv/config';
import dns from 'node:dns';
if (process.env.DNS_SERVERS) dns.setServers(process.env.DNS_SERVERS.split(',').map((s) => s.trim()).filter(Boolean));
import path from 'node:path';

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in environment (see .env.example)`);
  return v;
}

const isProd = process.env.NODE_ENV === 'production';

export const env = {
  isProd,
  port: Number(process.env.PORT || 4000),
  mongoUri: required('MONGODB_URI'),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  jwtExecExpiresIn: process.env.JWT_EXEC_EXPIRES_IN || '7d',
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()),
  uploadDir: path.resolve(process.env.UPLOAD_DIR || 'uploads'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 10) * 1024 * 1024,
  demoTools: !isProd && process.env.ENABLE_DEMO_TOOLS === 'true',
};

if (isProd && env.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}
