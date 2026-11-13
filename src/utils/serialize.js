// Shapes DB documents into the JSON the panel already uses (id instead of _id, etc.).
import { AGENCY, VERIFICATION_TYPES } from '../config/verification.js';
import { deleteAtOf } from '../services/retention.js';

const id = (x) => (x ? String(x._id ?? x) : null);
const iso = (d) => (d ? new Date(d).toISOString() : null);
const actor = (a) => (a?.id ? { id: id(a.id), name: a.name, role: a.role } : null);

export function userOut(u) {
  return {
    id: id(u),
    role: u.role,
    employeeId: u.employeeId,
    name: u.name,
    mobile: u.mobile,
    email: u.email,
    altMobile: u.altMobile || '',
    address: u.address || '',
    location: u.location || '',
    pincode: u.pincode || '',
    dob: u.dob ? iso(u.dob).slice(0, 10) : '',
    designation: u.designation,
    companyName: u.companyName || '',
    reportingManagerId: u.reportingManager ? String(u.reportingManager._id || u.reportingManager) : '',
    // field officers report to the agency manager unless someone else is set
    reportingManagerName: u.reportingManager?.name || (u.role === 'EXECUTIVE' ? AGENCY.reviewer : ''),
    bloodGroup: u.bloodGroup || '',
    salary: u.role === 'OL' ? (u.salary ?? null) : undefined,
    execType: u.role === 'EXECUTIVE' ? u.execType || 'FIELD_OFFICER' : undefined,
    relievedOn: u.relievedOn ? iso(u.relievedOn).slice(0, 10) : '',
    doj: u.doj ? iso(u.doj).slice(0, 10) : '',
    status: u.status,
    photo: u.photoUrl || '',
    mustChangePassword: u.role === 'EXECUTIVE' ? false : !!u.mustChangePassword, // executives never change their own password
    lastLoginAt: iso(u.lastLoginAt),
    createdAt: iso(u.createdAt),
  };
}

export function bankOut(b) {
  return {
    id: id(b),
    name: b.name,
    code: b.code,
    // older banks stored one contact; show it as the first manager
    managers: b.managers?.length
      ? b.managers.map((m) => ({ name: m.name, designation: m.designation || '', mobile: m.mobile || '', email: m.email || '' }))
      : b.contactPerson
        ? [{ name: b.contactPerson, designation: '', mobile: b.contactNumber || '', email: b.email || '' }]
        : [],
    status: b.status,
    createdAt: iso(b.createdAt),
  };
}

export function legOut(l) {
  const slots = VERIFICATION_TYPES[l.type]?.photos.length ?? 6;
  const photos = Array.from({ length: slots }, (_, i) => l.photos?.find((p) => p.slot === i)?.url || null);
  return {
    id: id(l),
    type: l.type,
    address: l.address,
    pincode: l.pincode || '',
    mapLink: l.mapLink,
    lat: l.lat,
    lng: l.lng,
    fromPlace: l.fromPlace,
    toPlace: l.toPlace,
    km: l.km,
    contact: l.contact,
    trigger: l.trigger,
    executiveId: id(l.executive),
    internal: !!VERIFICATION_TYPES[l.type]?.internal,
    manual: !!l.manual,
    manualRemarks: l.manualRemarks || '',
    completedBy: actor(l.completedBy),
    status: l.status,
    startedAt: iso(l.startedAt),
    submittedAt: iso(l.submittedAt),
    startPoint: l.startPoint || null,
    submitPoint: l.submitPoint || null,
    findings: l.findings || {},
    photos, // index = photo slot; value = URL or null
    photoDetails: (l.photos || []).map((p) => ({ slot: p.slot, label: p.label, url: p.url, lat: p.lat, lng: p.lng, takenAt: iso(p.takenAt) })),
    visitResult: l.visitResult || '',
    nonVisitReason: l.nonVisitReason || '',
    attempts: (l.attempts || []).map((a) => ({ result: a.result, reason: a.reason, at: iso(a.at), lat: a.lat || '', lng: a.lng || '' })),
    rework: l.rework ? { reason: l.rework.reason, by: actor(l.rework.by), at: iso(l.rework.at), count: l.rework.count || 1, resolvedAt: iso(l.rework.resolvedAt) } : null,
    editedBy: actor(l.editedBy),
    editedAt: iso(l.editedAt),
    documentName: l.documentName,
    attachments: (l.attachments || []).map((a) => ({ name: a.name, type: a.type, size: a.size, url: a.url })),
    contactPerson: l.contactPerson,
  };
}

