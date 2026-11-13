import test from 'node:test';
import assert from 'node:assert/strict';
import { deletionDate, uploadUrlsOf } from '../src/utils/retentionRules.js';

test('collects every uploaded file of a case, skipping demo placeholders', () => {
  const c = {
    legs: [
      { photos: [{ url: '/uploads/visits/a.jpg' }, { url: '/uploads/demo/placeholder.svg' }], selfie: { url: '/uploads/visits/s.jpg' } },
      { attachments: [{ url: '/uploads/docs/p.pdf', name: 'x' }], photos: [{ url: '/uploads/visits/a.jpg' }] },
    ],
    note: 'no file here',
    at: new Date(),
  };
  assert.deepEqual(uploadUrlsOf(c).sort(), ['/uploads/docs/p.pdf', '/uploads/visits/a.jpg', '/uploads/visits/s.jpg']);
});

test('only closed cases get a deletion date, 90 days after closing', () => {
  assert.equal(deletionDate({ status: 'QA_PENDING', outcomeAt: null }, 90), null);
  assert.equal(deletionDate({ status: 'CLOSED', outcomeAt: new Date() }, 0), null);
  const d = deletionDate({ status: 'CLOSED', outcomeAt: new Date('2026-01-01T10:00:00Z') }, 90);
  assert.equal(d.toISOString(), '2026-04-01T10:00:00.000Z');
});
