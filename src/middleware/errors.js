import { ZodError } from 'zod';
import multer from 'multer';

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new ApiError(400, msg, details);
export const notFound = (msg = 'Not found') => new ApiError(404, msg);
export const forbidden = (msg = 'You do not have permission to do this.') => new ApiError(403, msg);
export const conflict = (msg) => new ApiError(409, msg);

// Wrap async route handlers so thrown errors reach the error middleware.
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function notFoundHandler(req, res) {
  res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return res.status(400).json({ error: details[0] ? `${details[0].path}: ${details[0].message}` : 'Invalid input', details });
  }
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large.' : err.message });
  }
  if (err?.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'value';
    const label = { email: 'Email ID', employeeId: 'Employee ID', code: 'Bank code' }[field] || field;
    return res.status(409).json({ error: `${label} is already in use.` });
  }
  if (err?.name === 'CastError') return res.status(400).json({ error: 'Invalid id.' });
  if (err instanceof ApiError) return res.status(err.status).json({ error: err.message, details: err.details });
  // body-parser (bad JSON, body too large), express.static 404s, etc.
  const status = err?.status || err?.statusCode;
  if (status && status < 500) return res.status(status).json({ error: status === 404 ? 'File not found.' : err.message });

  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
}
