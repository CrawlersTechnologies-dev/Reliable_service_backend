// Data retention: a CLOSED case is permanently deleted CASE_RETENTION_DAYS (default 90)
// after it was closed — the database record and every photo / document it uploaded.
// Open cases are never touched. Runs at start-up and then every 6 hours; each run is
// idempotent, so running it on more than one server is harmless.
import fs from 'node:fs';
import path from 'node:path';
import { Case } from '../models/Case.js';
import { Bank } from '../models/Bank.js';
import { PurgeLog } from '../models/PurgeLog.js';
import { env } from '../config/env.js';
import { deletionDate, uploadUrlsOf } from '../utils/retentionRules.js';

export { uploadUrlsOf };

const DAY = 24 * 60 * 60 * 1000;
const EVERY = 6 * 60 * 60 * 1000;

export const retentionDays = () => env.caseRetentionDays;

/** Date a closed case will be deleted, or null (open case / retention off). */
export const deleteAtOf = (c) => deletionDate(c, env.caseRetentionDays);

/** Cases closed on or before this date are due. */
const cutoff = (now = new Date()) => new Date(now.getTime() - env.caseRetentionDays * DAY);

function removeUpload(url) {
  const rel = url.replace(/^\/uploads\//, '');
  const file = path.resolve(env.uploadDir, rel);
  if (!file.startsWith(env.uploadDir + path.sep)) return false; // never leave the uploads folder
  try {
    fs.unlinkSync(file);
    return true;
  } catch {
    return false; // already gone
  }
}

/** Deletes every case past its retention date. Returns how many were removed. */
export async function purgeExpiredCases(now = new Date()) {
  if (!env.caseRetentionDays) return 0;
  const due = await Case.find({ status: 'CLOSED', outcomeAt: { $ne: null, $lte: cutoff(now) } }).limit(500).lean();
  if (!due.length) return 0;
  const banks = new Map((await Bank.find({ _id: { $in: [...new Set(due.map((c) => String(c.bank)))] } }).lean()).map((b) => [String(b._id), b.name]));
  let removed = 0;
  for (const c of due) {
    const res = await Case.deleteOne({ _id: c._id, status: 'CLOSED' });
    if (!res.deletedCount) continue;
    const files = uploadUrlsOf(c).filter(removeUpload).length;
    await PurgeLog.create({ caseNo: c.caseNo, bankName: banks.get(String(c.bank)) || '', closedAt: c.outcomeAt, deletedAt: now, files });
    removed++;
  }
  console.log(`[retention] deleted ${removed} case(s) closed before ${cutoff(now).toISOString().slice(0, 10)}`);
  return removed + (due.length === 500 ? await purgeExpiredCases(now) : 0);
}

/** Closed cases that will be deleted within `days` days (for the admin warning). */
export async function casesDueWithin(days = 7, now = new Date()) {
  if (!env.caseRetentionDays) return [];
  const until = new Date(now.getTime() + days * DAY);
  return Case.find({ status: 'CLOSED', outcomeAt: { $ne: null, $lte: cutoff(until) } }).sort({ outcomeAt: 1 }).limit(1000);
}

export function startRetentionJob() {
  if (!env.caseRetentionDays) {
    console.log('[retention] off (CASE_RETENTION_DAYS=0)');
    return () => {};
  }
  console.log(`[retention] closed cases are deleted ${env.caseRetentionDays} days after closing`);
  const run = () => purgeExpiredCases().catch((e) => console.error('[retention] failed:', e.message));
  const first = setTimeout(run, 60 * 1000);
  const timer = setInterval(run, EVERY);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
