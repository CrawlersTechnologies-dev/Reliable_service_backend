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

const bank = await call('POST', '/api/banks', { token: admin, body: { name: `Smoke Bank ${tag}`, code: `S${tag}`.slice(0, 8), managers: [{ name: 'Manager One', mobile: '9000000011' }, { name: 'Manager Two', designation: 'RCU' }] } });
check('admin adds a bank with 2 managers', bank.status === 201 && bank.data.bank.managers.length === 2, JSON.stringify(bank.data));

const ol = await call('POST', '/api/users', {
  token: admin,
  body: { role: 'OL', employeeId: `SMOL-${tag}`, name: `Smoke OL ${tag}`, mobile: '9000000001', email: `smoke.ol.${tag}@test.in`, doj: '2026-10-01', dob: '1995-06-15', pincode: '580020' },
});
check('admin creates an operational lead (temp password returned)', ol.status === 201 && !!ol.data.tempPassword, JSON.stringify(ol.data));

const exec = await call('POST', '/api/users', {
  token: admin,
  body: { role: 'EXECUTIVE', employeeId: `SMFE-${tag}`, name: `Smoke Exec ${tag}`, mobile: '9000000002', email: `smoke.fe.${tag}@test.in`, doj: '2026-10-01', dob: '1996-03-02', pincode: '585101', address: 'Test address, Hubballi', location: 'Hubballi' },
});
check('admin creates a field executive', exec.status === 201, JSON.stringify(exec.data));

const olLogin = await call('POST', '/api/auth/login', { body: { email: `smoke.ol.${tag}@test.in`, password: ol.data.tempPassword } });
const olToken = olLogin.data.token;
check('OL signs in with the temp password', olLogin.status === 200);
check('OL cannot add banks', (await call('POST', '/api/banks', { token: olToken, body: { name: 'X bank', code: 'XX' } })).status === 403);
check('OL cannot create users', (await call('POST', '/api/users', { token: olToken, body: {} })).status === 403);

const panelExec = await call('POST', '/api/auth/login', { body: { email: `smoke.fe.${tag}@test.in`, password: exec.data.tempPassword } });
check('executive is blocked from the web panel', panelExec.status === 403);

// extra bank details required on every case
const DETAILS = { bankerCaseId: `SMK/${tag}`, branchName: 'Smoke Branch', branchCode: 'SMK001', loanAmount: 2500000, dedupeCheck: 'No', pan: 'abcde1234f', profile: 'Salaried', sourcing: 'DSA', sourcingName: 'Smoke DSA', otherNames: ['Smoke Guarantor'] };
check('case without banker details is refused', (await call('POST', '/api/cases', { token: olToken, body: { bankId: bank.data.bank.id, customerName: 'No Details', product: 'Home Loan', contact: '9876543210', tatType: 'LOCAL', legs: [{ type: 'RESIDENCE', address: 'x', pincode: '580021', executiveId: exec.data.user.id }] } })).status === 400);

