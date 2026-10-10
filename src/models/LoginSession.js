import mongoose from 'mongoose';

// One row per executive app login — feeds the "Sampling logins" screen.
const loginSessionSchema = new mongoose.Schema(
  {
    executive: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    loginAt: { type: Date, default: Date.now, index: true },
    logoutAt: { type: Date, default: null },
    device: { type: String, default: '' },
    location: { type: String, default: '' }, // place name sent by the app (reverse-geocoded) or the executive's base city
    lat: { type: String, default: '' },
    lng: { type: String, default: '' },
    visits: { type: Number, default: 0 }, // verifications submitted during this session
  },
  { timestamps: true },
);

export const LoginSession = mongoose.model('LoginSession', loginSessionSchema);
