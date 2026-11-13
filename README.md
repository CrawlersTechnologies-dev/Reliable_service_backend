# Reliable Services — API (Node.js + Express + MongoDB)

Backend for the admin / operational lead panel (`reliable-admin`) and the upcoming field executive app.

## 1. Setup

Needs **Node 20+** and **MongoDB** (local install, Docker, or a free MongoDB Atlas cluster).

```bash
cd reliable-api
npm install
cp .env.example .env          # then edit MONGODB_URI, JWT_SECRET, ADMIN_EMAIL / ADMIN_PASSWORD
npm run seed                  # creates the first admin from .env
npm run seed:demo             # optional: wipes and loads the demo banks, users, 14 cases, logins
npm run dev                   # http://localhost:4000
```

MongoDB with Docker, if you don't have it installed:

```bash
docker run -d --name reliable-mongo -p 27017:27017 -v reliable-mongo:/data/db mongo:7
```

Then in another terminal run the panel (`reliable-admin`): `npm run dev` → http://localhost:5173.
Vite forwards `/api` and `/uploads` to port 4000, so no CORS setup is needed in development.

Logins after `seed:demo`:

| Who | Email | Password |
|---|---|---|
| Admin | value of `ADMIN_EMAIL` | value of `ADMIN_PASSWORD` |
| Operational lead | kavya@reliable.in | Demo@123 |
| Field executive (app) | mahesh@reliable.in | Demo@123 |

## 2. Check it works

With the server running:

```bash
npm test      # unit tests: TAT, case status, questionnaire validation
npm run smoke # end-to-end: creates a test bank/OL/executive/case and walks the full flow
```

`smoke` prints ✓ / ✗ for ~30 checks: role permissions, combined case, executive submit with photos,
case → QA pending → closed, feedback link once-only, sampling login visits, bank filter.
It leaves "Smoke …" records behind — run it on a test database.

## 3. Roles

| | Admin | OL | Executive (app) |
|---|---|---|---|
| Sign in to web panel | ✓ | ✓ | ✗ |
| Sign in to mobile app | ✗ | ✗ | ✓ |
| Banks | create / edit | view | — |
| Operational leads | create / edit / reset password | — | — |
| Field executives | create / edit / reset password | view | — |
| Create cases, reassign, upload documents | ✓ | ✓ | — |
| Set final status (+ve / -ve / Risk / CNV / Refer) | ✓ | ✓ | — |
| See feedback link | ✓ | ✓ | never sent |
| Own assigned verifications, start / submit visit | — | — | ✓ |

Enforced in `src/app.js` (route groups) and `requireRole(...)` inside the routes.
Every request re-checks the user's status, so **suspending** someone signs them out immediately.

New OLs / executives get a **temporary password** shown once to the admin
(Admin → Operational leads / Field executives → Add). "Reset password" in the edit dialog issues a new one.

## 4. Endpoints

