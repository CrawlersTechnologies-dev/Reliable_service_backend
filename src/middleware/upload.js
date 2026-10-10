import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { env } from '../config/env.js';
import { badRequest } from './errors.js';

const ALLOWED = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

// Files go to uploads/<folder>/<random>.<ext>. Random names keep URLs unguessable.
function storageFor(folder) {
  return multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(env.uploadDir, folder);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + ALLOWED[file.mimetype]),
  });
}

export function uploader(folder, { imagesOnly = false } = {}) {
  return multer({
    storage: storageFor(folder),
    limits: { fileSize: env.maxUploadBytes, files: 20 },
    fileFilter: (req, file, cb) => {
      const ok = ALLOWED[file.mimetype] && (!imagesOnly || file.mimetype.startsWith('image/'));
      cb(ok ? null : badRequest(`${file.originalname}: only ${imagesOnly ? 'JPG / PNG / WEBP images' : 'images or PDF'} are allowed.`), !!ok);
    },
  });
}

export const publicUrl = (file, folder) => `/uploads/${folder}/${path.basename(file.path)}`;

// Panel sends the profile photo as a small data URL; store it as a file.
export function saveDataUrlImage(dataUrl, folder) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw badRequest('Photograph must be a JPG, PNG or WEBP image.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 2 * 1024 * 1024) throw badRequest('Photograph is too large (max 2 MB).');
  const dir = path.join(env.uploadDir, folder);
  fs.mkdirSync(dir, { recursive: true });
  const name = crypto.randomBytes(16).toString('hex') + ALLOWED[m[1]];
  fs.writeFileSync(path.join(dir, name), buf);
  return `/uploads/${folder}/${name}`;
}
