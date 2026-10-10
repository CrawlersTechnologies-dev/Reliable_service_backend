import mongoose from 'mongoose';

const bankSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    contactPerson: { type: String, trim: true, default: '' },
    contactNumber: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    city: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  },
  { timestamps: true },
);

export const Bank = mongoose.model('Bank', bankSchema);
