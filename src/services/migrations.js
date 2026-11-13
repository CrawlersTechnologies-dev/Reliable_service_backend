// Small, idempotent data fixes run at every start-up.
import { Case } from '../models/Case.js';

export async function runMigrations() {
  // Oct 2026: "Document check" became a field verification. Document checks created earlier
  // without an executive were office checks — they are now "Internal check document".
  const res = await Case.updateMany(
    { legs: { $elemMatch: { type: 'DOCUMENT', executive: null } } },
    { $set: { 'legs.$[l].type': 'INTERNAL_DOCUMENT' } },
    { arrayFilters: [{ 'l.type': 'DOCUMENT', 'l.executive': null }] },
  );
  if (res.modifiedCount) console.log(`[migrate] ${res.modifiedCount} office document check(s) → Internal check document`);
}
