import { Router } from 'express';
import { upload } from '../middleware/upload.js';
import { createStrategy } from '../../strategies/index.js';
import { EXTRACTION_MODES } from '../../core/types.js';
import type { ExtractionMode, NidImage } from '../../core/types.js';

export const extractRouter = Router();

/**
 * POST /extract
 *
 * Multipart form fields:
 *   front  (file, required) — front-side NID image
 *   back   (file, optional) — back-side NID image
 *   mode   (text, optional) — extraction mode, default: "combined"
 *
 * Returns ExtractionResult as JSON.
 */
extractRouter.post(
  '/',
  upload.fields([{ name: 'front', maxCount: 1 }, { name: 'back', maxCount: 1 }]),
  async (req, res, next) => {
    try {
      const files     = req.files as Record<string, Express.Multer.File[]> | undefined;
      const frontFile = files?.['front']?.[0];
      const backFile  = files?.['back']?.[0];

      if (!frontFile) {
        res.status(400).json({
          success: false,
          error:   'Missing required field "front". Send as multipart/form-data.',
        });
        return;
      }

      const rawMode = (req.body as Record<string, string>)['mode'] ?? 'combined';
      if (!EXTRACTION_MODES.includes(rawMode as ExtractionMode)) {
        res.status(400).json({
          success: false,
          error:   `Invalid mode "${rawMode}". Allowed: ${EXTRACTION_MODES.join(', ')}`,
        });
        return;
      }
      const mode = rawMode as ExtractionMode;

      const images: NidImage[] = [
        { buffer: frontFile.buffer, mimeType: frontFile.mimetype, side: 'front' },
        ...(backFile ? [{ buffer: backFile.buffer, mimeType: backFile.mimetype, side: 'back' as const }] : []),
      ];

      const result = await createStrategy(mode).extract(images);
      res.json({ success: true, ...result });

    } catch (err) {
      next(err);
    }
  },
);