const created = await call('POST', '/api/cases', {
  token: olToken,
  body: {
    ...DETAILS,
    bankId: bank.data.bank.id,
    customerName: `Smoke Customer ${tag}`,
    product: 'Personal Loan',
    contact: '9876543210',
    coApplicantName: 'Smoke Co-applicant',
    tatType: 'LOCAL',
    legs: [
      { type: 'RESIDENCE', address: 'No 25, 2nd Cross, Kalaburagi', pincode: '585101', mapLink: 'https://www.google.com/maps/search/?api=1&query=17.32,76.83', fromPlace: 'Office', toPlace: 'Kalaburagi', km: 12, executiveId: exec.data.user.id, trigger: 'Check ownership' },
      { type: 'BUSINESS', address: 'Shop 22, Hubballi', pincode: '580021', executiveId: exec.data.user.id },
    ],
  },
});
const c = created.data.case;
check('OL creates a combined case (2 locations)', created.status === 201 && c?.legs.length === 2, JSON.stringify(created.data));
check('case number, deadline and feedback link are generated', /^RS-\d{6}-\d{5}$/.test(c?.caseNo) && !!c?.deadlineAt && !!c?.feedbackToken);
check('lat / lng taken from the Maps link', c?.legs[0].lat === '17.32' && c?.legs[0].lng === '76.83');
check('co-applicant saved', c?.coApplicantName === 'Smoke Co-applicant');
check('banker details saved (PAN upper-cased, extra name kept)', c?.bankerCaseId === `SMK/${tag}` && c?.pan === 'ABCDE1234F' && c?.loanAmount === 2500000 && c?.otherNames?.[0] === 'Smoke Guarantor', JSON.stringify(c));
const edited = await call('PATCH', `/api/cases/${c.id}/details`, { token: olToken, body: { ...DETAILS, customerName: c.customerName, product: c.product, contact: c.contact, loanAmount: 3000000, otherNames: ['A One', 'B Two', 'C Three'] } });
check('case details can be edited', edited.status === 200 && edited.data.case.loanAmount === 3000000 && edited.data.case.otherNames.length === 3, JSON.stringify(edited.data));
check('more than 3 extra names is refused', (await call('PATCH', `/api/cases/${c.id}/details`, { token: olToken, body: { ...DETAILS, customerName: c.customerName, product: c.product, contact: c.contact, otherNames: ['A One', 'B Two', 'C Three', 'D Four'] } })).status === 400);
check('javascript: map links are rejected', (await call('POST', '/api/cases', { token: olToken, body: { ...created.data.case, legs: [{ type: 'RESIDENCE', address: 'x', pincode: '580021', mapLink: 'javascript:alert(1)', executiveId: exec.data.user.id }] } })).status === 400);

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

// re-work: OL sends visit 2 back, executive resubmits keeping the photos already taken
const rw = await call('POST', `/api/cases/${c.id}/legs/${c.legs[1].id}/rework`, { token: olToken, body: { reason: 'Name board photo is blurred — retake' } });
check('OL sends a visit back for re-work', rw.status === 200 && rw.data.case.status === 'IN_FIELD', JSON.stringify(rw.data).slice(0, 200));
const rwList = await call('GET', '/api/executive/legs?scope=rework', { token: ex });
check('executive sees it under Re-work (not in To do)', rwList.data.items?.length === 1 && (await call('GET', '/api/executive/legs', { token: ex })).data.items?.length === 0);
{
  const f = new FormData();
  f.append('findings', JSON.stringify({ metPerson: 'Gopal', relationship: 'Self', constitution: 'Proprietor', ownership: 'Owned', areaType: 'Commercial', yearsInBusiness: 22, businessSqft: 1000, setup: 'Seen', natureOfBusiness: 'Tea stall', stockSeen: 'Yes', employeesClaimed: 2, employeesSeen: 2, nameBoard: 'Displayed', qrCode: 'Verified and found genuine', businessProof: 'Collected', landmark: 'Near Temple', neighbour: 'Kumar', neighbourFeedback: 'Positive', politicalLink: 'No political background' }));
  f.append('photo3', png(), 'p3.png');
  const re = await call('POST', `/api/executive/legs/${c.legs[1].id}/submit`, { token: ex, form: f });
  check('re-work resubmitted with one new photo (others kept)', re.status === 200, JSON.stringify(re.data));
}
const edit = await call('PATCH', `/api/cases/${c.id}/legs/${c.legs[0].id}/details`, { token: olToken, body: { findings: { metPerson: 'Basalingamma B', ownership: 'Owned' } } });
check('OL edits submitted details', edit.status === 200 && edit.data.case.legs[0].findings.metPerson === 'Basalingamma B' && !!edit.data.case.legs[0].editedBy);
const hol = await call('PATCH', `/api/cases/${c.id}/holidays`, { token: olToken, body: { holidays: [{ date: '2026-10-20', note: 'Bank holiday' }] } });
check('holiday adds 24 h to the deadline', hol.status === 200 && new Date(hol.data.case.deadlineAt) - new Date(c.deadlineAt) === 24 * 3600 * 1000);

