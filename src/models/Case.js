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

const legSchema = new Schema(
  {
    type: { type: String, enum: Object.keys(VERIFICATION_TYPES), required: true },
    address: { type: String, default: '' },
    mapLink: { type: String, default: '' },
    lat: { type: String, default: '' },
    lng: { type: String, default: '' },
    fromPlace: { type: String, default: '' },
    toPlace: { type: String, default: '' },
    km: { type: Number, default: null },
    contact: { type: String, default: '' },
    trigger: { type: String, default: '' },
    executive: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED'], default: 'ASSIGNED' },
    startedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
    startPoint: pointSchema,
    submitPoint: pointSchema,
    findings: { type: Schema.Types.Mixed, default: {} },
    photos: { type: [photoSchema], default: [] },
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
    tatType: { type: String, enum: ['LOCAL', 'OGL'], required: true },
    deadlineAt: { type: Date, required: true, index: true },
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
