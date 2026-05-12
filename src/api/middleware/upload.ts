import multer from 'multer';
import { config } from '../../config/index.js';

export const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: config.upload.maxFileSizeBytes },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error(`Unsupported file type: ${file.mimetype}. Only images are accepted.`));
  },
});