const fb = await call('POST', `/api/public/feedback/${c.feedbackToken}`, { body: { rating: 4, noMoney: true, noPhotos: true, noLoanPush: true, professional: true, comments: 'Smoke test', respondentName: 'Tester' } });
check('customer submits feedback via the public link', fb.status === 201, JSON.stringify(fb.data));
check('feedback cannot be submitted twice', (await call('POST', `/api/public/feedback/${c.feedbackToken}`, { body: { rating: 4, noMoney: true, noPhotos: true, noLoanPush: true, professional: true } })).status === 409);

const out = await call('POST', `/api/cases/${c.id}/outcome`, { token: olToken, body: { outcome: 'POSITIVE', qaRemarks: 'Verified', qaChecks: { executiveInfo: true, photographs: true } } });
check('OL sets final status Positive → case closed', out.status === 200 && out.data.case.status === 'CLOSED', JSON.stringify(out.data));

const logs = await call('GET', `/api/sampling-logins?executiveId=${exec.data.user.id}`, { token: admin });
check('sampling login shows the session with 2 visits', logs.data.items?.[0]?.visits === 2, JSON.stringify(logs.data));

check('executive logs out (session closed)', (await call('POST', '/api/auth/logout', { token: ex })).status === 200);

// Bank statement: internal, no executive, completed manually by the OL
const bs = await call('POST', '/api/cases', {
  token: olToken,
  body: { ...DETAILS, bankId: bank.data.bank.id, customerName: `Smoke Statement ${tag}`, product: 'Personal Loan', contact: '9876543210', tatType: 'LOCAL', legs: [{ type: 'BANK_STATEMENT', address: 'Canara Bank, Hubballi' }] },
});
check('bank statement case needs no executive', bs.status === 201 && bs.data.case.legs[0].executiveId === null, JSON.stringify(bs.data));
const man = await call('POST', `/api/cases/${bs.data.case?.id}/legs/${bs.data.case?.legs[0].id}/manual`, {
  token: olToken,
  body: { findings: { statementBank: 'Canara Bank', statementStatus: 'Genuine', averageBalance: '84000' }, remarks: 'Verified with branch manager.' },
});
check('OL adds details manually → QA pending', man.status === 200 && man.data.case.status === 'QA_PENDING', JSON.stringify(man.data));
const bsClose = await call('POST', `/api/cases/${bs.data.case?.id}/outcome`, { token: olToken, body: { outcome: 'POSITIVE' } });
check('OL closes the internally handled case', bsClose.data.case?.status === 'CLOSED');

// Transfer keeps history for admin / OL only
const ex2 = await call('POST', '/api/users', {
  token: admin,
  body: { role: 'EXECUTIVE', employeeId: `SMFX-${tag}`, name: `Smoke Exec Two ${tag}`, mobile: '9000000003', email: `smoke.fx.${tag}@test.in`, doj: '2026-10-01', dob: '1994-01-20', pincode: '580021', address: 'Test address, Hubballi', location: 'Hubballi' },
});
const tc = await call('POST', '/api/cases', {
  token: olToken,
  body: { ...DETAILS, bankId: bank.data.bank.id, customerName: `Smoke Transfer ${tag}`, product: 'Home Loan', contact: '9876543210', tatType: 'LOCAL', legs: [{ type: 'RESIDENCE', address: 'No 1, Hubballi', pincode: '580021', executiveId: exec.data.user.id }] },
});
const moved = await call('PATCH', `/api/cases/${tc.data.case?.id}/legs/${tc.data.case?.legs[0].id}/assign`, { token: olToken, body: { executiveId: ex2.data.user?.id } });
const leg0 = moved.data.case?.legs[0];
check('transfer: only the new executive is assigned, history kept', leg0?.executiveId === ex2.data.user?.id && leg0?.transfers.length === 1 && leg0.transfers[0].from.id === exec.data.user.id, JSON.stringify(moved.data).slice(0, 300));
check('TAT reason refused while within TAT', (await call('PATCH', `/api/cases/${tc.data.case?.id}/tat-reason`, { token: olToken, body: { text: 'x' } })).status === 400);

