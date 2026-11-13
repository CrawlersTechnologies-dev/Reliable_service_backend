import mongoose from 'mongoose';
import { OUTCOMES, VERIFICATION_TYPES } from '../config/verification.js';
import { deriveCaseState } from '../utils/caseState.js';

const { Schema } = mongoose;

const photoSchema = new Schema(
  {
    slot: { type: Number, required: true }, // 0-5, matches VERIFICATION_TYPES[type].photos
    label: String,
    url: String,
    lat: String,
    lng: String,
    takenAt: Date,
  },
  { _id: false },
);

const fileSchema = new Schema({ name: String, type: String, size: Number, url: String }, { _id: false });
const pointSchema = new Schema({ lat: String, lng: String, at: Date }, { _id: false });
const actorRef = new Schema({ id: { type: Schema.Types.ObjectId, ref: 'User' }, name: String, role: String }, { _id: false });

// Reassignment history — admin / OL only; never sent to executives or printed on the report.
const transferSchema = new Schema(
  {
    from: actorRef,
    to: actorRef,
    by: actorRef,
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const legSchema = new Schema(
  {
    type: { type: String, enum: Object.keys(VERIFICATION_TYPES), required: true },
    address: { type: String, default: '' },
    pincode: { type: String, default: '' },
    mapLink: { type: String, default: '' },
    lat: { type: String, default: '' },
    lng: { type: String, default: '' },
    fromPlace: { type: String, default: '' },
    toPlace: { type: String, default: '' },
    km: { type: Number, default: null },
    contact: { type: String, default: '' },
    trigger: { type: String, default: '' },
    // null for internal legs (e.g. Bank statement) handled by Admin / OL
    executive: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    transfers: { type: [transferSchema], default: [] },
    // set when Admin / OL fill the details themselves instead of a field visit
    manual: { type: Boolean, default: false },
    manualRemarks: { type: String, default: '' },
    completedBy: { type: actorRef, default: null },
    status: { type: String, enum: ['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED'], default: 'ASSIGNED' },
    startedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
    startPoint: pointSchema,
    submitPoint: pointSchema,
    findings: { type: Schema.Types.Mixed, default: {} },
    photos: { type: [photoSchema], default: [] },
    // what the executive found at the address — TRACED / UNTRACEABLE / REFUSED ('' = not asked, older visits)
    visitResult: { type: String, enum: ['', 'TRACED', 'UNTRACEABLE', 'REFUSED'], default: '' },
    nonVisitReason: { type: String, default: '' }, // detailed reason when the verification could not be done
    // "visit later" attempts — the visit stays open
    attempts: {
      type: [new Schema({ result: String, reason: String, at: Date, lat: String, lng: String }, { _id: false })],
      default: [],
    },
    // sent back to the executive by Admin / OL
    rework: {
      type: new Schema({ reason: String, by: actorRef, at: Date, count: { type: Number, default: 1 }, resolvedAt: Date }, { _id: false }),
      default: null,
    },
    // Admin / OL changed the submitted details
    editedBy: { type: actorRef, default: null },
    editedAt: { type: Date, default: null },
    // Document verification only
    documentName: { type: String, default: '' },
    attachments: { type: [fileSchema], default: [] },
    contactPerson: { type: String, default: '' },
  },
  { timestamps: false },
);

const actorSchema = new Schema({ id: { type: Schema.Types.ObjectId, ref: 'User' }, name: String, role: String }, { _id: false });

const feedbackSchema = new Schema(
  {
    rating: { type: Number, min: 1, max: 5 },
    noMoney: Boolean,
    noPhotos: Boolean,
    noLoanPush: Boolean,
    professional: Boolean,
    comments: String,
    respondentName: String,
    submittedAt: Date,
    ip: String,
  },
  { _id: false },
);

const caseSchema = new Schema(
  {
    caseNo: { type: String, required: true, unique: true },
    bank: { type: Schema.Types.ObjectId, ref: 'Bank', required: true, index: true },
    customerName: { type: String, required: true, trim: true },
    product: { type: String, required: true, trim: true },
    contact: { type: String, required: true },
    altContact: { type: String, trim: true, default: '' }, // second contact number
    coApplicantName: { type: String, trim: true, default: '' },
    coApplicantContact: { type: String, trim: true, default: '' },
    // extra case details from the bank
    bankerCaseId: { type: String, trim: true, default: '' },
    branchName: { type: String, trim: true, default: '' },
    branchCode: { type: String, trim: true, default: '' },
    otherNames: { type: [String], default: [] }, // up to 3 more names (co-borrowers, guarantors…)
    loanAmount: { type: Number, default: null },
    dedupeCheck: { type: String, enum: ['Yes', 'No', ''], default: '' },
    pan: { type: String, trim: true, uppercase: true, default: '' },
    profile: { type: String, default: '' }, // Salaried / Self Employed / Agriculture / Contract Worker / Unemployed
    sourcing: { type: String, enum: ['DSA', 'DST', ''], default: '' },
    sourcingName: { type: String, trim: true, default: '' },
    tatType: { type: String, enum: ['LOCAL', 'OGL'], required: true },
    deadlineAt: { type: Date, required: true, index: true },
    // holidays inside the TAT window push the deadline by 24 h each (set by Admin / OL)
    originalDeadlineAt: { type: Date, default: null },
    holidays: {
      type: [new Schema({ date: String, note: String, by: actorRef, at: Date }, { _id: false })],
      default: [],
    },
    // why the case went beyond its TAT (written by Admin / OL)
    tatReason: { type: new Schema({ text: String, by: actorRef, at: Date }, { _id: false }), default: null },
    createdBy: actorSchema,
    legs: { type: [legSchema], validate: (v) => v.length > 0 },

    status: { type: String, enum: ['ASSIGNED', 'IN_FIELD', 'QA_PENDING', 'CLOSED'], default: 'ASSIGNED', index: true },
    fieldCompletedAt: { type: Date, default: null, index: true },

    outcome: { type: String, enum: [...OUTCOMES.map((o) => o.key), null], default: null, index: true },
    qaRemarks: { type: String, default: '' },
    qaChecks: { type: Schema.Types.Mixed, default: {} },
    outcomeBy: actorSchema,
    outcomeAt: { type: Date, default: null },

    feedbackToken: { type: String, required: true, unique: true },
    feedback: { type: feedbackSchema, default: null },
  },
  { timestamps: true },
);

caseSchema.index({ 'legs.executive': 1, status: 1 });
caseSchema.index({ createdAt: -1 });

// Call after any leg/outcome change.
caseSchema.methods.refreshState = function refreshState() {
  const { status, fieldCompletedAt } = deriveCaseState(this);
  this.status = status;
  this.fieldCompletedAt = fieldCompletedAt;
};

export const Case = mongoose.model('Case', caseSchema);
