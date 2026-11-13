import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanFindings, deadlineFor, deriveCaseState, tabFilter, tatState } from '../src/utils/caseState.js';
import { VERIFICATION_TYPES } from '../src/config/verification.js';

const H = 3600 * 1000;

test('deadline: Local = 8h, OGL = 24h', () => {
  const t0 = new Date('2026-10-09T04:00:00Z');
  assert.equal(deadlineFor(t0, 'LOCAL').toISOString(), '2026-10-09T12:00:00.000Z');
  assert.equal(deadlineFor(t0, 'OGL').toISOString(), '2026-10-10T04:00:00.000Z');
});

test('case status follows its legs and outcome', () => {
  const a = { status: 'ASSIGNED' };
  const p = { status: 'IN_PROGRESS' };
  const s1 = { status: 'SUBMITTED', submittedAt: '2026-10-09T05:00:00Z' };
  const s2 = { status: 'SUBMITTED', submittedAt: '2026-10-09T07:00:00Z' };
  assert.equal(deriveCaseState({ legs: [a, a] }).status, 'ASSIGNED');
  assert.equal(deriveCaseState({ legs: [a, p] }).status, 'IN_FIELD');
  assert.equal(deriveCaseState({ legs: [s1, p] }).status, 'IN_FIELD');
  const qa = deriveCaseState({ legs: [s1, s2] });
  assert.equal(qa.status, 'QA_PENDING');
  assert.equal(qa.fieldCompletedAt.toISOString(), '2026-10-09T07:00:00.000Z'); // last submission stops the clock
  assert.equal(deriveCaseState({ legs: [s1, s2], outcome: 'NEGATIVE' }).status, 'CLOSED');
});

test('TAT state: running vs overdue vs met vs missed', () => {
  const now = Date.parse('2026-10-09T10:00:00Z');
  assert.equal(tatState({ deadlineAt: new Date(now + H), now }), 'IN_TAT');
  assert.equal(tatState({ deadlineAt: new Date(now - H), now }), 'OUT_OF_TAT');
  assert.equal(tatState({ deadlineAt: new Date(now), stopAt: new Date(now - H) }), 'MET');
  assert.equal(tatState({ deadlineAt: new Date(now), stopAt: new Date(now + H) }), 'MISSED');
});

test('tab filters map to Mongo queries', () => {
  const now = new Date();
  assert.deepEqual(tabFilter('out-of-tat', now), { fieldCompletedAt: null, deadlineAt: { $lt: now } });
  assert.deepEqual(tabFilter('closed'), { status: 'CLOSED' });
  assert.deepEqual(tabFilter('all'), {});
});

test('findings: unknown keys dropped, numbers coerced, options checked, showIf respected', () => {
  const t = VERIFICATION_TYPES.RESIDENCE;
  const full = Object.fromEntries(t.fields.map((f) => [f.key, f.type === 'select' ? f.options[0] : f.type === 'number' ? '5' : 'x']));
  full.ownership = 'Owned';
  delete full.rentAmount; // hidden when Owned
  const { findings, missing } = cleanFindings(t, { ...full, hacker: 'drop me' });
  assert.deepEqual(missing, []);
  assert.equal(findings.hacker, undefined);
  assert.equal(findings.yearsInStay, 5);

  const rented = cleanFindings(t, { ...full, ownership: 'Rent' });
  assert.ok(rented.missing.some((m) => m.startsWith('Rent / lease amount')));

  const badOption = cleanFindings(t, { ...full, roofType: 'Glass' });
  assert.ok(badOption.missing.some((m) => m.startsWith('Type of roof')));
});

test('demo findings for every type pass the same validation the app submit uses', async () => {
  const { sampleFindings } = await import('../src/demo/demoData.js');
  for (const [key, t] of Object.entries(VERIFICATION_TYPES)) {
    const { missing } = cleanFindings(t, sampleFindings(key));
    assert.deepEqual(missing, [], `${key}: ${missing.join(', ')}`);
  }
});

test('manual entry (partial) allows blanks but still rejects wrong values', async () => {
  const t = VERIFICATION_TYPES.BANK_STATEMENT;
  const ok = cleanFindings(t, { statementBank: 'Canara Bank', averageBalance: '84000' }, { partial: true });
  assert.deepEqual(ok.missing, []);
  assert.equal(ok.findings.averageBalance, 84000);
  const bad = cleanFindings(t, { statementStatus: 'Maybe' }, { partial: true });
  assert.ok(bad.missing[0].startsWith('Statement'));
});

test('coordinates come from a pasted Google Maps link', async () => {
  const { coordsFromLink } = await import('../src/utils/caseState.js');
  assert.deepEqual(coordsFromLink('https://www.google.com/maps/search/?api=1&query=14.62108,76.70148'), { lat: '14.62108', lng: '76.70148' });
  assert.deepEqual(coordsFromLink('https://www.google.com/maps/place/X/@15.3647,75.124,17z'), { lat: '15.3647', lng: '75.124' });
  assert.equal(coordsFromLink('https://maps.app.goo.gl/abc'), null);
});
