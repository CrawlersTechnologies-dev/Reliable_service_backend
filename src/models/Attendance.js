import mongoose from 'mongoose';

const { Schema } = mongoose;

// Daily check-in / check-out of operational leads (tracked only for OLs).
const attendanceSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, default: '' },
    date: { type: String, required: true, index: true }, // YYYY-MM-DD, server time zone
    checkIn: { type: Date, required: true },
    checkOut: { type: Date, default: null },
    note: { type: String, default: '' },
  },
  { timestamps: true },
);
attendanceSchema.index({ user: 1, date: 1 }, { unique: true });

export const Attendance = mongoose.model('Attendance', attendanceSchema);