// Daily sampling (bank-branch logins)
const sForm = (fields, withSheet = true) => {
  const f = new FormData();
  Object.entries(fields).forEach(([k, v]) => f.append(k, String(v)));
  if (withSheet) f.append('sheet', png(), 'sheet.png');
  return f;
};
const sBase = { bankId: bank.data.bank.id, branch: `Smoke Branch ${tag}`, product: 'Vehicle Finance', samplerCategory: 'Full-time', totalFiles: 40, totalScreened: 30, totalSampled: 12, totalQuery: 2 };
check('sampling refused without the login sheet image', (await call('POST', '/api/sampling', { token: olToken, form: sForm({ ...sBase, samplerId: exec.data.user.id }, false) })).status === 400);
check('sampling refused when screened > files', (await call('POST', '/api/sampling', { token: olToken, form: sForm({ ...sBase, totalScreened: 50, samplerId: exec.data.user.id }) })).status === 400);
const s1 = await call('POST', '/api/sampling', { token: olToken, form: sForm({ ...sBase, samplerId: exec.data.user.id }) });
check('OL submits daily sampling (rates computed)', s1.status === 201 && s1.data.entry.screeningRate === 75 && s1.data.entry.samplingRate === 40, JSON.stringify(s1.data));
check('same sampler + branch + day is refused', (await call('POST', '/api/sampling', { token: olToken, form: sForm({ ...sBase, samplerId: exec.data.user.id }) })).status === 409);
const ex2Login = await call('POST', '/api/auth/login', { body: { email: `smoke.fx.${tag}@test.in`, password: ex2.data.tempPassword, app: 'executive' } });
const s2 = await call('POST', '/api/executive/sampling', { token: ex2Login.data.token, form: sForm({ ...sBase, branch: `Smoke Branch B ${tag}` }) });
check('executive submits own sampling from the app', s2.status === 201 && s2.data.entry.samplerId === ex2.data.user.id, JSON.stringify(s2.data));
const exBanks = await call('GET', '/api/executive/banks', { token: ex2Login.data.token });
check('executive app gets the bank list', exBanks.data.items?.some((b) => b.id === bank.data.bank.id));
const sList = await call('GET', `/api/sampling?bankId=${bank.data.bank.id}`, { token: admin });
check('sampling list filtered by bank', sList.data.items?.length === 2, String(sList.data.items?.length));
const bankB = await call('POST', '/api/banks', { token: admin, body: { name: `Smoke Bank B ${tag}`, code: `B${tag}`.slice(0, 8) } });
const s3 = await call('POST', '/api/executive/sampling', { token: ex2Login.data.token, form: sForm({ ...sBase, bankId: bankB.data.bank?.id, branch: `Smoke Branch B ${tag}` }) });
check('same sampler can log a second bank on the same day', s3.status === 201, JSON.stringify(s3.data));

const bdays = await call('GET', '/api/users/birthdays?days=366', { token: olToken });
check('birthday list includes the new users', bdays.data.items?.some((u) => u.id === exec.data.user.id));

const filtered = await call('GET', `/api/cases?bankId=${bank.data.bank.id}&tab=closed`, { token: admin });
check('bank-wise filter returns the 2 closed cases', filtered.data.items?.length === 2, String(filtered.data.items?.length));

