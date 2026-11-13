import 'dotenv/config';
import dns from 'node:dns';
import path from 'node:path';

// Some Windows / router DNS setups refuse the SRV lookup that mongodb+srv:// links need
// ("querySrv ECONNREFUSED"). DNS_SERVERS=8.8.8.8,1.1.1.1 makes Node ask public DNS instead.
if (process.env.DNS_SERVERS) dns.setServers(process.env.DNS_SERVERS.split(',').map((s) => s.trim()).filter(Boolean));

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in environment (see .env.example)`);
  return v;
}

const isProd = process.env.NODE_ENV === 'production';

export const env = {
  isProd,
  port: Number(process.env.PORT || 4000),
  mongoUri: process.env.MONGODB_URI || process.env.MONGO_URI || required('MONGODB_URI'),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  jwtExecExpiresIn: process.env.JWT_EXEC_EXPIRES_IN || '7d',
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()),
  uploadDir: path.resolve(process.env.UPLOAD_DIR || 'uploads'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 10) * 1024 * 1024,
  // closed cases (with their photos / documents) are deleted this many days after closing; 0 = never
  caseRetentionDays: Math.max(0, Number(process.env.CASE_RETENTION_DAYS ?? 90)),
  demoTools: !isProd && process.env.ENABLE_DEMO_TOOLS === 'true',
};

if (isProd && env.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}
