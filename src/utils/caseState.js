// Pure helpers (no DB) — unit-tested in test/caseState.test.js
import { TAT_TYPES } from '../config/verification.js';

const HOUR = 3600 * 1000;

export function tatHours(tatType) {
  return TAT_TYPES[tatType]?.hours ?? 8;
}

export function deadlineFor(createdAt, tatType) {
  return new Date(new Date(createdAt).getTime() + tatHours(tatType) * HOUR);
}

// Case status is derived from its legs + outcome.
// fieldCompletedAt = when the last leg was submitted (TAT clock stops here).
export function deriveCaseState({ legs, outcome }) {
  const allSubmitted = legs.length > 0 && legs.every((l) => l.status === 'SUBMITTED');
  const fieldCompletedAt = allSubmitted
    ? new Date(Math.max(...legs.map((l) => new Date(l.submittedAt).getTime())))
    : null;
  let status;
  if (outcome) status = 'CLOSED';
  else if (allSubmitted) status = 'QA_PENDING';
  else if (legs.some((l) => l.status !== 'ASSIGNED')) status = 'IN_FIELD';
  else status = 'ASSIGNED';
  return { status, fieldCompletedAt };
}

// TAT state for a case (or a single leg when stopAt = leg.submittedAt)
export function tatState({ deadlineAt, stopAt, now = Date.now() }) {
  const ref = stopAt ? new Date(stopAt).getTime() : now;
  const diff = new Date(deadlineAt).getTime() - ref;
  if (stopAt) return diff >= 0 ? 'MET' : 'MISSED';
  return diff >= 0 ? 'IN_TAT' : 'OUT_OF_TAT';
}

// Mongo filter for the panel's tabs.
export function tabFilter(tab, now = new Date()) {
  switch (tab) {
    case 'in-tat':
      return { fieldCompletedAt: null, deadlineAt: { $gte: now } };
    case 'out-of-tat':
      return { fieldCompletedAt: null, deadlineAt: { $lt: now } };
    case 'qa':
      return { status: 'QA_PENDING' };
    case 'closed':
      return { status: 'CLOSED' };
    default:
      return {};
  }
}

// Keep only known questionnaire keys for the verification type, and
// report required fields that are missing (respecting showIf conditions).
export function cleanFindings(typeDef, input = {}) {
  const out = {};
  const missing = [];
  for (const f of typeDef.fields) {
    const raw = input[f.key];
    const visible = !f.showIf || f.showIf({ ...input });
    if (!visible) continue;
    if (raw === undefined || raw === null || raw === '') {
      missing.push(f.label);
      continue;
    }
    if (f.type === 'number') {
      const n = Number(raw);
      if (Number.isNaN(n)) {
        missing.push(`${f.label} (must be a number)`);
        continue;
      }
      out[f.key] = n;
    } else if (f.type === 'select') {
      if (!f.options.includes(raw)) {
        missing.push(`${f.label} (choose one of: ${f.options.join(', ')})`);
        continue;
      }
      out[f.key] = raw;
    } else {
      out[f.key] = String(raw).trim();
    }
  }
  return { findings: out, missing };
}
