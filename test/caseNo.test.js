import test from 'node:test';
import assert from 'node:assert/strict';
import { CASE_NO_RE, caseDay, formatCaseNo } from '../src/utils/caseNo.js';

test('case number is RS-YYMMDD-NNNNN on the IST date', () => {
  assert.equal(caseDay(new Date('2026-10-23T05:00:00Z')), '261023');
  // 20:00 UTC on the 22nd is already the 23rd in India
  assert.equal(caseDay(new Date('2026-10-22T20:00:00Z')), '261023');
  assert.equal(formatCaseNo('261023', 1), 'RS-261023-00001');
  assert.ok(CASE_NO_RE.test(formatCaseNo('261023', 123)));
});
