// Pure helpers for the case data-retention job (no DB access — unit-tested).
const DAY = 24 * 60 * 60 * 1000;

/** Date a closed case will be deleted, or null (open case / retention off). */
export function deletionDate(c, days) {
  if (!days || c.status !== 'CLOSED' || !c.outcomeAt) return null;
  return new Date(new Date(c.outcomeAt).getTime() + days * DAY);
}

/** Every /uploads/... URL inside the case document (photos, selfies, documents, attachments). */
export function uploadUrlsOf(doc) {
  const out = new Set();
  const walk = (v) => {
    if (typeof v === 'string') {
      if (v.startsWith('/uploads/') && !v.startsWith('/uploads/demo/')) out.add(v.split('?')[0]);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v)) {
      // ObjectIds expose _bsontype — nothing to collect inside them
      if (!v._bsontype) Object.values(v).forEach(walk);
    }
  };
  walk(doc);
  return [...out];
}
