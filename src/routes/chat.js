// "Discussion – Core" chat for Admin and operational leads (panel only).
//   GET  /api/chat?after=ISO   messages, oldest first (last 200, or only newer than `after`)
//   POST /api/chat  { text }  or multipart: text + files[] (≤5 images / PDF / Excel / CSV / Word)
//   DELETE /api/chat/:id       own message (admin: any)
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { Message } from '../models/Message.js';
import { actor } from '../middleware/auth.js';
import { ah, badRequest, forbidden, notFound } from '../middleware/errors.js';
import { chatMime, chatUploader, publicUrl } from '../middleware/upload.js';
import { env } from '../config/env.js';

const upload = chatUploader();
const removeFiles = (files = []) => files.forEach((f) => fs.unlink(f.path, () => {}));

const r = Router();
const out = (m) => ({
  id: String(m._id),
  text: m.text || '',
  attachments: (m.attachments || []).map((a) => ({ url: a.url, name: a.name, type: a.type, size: a.size })),
  by: { id: String(m.by.id), name: m.by.name, role: m.by.role },
  at: m.createdAt.toISOString(),
});

r.get(
  '/',
  ah(async (req, res) => {
    const { after } = z.object({ after: z.string().datetime().optional() }).parse(req.query);
    const rows = after
      ? await Message.find({ createdAt: { $gt: new Date(after) } }).sort({ createdAt: 1 }).limit(200)
      : (await Message.find().sort({ createdAt: -1 }).limit(200)).reverse();
    res.json({ items: rows.map(out) });
  }),
);

r.post(
  '/',
  upload.array('files', 5),
  ah(async (req, res) => {
    const files = req.files || [];
    try {
      const { text } = z.object({ text: z.string().trim().max(2000).optional().default('') }).parse(req.body);
      if (!text && !files.length) throw badRequest('Type a message or attach a file.');
      const attachments = files.map((f) => ({
        url: publicUrl(f, 'chat'),
        name: (f.originalname || path.basename(f.path)).slice(0, 180),
        type: chatMime(f),
        size: f.size,
      }));
      const m = await Message.create({ text, attachments, by: actor(req.user) });
      res.status(201).json({ message: out(m) });
    } catch (e) {
      removeFiles(files);
      throw e;
    }
  }),
);

r.delete(
  '/:id',
  ah(async (req, res) => {
    const m = await Message.findById(req.params.id);
    if (!m) throw notFound('Message not found.');
    if (req.user.role !== 'ADMIN' && String(m.by.id) !== String(req.user._id)) throw forbidden();
    (m.attachments || []).forEach((a) => {
      if (a.url?.startsWith('/uploads/chat/')) fs.unlink(path.join(env.uploadDir, 'chat', path.basename(a.url)), () => {});
    });
    await m.deleteOne();
    res.json({ ok: true });
  }),
);

export default r;
