import mongoose from 'mongoose';

const { Schema } = mongoose;
const actorRef = new Schema({ id: { type: Schema.Types.ObjectId, ref: 'User' }, name: String, role: String }, { _id: false });

// Daily sampling at a bank branch: how many loan files were logged in, screened,
// sampled and queried that day, with a photo of the bank's login sheet.
const samplingEntrySchema = new Schema(
  {
    date: { type: String, required: true, index: true }, // YYYY-MM-DD (visit date, set by the server)
    sampler: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    bank: { type: Schema.Types.ObjectId, ref: 'Bank', required: true, index: true },
    branch: { type: String, required: true, trim: true },
    product: { type: String, trim: true, default: '' },
    samplerCategory: { type: String, enum: ['Full-time', 'Part-time', ''], default: '' },
    totalFiles: { type: Number, required: true, min: 0 },
    totalScreened: { type: Number, required: true, min: 0 },
    totalSampled: { type: Number, required: true, min: 0 },
    totalQuery: { type: Number, required: true, min: 0 },
    sheetUrl: { type: String, required: true }, // login sheet image
    remarks: { type: String, default: '' },
    createdBy: actorRef, // the sampler (app) or Admin / OL entering on their behalf
  },
  { timestamps: true },
);

// one entry per sampler, bank branch and day (a sampler can cover several banks in a day)
samplingEntrySchema.index({ date: 1, sampler: 1, bank: 1, branch: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

export const SamplingEntry = mongoose.model('SamplingEntry', samplingEntrySchema);