// untraceable address: reason + one location photo, no questionnaire
const ut = await call('POST', '/api/cases', { token: olToken, body: { ...DETAILS, bankId: bank.data.bank.id, customerName: `Smoke Untraced ${tag}`, product: 'Home Loan', contact: '9876543210', tatType: 'LOCAL', legs: [{ type: 'RESIDENCE', address: 'No 9, Hubballi', pincode: '580021', executiveId: exec.data.user.id }] } });
{
  const f = new FormData();
  f.append('result', 'UNTRACEABLE');
  f.append('reason', 'short');
  f.append('photo0', png(), 'loc.png');
  check('untraceable needs a detailed reason', (await call('POST', `/api/executive/legs/${ut.data.case.legs[0].id}/submit`, { token: ex, form: f })).status === 400);
  const g = new FormData();
  g.append('result', 'UNTRACEABLE');
  g.append('reason', 'No such door number on 2nd cross; three neighbours and the local shop do not know the customer.');
  g.append('photo0', png(), 'loc.png');
  g.append('photo1', png(), 'loc2.png');
  g.append('photo2', png(), 'loc3.png');
  const u = await call('POST', `/api/executive/legs/${ut.data.case.legs[0].id}/submit`, { token: ex, form: g });
  check('untraceable submitted with reason + 3 location photos', u.status === 200, JSON.stringify(u.data));
  const utc = await call('GET', `/api/cases/${ut.data.case.id}`, { token: admin });
  check('all 3 location photos are kept', utc.data.case?.legs[0].photos?.length === 3, JSON.stringify(utc.data.case?.legs[0].photos));
}

// internal document check filled in on the New case form
const dc = await call('POST', '/api/cases', { token: olToken, body: { ...DETAILS, bankId: bank.data.bank.id, customerName: `Smoke Document ${tag}`, product: 'Home Loan', contact: '9876543210', tatType: 'LOCAL', legs: [{ type: 'INTERNAL_DOCUMENT', documentName: 'Khata', findings: { documentNo: 'KH/1', details: 'Checked with the office register', documentStatus: 'Positive' } }] } });
check('internal check document is completed at creation (no executive)', dc.status === 201 && dc.data.case.legs[0].status === 'SUBMITTED' && !dc.data.case.legs[0].executiveId, JSON.stringify(dc.data).slice(0, 300));
const fd = await call('POST', '/api/cases', { token: olToken, body: { ...DETAILS, bankId: bank.data.bank.id, customerName: `Smoke Field Doc ${tag}`, product: 'Home Loan', contact: '9876543210', tatType: 'LOCAL', legs: [{ type: 'DOCUMENT', documentName: 'RTC', documentNo: 'RTC/SMOKE/1', address: 'Taluk office, Hubballi', executiveId: exec.data.user.id }] } });
check('document check can be allocated to a field executive', fd.status === 201 && fd.data.case.legs[0].executiveId === exec.data.user.id && !fd.data.case.legs[0].internal, JSON.stringify(fd.data).slice(0, 300));
check('document check without an executive is refused', (await call('POST', '/api/cases', { token: olToken, body: { ...DETAILS, bankId: bank.data.bank.id, customerName: `Smoke Field Doc2 ${tag}`, product: 'Home Loan', contact: '9876543210', tatType: 'LOCAL', legs: [{ type: 'DOCUMENT', documentName: 'RTC' }] } })).status === 400);