```
GET    /api/health

# auth
POST   /api/auth/login            { email, password, app: 'panel' | 'executive', device?, lat?, lng?, location? }
GET    /api/auth/me
POST   /api/auth/logout           (closes the executive's sampling-login session)
POST   /api/auth/change-password  { currentPassword, newPassword }

# panel (admin + OL)
GET    /api/banks                 POST /api/banks (admin)          PATCH /api/banks/:id (admin)
GET    /api/users?role=OL|EXECUTIVE                                 (OL: EXECUTIVE only)
GET    /api/users/next-id?role=   POST /api/users (admin) → { user, tempPassword }   (dob + pincode required; executives also take companyName, reportingManagerId = an OL)
GET    /api/users/birthdays?days=7                                  birthdays today / next N days, all roles
PATCH  /api/users/:id (admin)     POST /api/users/:id/reset-password (admin) → { tempPassword }
GET    /api/cases?tab=all|in-tat|out-of-tat|qa|closed&bankId=&type=&executiveId=&tatType=&outcome=&from=&to=&q=
GET    /api/cases/:id
POST   /api/cases                 (date, case no., deadline, feedback token set by server)
POST   /api/cases/:id/legs/:legId/attachments   multipart "files" (document verification)
PATCH  /api/cases/:id/legs/:legId/assign        { executiveId }   (keeps transfer history for admin / OL)
PATCH  /api/cases/:id/tat-reason                { text }          why the case crossed its TAT
POST   /api/cases/:id/legs/:legId/manual        { findings, remarks }  Admin / OL fill details & mark completed
PATCH  /api/cases/:id/holidays                 { holidays: [{ date, note }] }  each holiday adds 24 h to the TAT
POST   /api/cases/:id/legs/:legId/rework        { reason }   send a submitted visit back to the executive (Re-work tab)
PATCH  /api/cases/:id/legs/:legId/details       { findings, nonVisitReason }   Admin / OL correct submitted details
POST   /api/cases/:id/outcome                   { outcome, qaRemarks, qaChecks }
POST   /api/cases/:id/legs/:legId/simulate      DEMO ONLY (ENABLE_DEMO_TOOLS=true, never in production)
GET    /api/sampling-logins?executiveId=&from=&to=          executive app login sessions
GET    /api/sampling?from=&to=&samplerId=&bankId=           daily bank-branch sampling (default last 31 days)
POST   /api/sampling              multipart: samplerId, bankId, branch, totalFiles, totalScreened, totalSampled,
                                  totalQuery, remarks?, sheet (JPG/PNG ≤ 5 MB, required). Visit date = today (server).
                                  Rules: screened ≤ files, sampled ≤ screened, query ≤ files; one entry per
                                  sampler + bank + branch + day (409 if repeated). Returns screeningRate / samplingRate.
DELETE /api/sampling/:id (admin)
GET    /api/attendance/today      POST /api/attendance/check-in (OL)      POST /api/attendance/check-out (OL)
GET    /api/attendance?from=&to=&userId=     admin: all OLs · OL: own
GET    /api/chat?after=ISO        POST /api/chat { text } or multipart text + files[] (≤5: image/PDF/Excel/CSV/Word)   DELETE /api/chat/:id      Discussion – Core (Admin + OL)
GET    /api/cases/retention?days=7   (admin) closed cases due for automatic deletion + deletion log. Closed cases are deleted CASE_RETENTION_DAYS (default 90) after closing, with their files.

# public (no login)
GET    /api/public/feedback/:token
POST   /api/public/feedback/:token   { rating, noMoney, noPhotos, noLoanPush, professional, comments?, respondentName? }

# executive app
GET    /api/executive/legs?scope=open|rework|done   overdue first, with TAT state
POST   /api/executive/legs/:legId/start         { lat, lng }
POST   /api/executive/legs/:legId/submit        multipart: findings (JSON), lat, lng,
                                                photo0…photo5 (0–3 required), photoN_lat / photoN_lng
                                                result=TRACED (default) | UNTRACEABLE | REFUSED — not traced: reason (20+ chars) + photo0 only
POST   /api/executive/legs/:legId/attempt       { reason, lat, lng }  customer asked to visit later — visit stays open
GET    /api/executive/banks                     active banks { id, name, code } for the sampling form
GET    /api/executive/sampling                  my daily sampling entries, last 30 days
POST   /api/executive/sampling                  same multipart as /api/sampling, sampler = me
```

Errors always come back as `{ "error": "message" }` with a 4xx / 5xx status.

## 5. How the main rules work

- **Case number** `RS-YYMMDD-00001` (e.g. RS-261023-00001): IST date of creation, number restarts every day (`counters` collection, atomic). Older cases keep their old numbers.
- **TAT**: `deadlineAt = createdAt + 8h (Local) / 24h (OGL)`. The clock stops at `fieldCompletedAt`
  (last executive submission). Tabs use these two fields, so filtering is done in MongoDB.
- **Case status** is derived from its locations: Assigned → In field → QA pending → Closed
  (`src/utils/caseState.js`, unit-tested).
- **Combined cases**: one case, several `legs`, each with its own address, PIN code, map, route, km and executive.
- **Bank statement** (`BANK_STATEMENT`) is an internal type: no executive, no visit. Admin / OL use
  `…/manual` to enter the details, then set the final status. `…/manual` also works for any other
  verification handled in the office.
- **Transfers**: reassigning keeps `legs[].transfers` (from / to / by / at) for admin / OL only. The executive
  app and the bank report show only the current executive.
- **Lat / long** are read from the pasted Google Maps link; there are no separate fields.
- **Questionnaire** fields and dropdowns come from `src/config/verification.js` (copied from the panel —
  keep both files the same). Submitted answers are checked against it: unknown keys are dropped,
  required fields and dropdown values are enforced, conditional fields (e.g. rent amount) respected.
- **Feedback link** opens only after a visit has started and can be used once. The token is never
  included in executive responses.
- **Uploads** go to `uploads/photos` and `uploads/documents` with random file names
  (images / PDF only, 10 MB each). Moving to S3 later only touches `src/middleware/upload.js`.

## 6. Folder map

```
src/
  server.js            connect MongoDB, start HTTP
  app.js               middleware + route groups per role
  config/env.js        reads .env
  config/verification.js  types, fields, outcomes, TAT (shared with the panel)
  models/              User, Bank, Case (with legs), LoginSession, Counter
  middleware/          auth (JWT + roles), errors, upload (multer)
  routes/              auth, banks, users, cases, logins, feedback (public), executive (app)
  utils/               caseState (TAT/status rules), serialize (JSON shape), password
  demo/demoData.js     demo dataset for seed:demo
scripts/seed.js, scripts/smoke.js
test/                  node --test unit tests
```

## 7. Before going live

- Set `NODE_ENV=production`, a long `JWT_SECRET`, `ENABLE_DEMO_TOOLS=false`, real `CORS_ORIGIN`.
- Run behind HTTPS (nginx / Caddy) and back up MongoDB.
- Uploaded files are served at unguessable URLs but without a login check; if banks require
  stricter access, switch to signed URLs (S3) — the rest of the code doesn't change.
