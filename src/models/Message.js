import mongoose from 'mongoose';

const { Schema } = mongoose;
const actorRef = new Schema({ id: { type: Schema.Types.ObjectId, ref: 'User' }, name: String, role: String }, { _id: false });

// "Discussion – Core" chat between Admin and operational leads.
const messageSchema = new Schema(
  {
    text: { type: String, default: '', trim: true, maxlength: 2000 },
    attachments: [
      new Schema({ url: String, name: String, type: String, size: Number }, { _id: false }),
    ],
    by: { type: actorRef, required: true },
  },
  { timestamps: true },
);
messageSchema.index({ createdAt: -1 });

export const Message = mongoose.model('Message', messageSchema);
