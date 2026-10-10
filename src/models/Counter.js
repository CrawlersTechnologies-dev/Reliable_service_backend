import mongoose from 'mongoose';

// Atomic sequences, e.g. case numbers per month: { _id: 'case-2610', seq: 15 }
const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false });
export const Counter = mongoose.model('Counter', counterSchema);

export async function nextSeq(key) {
  const c = await Counter.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return c.seq;
}
