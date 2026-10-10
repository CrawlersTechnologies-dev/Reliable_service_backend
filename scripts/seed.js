// npm run seed        → creates the first admin from .env (safe to re-run)
// npm run seed:demo   → ALSO wipes banks / OLs / executives / cases / logins and loads demo data
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { User } from '../src/models/User.js';
import { Bank } from '../src/models/Bank.js';
import { Case } from '../src/models/Case.js';
import { Counter } from '../src/models/Counter.js';
import { LoginSession } from '../src/models/LoginSession.js';
import { VERIFICATION_TYPES } from '../src/config/verification.js';
import { deadlineFor } from '../src/utils/caseState.js';
import { buildSeed } from '../src/demo/demoData.js';

const DEMO_PASSWORD = 'Demo@123';
const demo = process.argv.includes('--demo');

async function ensureAdmin() {
  const email = (process.env.ADMIN_EMAIL || '').toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in .env');
  let admin = await User.findOne({ email });
  if (admin) {
    console.log(`Admin already exists: ${email}`);
    return admin;
  }
  admin = new User({
    role: 'ADMIN',
    employeeId: 'ADM-001',
    name: process.env.ADMIN_NAME || 'Admin',
    email,
    mobile: '9900000001',
    designation: 'Supervisor',
    mustChangePassword: false,
  });
  await admin.setPassword(password);
  await admin.save();
  console.log(`Admin created: ${email}`);
  return admin;
}

async function loadDemo(admin) {
  if (env.isProd) throw new Error('Refusing to load demo data with NODE_ENV=production');
  await Promise.all([
    Bank.deleteMany({}),
    User.deleteMany({ role: { $in: ['OL', 'EXECUTIVE'] } }),
    Case.deleteMany({}),
    LoginSession.deleteMany({}),
    Counter.deleteMany({}),
  ]);

  const seed = buildSeed();
  const ids = { u_admin: admin._id };

  for (const b of seed.banks) {
    const { id, createdAt, ...rest } = b;
    ids[id] = (await Bank.create(rest))._id;
  }
  for (const u of seed.users.filter((x) => x.role !== 'ADMIN')) {
    const { id, password, ...rest } = u;
    const doc = new User({ ...rest, doj: rest.doj ? new Date(rest.doj) : undefined, mustChangePassword: false });
    await doc.setPassword(DEMO_PASSWORD);
    await doc.save();
    ids[id] = doc._id;
  }

  for (const c of seed.cases) {
    const legs = c.legs.map(({ id, executiveId, ...l }) => ({
      ...l,
      executive: ids[executiveId],
      photos: (l.photos || [])
        .map((has, slot) => has && { slot, label: VERIFICATION_TYPES[l.type].photos[slot], url: '/uploads/demo/placeholder.svg', takenAt: l.submittedAt })
        .filter(Boolean),
    }));
    const doc = new Case({
      caseNo: c.caseNo,
      bank: ids[c.bankId],
      customerName: c.customerName,
      product: c.product,
      contact: c.contact,
      tatType: c.tatType,
      deadlineAt: deadlineFor(c.createdAt, c.tatType),
      createdBy: { ...c.createdBy, id: ids[c.createdBy.id] },
      legs,
      outcome: c.outcome,
      qaRemarks: c.qaRemarks,
      qaChecks: c.qaChecks,
      outcomeBy: c.outcomeBy ? { ...c.outcomeBy, id: ids[c.outcomeBy.id] } : undefined,
      outcomeAt: c.outcomeAt,
      feedbackToken: c.feedbackToken,
      feedback: c.feedback,
      createdAt: c.createdAt,
    });
    doc.refreshState();
    await doc.save({ timestamps: false });
  }
  // case numbers continue after the demo ones
  const months = {};
  seed.cases.forEach((c) => {
    const [, yymm, n] = c.caseNo.split('-');
    months[yymm] = Math.max(months[yymm] || 0, Number(n));
  });
  for (const [yymm, seq] of Object.entries(months)) await Counter.updateOne({ _id: `case-${yymm}` }, { seq }, { upsert: true });

  await LoginSession.insertMany(seed.logins.map(({ id, executiveId, ...s }) => ({ ...s, executive: ids[executiveId] })));

  console.log(`Demo data loaded: ${seed.banks.length} banks, ${seed.users.length - 1} users, ${seed.cases.length} cases, ${seed.logins.length} logins`);
  console.log(`Demo OL login:        kavya@reliable.in / ${DEMO_PASSWORD}`);
  console.log(`Demo executive login: mahesh@reliable.in / ${DEMO_PASSWORD} (mobile app)`);
}

await mongoose.connect(env.mongoUri);
try {
  const admin = await ensureAdmin();
  if (demo) await loadDemo(admin);
} finally {
  await mongoose.disconnect();
}