// Full case for admin / OL (includes the feedback link token).
export function caseOut(c) {
  const deleteAt = deleteAtOf(c);
  return {
    id: id(c),
    caseNo: c.caseNo,
    deleteAt: deleteAt ? deleteAt.toISOString() : null, // auto-deletion date (closed cases)
    createdAt: iso(c.createdAt),
    bankId: id(c.bank),
    customerName: c.customerName,
    product: c.product,
    contact: c.contact,
    coApplicantName: c.coApplicantName || '',
    coApplicantContact: c.coApplicantContact || '',
    altContact: c.altContact || '',
    holidays: (c.holidays || []).map((h) => ({ date: h.date, note: h.note || '', by: actor(h.by), at: iso(h.at) })),
    originalDeadlineAt: iso(c.originalDeadlineAt),
    bankerCaseId: c.bankerCaseId || '',
    branchName: c.branchName || '',
    branchCode: c.branchCode || '',
    otherNames: c.otherNames || [],
    loanAmount: c.loanAmount ?? null,
    dedupeCheck: c.dedupeCheck || '',
    pan: c.pan || '',
    profile: c.profile || '',
    sourcing: c.sourcing || '',
    sourcingName: c.sourcingName || '',
    tatType: c.tatType,
    deadlineAt: iso(c.deadlineAt),
    tatReason: c.tatReason?.text ? { text: c.tatReason.text, by: actor(c.tatReason.by), at: iso(c.tatReason.at) } : null,
    createdBy: actor(c.createdBy),
    // transfers (reassignment history) are added for admin / OL only — never in executiveLegOut
    legs: c.legs.map((l) => ({
      ...legOut(l),
      transfers: (l.transfers || []).map((t) => ({ from: actor(t.from), to: actor(t.to), by: actor(t.by), at: iso(t.at) })),
    })),
    status: c.status,
    fieldCompletedAt: iso(c.fieldCompletedAt),
    outcome: c.outcome || null,
    qaRemarks: c.qaRemarks || '',
    qaChecks: c.qaChecks || {},
    outcomeBy: actor(c.outcomeBy),
    outcomeAt: iso(c.outcomeAt),
    feedbackToken: c.feedbackToken,
    feedback: c.feedback?.submittedAt
      ? {
          rating: c.feedback.rating,
          noMoney: c.feedback.noMoney,
          noPhotos: c.feedback.noPhotos,
          noLoanPush: c.feedback.noLoanPush,
          professional: c.feedback.professional,
          comments: c.feedback.comments,
          respondentName: c.feedback.respondentName,
          submittedAt: iso(c.feedback.submittedAt),
        }
      : null,
  };
}

// What the executive app sees: only their own leg, no feedback token, no outcome.
export function executiveLegOut(c, l, bankName) {
  return {
    caseId: id(c),
    caseNo: c.caseNo,
    customerName: c.customerName,
    product: c.product,
    bankName,
    tatType: c.tatType,
    createdAt: iso(c.createdAt),
    deadlineAt: iso(c.deadlineAt),
    combined: c.legs.length > 1,
    leg: legOut(l),
  };
}

export function loginOut(s) {
  return {
    id: id(s),
    executiveId: id(s.executive),
    loginAt: iso(s.loginAt),
    logoutAt: iso(s.logoutAt),
    device: s.device,
    location: s.location,
    lat: s.lat,
    lng: s.lng,
    visits: s.visits,
  };
}

export function samplingOut(e) {
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  return {
    id: id(e),
    date: e.date,
    samplerId: id(e.sampler),
    bankId: id(e.bank),
    branch: e.branch,
    product: e.product || '',
    samplerCategory: e.samplerCategory || '',
    totalFiles: e.totalFiles,
    totalScreened: e.totalScreened,
    totalSampled: e.totalSampled,
    totalQuery: e.totalQuery,
    screeningRate: pct(e.totalScreened, e.totalFiles), // screened ÷ files
    samplingRate: pct(e.totalSampled, e.totalScreened), // sampled ÷ screened
    sheetUrl: e.sheetUrl,
    remarks: e.remarks || '',
    createdBy: actor(e.createdBy),
    createdAt: iso(e.createdAt),
  };
}
