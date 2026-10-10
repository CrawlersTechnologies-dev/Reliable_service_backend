import crypto from 'node:crypto';

// Readable temporary password, e.g. "Rs-7KQ4-M2XP". Avoids look-alike characters.
export function tempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = (n) => Array.from(crypto.randomBytes(n), (b) => chars[b % chars.length]).join('');
  return `Rs-${pick(4)}-${pick(4)}`;
}