// attendance (operational leads) and Discussion chat
check('OL checks in', (await call('POST', '/api/attendance/check-in', { token: olToken, body: {} })).status === 201);
check('second check-in the same day is refused', (await call('POST', '/api/attendance/check-in', { token: olToken, body: {} })).status === 400);
check('OL checks out', (await call('POST', '/api/attendance/check-out', { token: olToken, body: {} })).status === 200);
check('admin cannot check in (OLs only)', (await call('POST', '/api/attendance/check-in', { token: admin, body: {} })).status === 403);
const att = await call('GET', '/api/attendance', { token: admin });
check('admin sees attendance records', att.data.items?.length >= 1);
check('chat message posted', (await call('POST', '/api/chat', { token: olToken, body: { text: `Smoke hello ${tag}` } })).status === 201);
const chat = await call('GET', '/api/chat', { token: admin });
check('admin reads the chat', chat.data.items?.some((m) => m.text === `Smoke hello ${tag}`));
check('executives cannot use the chat', (await call('GET', '/api/chat', { token: ex })).status === 403);
const cf = new FormData();
cf.append('text', '📎 MIS for today');
cf.append('files', png(), 'photo.png');
cf.append('files', new Blob(['Case,Status\nRS-1,Closed\n'], { type: 'text/csv' }), 'mis.csv');
const withFiles = await call('POST', '/api/chat', { token: admin, form: cf });
check('admin shares an image + CSV in the chat', withFiles.status === 201 && withFiles.data.message.attachments.length === 2, JSON.stringify(withFiles.data));
const onlyFile = new FormData();
onlyFile.append('files', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'report.pdf');
check('a file can be sent without text', (await call('POST', '/api/chat', { token: olToken, form: onlyFile })).status === 201);
const exe = new FormData();
exe.append('files', new Blob(['MZ'], { type: 'application/x-msdownload' }), 'virus.exe');
check('other file types are refused in the chat', (await call('POST', '/api/chat', { token: admin, form: exe })).status === 400);
check('empty chat message is refused', (await call('POST', '/api/chat', { token: admin, body: { text: '  ' } })).status === 400);
const dd = await call('GET', `/api/cases/dedupe?mobile=9876543210&pan=`, { token: olToken });
check('dedupe check finds earlier cases by mobile', dd.status === 200 && dd.data.matches?.length > 0 && dd.data.matches[0].matchedOn.includes('Mobile'), JSON.stringify(dd.data).slice(0, 200));
check('dedupe check with nothing to search is refused', (await call('GET', '/api/cases/dedupe?mobile=12&pan=x', { token: olToken })).status === 400);
const ag = await call('GET', '/api/auth/agency', { token: ex });
check('ID card gets the agency manager details', ag.status === 200 && ag.data.agency?.managerName === 'Narayan Swamy' && ag.data.agency?.managerTitle === 'Agency Manager');
check('field executive cannot change their own password', (await call('POST', '/api/auth/change-password', { token: ex, body: { currentPassword: 'x', newPassword: 'whatever123' } })).status === 403);
const rp = await call('POST', `/api/users/${exec.data.user.id}/reset-password`, { token: admin, body: { password: 'Field@2026' } });
check('admin sets a chosen password for an executive', rp.status === 200 && rp.data.tempPassword === 'Field@2026');
const relog = await call('POST', '/api/auth/login', { body: { email: exec.data.user.email, password: 'Field@2026', app: 'executive' } });
check('executive signs in with the admin-set password (no forced change)', relog.status === 200 && relog.data.user.mustChangePassword === false, JSON.stringify(relog.data).slice(0, 200));
const del = await call('PATCH', `/api/users/${exec.data.user.id}`, { token: admin, body: { status: 'Deleted' } });
check('admin deletes a field executive', del.status === 200 && del.data.user.status === 'Deleted');
check('deleted executive cannot sign in', (await call('POST', '/api/auth/login', { body: { email: exec.data.user.email, password: 'Field@2026', app: 'executive' } })).status === 403);
const ret = await call('GET', '/api/cases/retention?days=7', { token: admin });
check('admin sees the auto-deletion list', ret.status === 200 && ret.data.retentionDays >= 0 && Array.isArray(ret.data.due) && Array.isArray(ret.data.log), JSON.stringify(ret.data).slice(0, 200));
check('OL cannot see the auto-deletion list', (await call('GET', '/api/cases/retention', { token: olToken })).status === 403);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
