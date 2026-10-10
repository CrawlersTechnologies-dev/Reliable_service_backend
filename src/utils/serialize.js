// Shapes DB documents into the JSON the panel already uses (id instead of _id, etc.).
import { VERIFICATION_TYPES } from '../config/verification.js';

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
    designation: u.designation,
    doj: u.doj ? iso(u.doj).slice(0, 10) : '',
    status: u.status,
    photo: u.photoUrl || '',
    mustChangePassword: !!u.mustChangePassword,
    lastLoginAt: iso(u.lastLoginAt),
    createdAt: iso(u.createdAt),
  };
}

export function bankOut(b) {
  return {
    id: id(b),
    name: b.name,
    code: b.code,
    contactPerson: b.contactPerson,
    contactNumber: b.contactNumber,
    email: b.email,
    city: b.city,
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
    mapLink: l.mapLink,
    lat: l.lat,
    lng: l.lng,
    fromPlace: l.fromPlace,
    toPlace: l.toPlace,
    km: l.km,
    contact: l.contact,
    trigger: l.trigger,
    executiveId: id(l.executive),
    status: l.status,
    startedAt: iso(l.startedAt),
    submittedAt: iso(l.submittedAt),
    startPoint: l.startPoint || null,
    submitPoint: l.submitPoint || null,
    findings: l.findings || {},
    photos, // index = photo slot; value = URL or null
    photoDetails: (l.photos || []).map((p) => ({ slot: p.slot, label: p.label, url: p.url, lat: p.lat, lng: p.lng, takenAt: iso(p.takenAt) })),
    documentName: l.documentName,
    attachments: (l.attachments || []).map((a) => ({ name: a.name, type: a.type, size: a.size, url: a.url })),
    contactPerson: l.contactPerson,
  };
}

// Full case for admin / OL (includes the feedback link token).
export function caseOut(c) {
  return {
    id: id(c),
    caseNo: c.caseNo,
    createdAt: iso(c.createdAt),
    bankId: id(c.bank),
    customerName: c.customerName,
    product: c.product,
    contact: c.contact,
    tatType: c.tatType,
    deadlineAt: iso(c.deadlineAt),
    createdBy: actor(c.createdBy),
    legs: c.legs.map(legOut),
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
