// End-to-end check against a RUNNING server:  npm run dev  (in one terminal)  then  npm run smoke
// Creates a test bank, executive and case (names start with "Smoke"), walks the whole flow and prints ✓ / ✗.
import 'dotenv/config';

const BASE = process.env.SMOKE_URL || `http://localhost:${process.env.PORT || 4000}`;
const tag = Date.now().toString(36).slice(-5).toUpperCase();
let failures = 0;

async function call(method, path, { token, body, form } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
function check(label, cond, extra = '') {
  console.log(`${cond ? '✓' : '✗'} ${label}${!cond && extra ? `  → ${extra}` : ''}`);
  if (!cond) failures++;
  return cond;
}
const png = () => new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' });

const health = await call('GET', '/api/health');
check('server is up', health.status === 200, `${BASE} not reachable — start it with npm run dev`);
if (health.status !== 200) process.exit(1);

const login = await call('POST', '/api/auth/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
check('admin can sign in to the panel', login.status === 200, JSON.stringify(login.data));
const admin = login.data.token;

check('requests without a token are rejected', (await call('GET', '/api/cases')).status === 401);

const bank = await call('POST', '/api/banks', { token: admin, body: { name: `Smoke Bank ${tag}`, code: `S${tag}`.slice(0, 8) } });
check('admin adds a bank', bank.status === 201, JSON.stringify(bank.data));

const ol = await call('POST', '/api/users', {
  token: admin,
  body: { role: 'OL', employeeId: `SMOL-${tag}`, name: `Smoke OL ${tag}`, mobile: '9000000001', email: `smoke.ol.${tag}@test.in`, doj: '2026-10-01' },
});
check('admin creates an operational lead (temp password returned)', ol.status === 201 && !!ol.data.tempPassword, JSON.stringify(ol.data));

const exec = await call('POST', '/api/users', {
  token: admin,
  body: { role: 'EXECUTIVE', employeeId: `SMFE-${tag}`, name: `Smoke Exec ${tag}`, mobile: '9000000002', email: `smoke.fe.${tag}@test.in`, doj: '2026-10-01', address: 'Test address, Hubballi', location: 'Hubballi' },
});
check('admin creates a field executive', exec.status === 201, JSON.stringify(exec.data));

const olLogin = await call('POST', '/api/auth/login', { body: { email: `smoke.ol.${tag}@test.in`, password: ol.data.tempPassword } });
const olToken = olLogin.data.token;
check('OL signs in with the temp password', olLogin.status === 200);
check('OL cannot add banks', (await call('POST', '/api/banks', { token: olToken, body: { name: 'X bank', code: 'XX' } })).status === 403);
check('OL cannot create users', (await call('POST', '/api/users', { token: olToken, body: {} })).status === 403);

const panelExec = await call('POST', '/api/auth/login', { body: { email: `smoke.fe.${tag}@test.in`, password: exec.data.tempPassword } });
check('executive is blocked from the web panel', panelExec.status === 403);

const created = await call('POST', '/api/cases', {
  token: olToken,
  body: {
    bankId: bank.data.bank.id,
    customerName: `Smoke Customer ${tag}`,
    product: 'Personal Loan',
    contact: '9876543210',
    tatType: 'LOCAL',
    legs: [
      { type: 'RESIDENCE', address: 'No 25, 2nd Cross, Kalaburagi', lat: '17.32', lng: '76.83', fromPlace: 'Office', toPlace: 'Kalaburagi', km: 12, executiveId: exec.data.user.id, trigger: 'Check ownership' },
      { type: 'BUSINESS', address: 'Shop 22, Hubballi', executiveId: exec.data.user.id },
    ],
  },
});
const c = created.data.case;
check('OL creates a combined case (2 locations)', created.status === 201 && c?.legs.length === 2, JSON.stringify(created.data));
check('case number, deadline and feedback link are generated', /^RS-\d{4}-\d{4}$/.test(c?.caseNo) && !!c?.deadlineAt && !!c?.feedbackToken);
check('map link built from lat/lng', c?.legs[0].mapLink.includes('query=17.32,76.83'));
check('javascript: map links are rejected', (await call('POST', '/api/cases', { token: olToken, body: { ...created.data.case, legs: [{ type: 'RESIDENCE', address: 'x', mapLink: 'javascript:alert(1)', executiveId: exec.data.user.id }] } })).status === 400);

const fb0 = await call('POST', `/api/public/feedback/${c.feedbackToken}`, { body: { rating: 5, noMoney: true, noPhotos: true, noLoanPush: true, professional: true } });
check('feedback is refused before any visit', fb0.status === 400);

const appLogin = await call('POST', '/api/auth/login', { body: { email: `smoke.fe.${tag}@test.in`, password: exec.data.tempPassword, app: 'executive', device: 'Smoke test', lat: '15.36', lng: '75.12' } });
const ex = appLogin.data.token;
check('executive signs in to the app (sampling login recorded)', appLogin.status === 200);

const legs = await call('GET', '/api/executive/legs', { token: ex });
check('executive sees both assigned verifications', legs.data.items?.length === 2, JSON.stringify(legs.data).slice(0, 200));
check('executive does not receive the feedback link', !JSON.stringify(legs.data).includes(c.feedbackToken));
check('executive cannot open panel endpoints', (await call('GET', '/api/cases', { token: ex })).status === 403);

for (const [i, leg] of c.legs.entries()) {
  check(`start visit ${i + 1}`, (await call('POST', `/api/executive/legs/${leg.id}/start`, { token: ex, body: { lat: '17.3', lng: '76.8' } })).status === 200);
  const form = new FormData();
  const findings = leg.type === 'RESIDENCE'
    ? { metPerson: 'Basalingamma', relationship: 'Mother', ownership: 'Owned', roofType: 'RCC', yearsInStay: 30, totalFamily: 3, earningMembers: 1, totalEarning: 35000, residenceColour: 'White', residenceSqft: 1200, residenceType: 'Independent House', areaType: 'Residential', livingCondition: 'Middle Class', residenceProof: 'E-Bill', landmark: 'Hanuman Temple', neighbour: 'Shivanand', neighbourFeedback: 'Positive', politicalLink: 'No political background' }
    : { metPerson: 'Gopal', relationship: 'Self', constitution: 'Proprietor', ownership: 'Owned', areaType: 'Commercial', yearsInBusiness: 22, businessSqft: 1000, setup: 'Seen', natureOfBusiness: 'Tea stall', stockSeen: 'Yes', employeesClaimed: 2, employeesSeen: 2, nameBoard: 'Displayed', qrCode: 'Verified and found genuine', businessProof: 'Collected', landmark: 'Near Temple', neighbour: 'Kumar', neighbourFeedback: 'Positive', politicalLink: 'No political background' };
  if (i === 0) {
    const bad = new FormData();
    bad.append('findings', JSON.stringify({ metPerson: 'x' }));
    const badRes = await call('POST', `/api/executive/legs/${leg.id}/submit`, { token: ex, form: bad });
    check('incomplete questionnaire is rejected with the missing fields', badRes.status === 400 && badRes.data.error.includes('Please fill'));
  }
  form.append('findings', JSON.stringify(findings));
  for (let s = 0; s < 4; s++) form.append(`photo${s}`, png(), `p${s}.png`);
  const sub = await call('POST', `/api/executive/legs/${leg.id}/submit`, { token: ex, form });
  check(`submit visit ${i + 1} with findings + 4 photos`, sub.status === 200, JSON.stringify(sub.data));
}

const after = (await call('GET', `/api/cases/${c.id}`, { token: olToken })).data.case;
check('case moves to QA pending after both submissions', after?.status === 'QA_PENDING', after?.status);
check('photo URLs are stored per slot', after?.legs[0].photos.slice(0, 4).every(Boolean));

const fb = await call('POST', `/api/public/feedback/${c.feedbackToken}`, { body: { rating: 4, noMoney: true, noPhotos: true, noLoanPush: true, professional: true, comments: 'Smoke test', respondentName: 'Tester' } });
check('customer submits feedback via the public link', fb.status === 201, JSON.stringify(fb.data));
check('feedback cannot be submitted twice', (await call('POST', `/api/public/feedback/${c.feedbackToken}`, { body: { rating: 4, noMoney: true, noPhotos: true, noLoanPush: true, professional: true } })).status === 409);

const out = await call('POST', `/api/cases/${c.id}/outcome`, { token: olToken, body: { outcome: 'POSITIVE', qaRemarks: 'Verified', qaChecks: { executiveInfo: true, photographs: true } } });
check('OL sets final status Positive → case closed', out.status === 200 && out.data.case.status === 'CLOSED', JSON.stringify(out.data));

const logs = await call('GET', `/api/sampling-logins?executiveId=${exec.data.user.id}`, { token: admin });
check('sampling login shows the session with 2 visits', logs.data.items?.[0]?.visits === 2, JSON.stringify(logs.data));

check('executive logs out (session closed)', (await call('POST', '/api/auth/logout', { token: ex })).status === 200);

const filtered = await call('GET', `/api/cases?bankId=${bank.data.bank.id}&tab=closed`, { token: admin });
check('bank-wise filter returns the closed case', filtered.data.items?.length === 1);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
