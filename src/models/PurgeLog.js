import mongoose from 'mongoose';

// One row per automatically deleted case. Holds no customer data — only what is
// needed to answer "when was case RS-xxxx removed?".
const purgeLogSchema = new mongoose.Schema(
  {
    caseNo: { type: String, required: true, index: true },
    bankName: { type: String, default: '' },
    closedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: Date.now, index: true },
    files: { type: Number, default: 0 }, // photos / documents removed from disk
  },
  { timestamps: false },
);

export const PurgeLog = mongoose.model('PurgeLog', purgeLogSchema);
