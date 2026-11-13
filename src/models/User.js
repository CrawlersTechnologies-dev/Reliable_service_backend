import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

export const ROLES = ['ADMIN', 'OL', 'EXECUTIVE'];
export const USER_STATUS = ['Active', 'Inactive', 'Suspended', 'Deleted'];

const userSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ROLES, required: true, index: true },
    employeeId: { type: String, required: true, unique: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    mobile: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    altMobile: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, default: '' },
    location: { type: String, trim: true, default: '' },
    pincode: { type: String, trim: true, default: '', index: true }, // base PIN code — used to suggest the nearest executive
    dob: { type: Date, default: null }, // birthday wishes
    bloodGroup: { type: String, default: '' }, // printed on the ID card
    salary: { type: Number, default: null }, // operational leads — salary offered (admin only)
    execType: { type: String, enum: ['FIELD_OFFICER', 'SAMPLER', ''], default: '' }, // field executives
    relievedOn: { type: Date, default: null }, // for the experience letter
    // field executives: shown on the performance review
    companyName: { type: String, trim: true, default: '' },
    reportingManager: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    designation: { type: String, trim: true },
    doj: { type: Date },
    status: { type: String, enum: USER_STATUS, default: 'Active', index: true },
    photoUrl: { type: String, default: '' },
    passwordHash: { type: String, required: true, select: false },
    mustChangePassword: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);

userSchema.methods.setPassword = async function setPassword(plain) {
  this.passwordHash = await bcrypt.hash(plain, 10);
};
userSchema.methods.checkPassword = function checkPassword(plain) {
  return bcrypt.compare(plain, this.passwordHash || '');
};

export const User = mongoose.model('User', userSchema);
