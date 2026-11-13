import mongoose from 'mongoose';

const bankSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    // One or more bank managers / contact persons
    managers: {
      type: [
        new mongoose.Schema(
          {
            name: { type: String, trim: true, required: true },
            designation: { type: String, trim: true, default: '' },
            mobile: { type: String, trim: true, default: '' },
            email: { type: String, trim: true, lowercase: true, default: '' },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    // legacy single-contact fields (older records) — read only
    contactPerson: { type: String, trim: true, default: '' },
    contactNumber: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  },
  { timestamps: true },
);

export const Bank = mongoose.model('Bank', bankSchema);
