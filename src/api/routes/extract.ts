import { Router } from 'express';
import { upload } from '../middleware/upload.js';
import { createStrategy } from '../../strategies/index.js';
import { EXTRACTION_MODES } from '../../core/types.js';
import type { ExtractionMode, NidImage } from '../../core/types.js';

export const extractRouter = Router();

/**
 * POST /extract
 *
 * Multipart form fields (provide EITHER `front` OR `image`, not both):
 *   front  (file, optional) — explicit front-side NID image
 *   back   (file, optional) — back-side NID image (only valid with `front`)
 *   image  (file, optional) — single image of unknown side (front/back/combined);
 *                             smart mode auto-detects. Mutually exclusive with front/back.
 *   mode   (text, optional) — extraction mode, default: "combined"
 *
 * Returns ExtractionResult as JSON.
 */
extractRouter.post(
  '/',
  upload.fields([
    { name: 'front', maxCount: 1 },
    { name: 'back',  maxCount: 1 },
    { name: 'image', maxCount: 1 },
  ]),
  async (req, res, next) => {
    try {
      const files     = req.files as Record<string, Express.Multer.File[]> | undefined;
      const frontFile = files?.['front']?.[0];
      const backFile  = files?.['back']?.[0];
      const imageFile = files?.['image']?.[0];

      // ── Mutual-exclusion validation ─────────────────────────────────
      if (!frontFile && !imageFile) {
        res.status(400).json({
          success: false,
          error:   'Missing image. Provide either "front" or "image" as multipart/form-data.',
        });
        return;
      }
      if (frontFile && imageFile) {
        res.status(400).json({
          success: false,
          error:   '"front" and "image" are mutually exclusive. Use one or the other.',
        });
        return;
      }
      if (imageFile && backFile) {
        res.status(400).json({
          success: false,
          error:   '"back" can only accompany "front", not "image".',
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

      // ── Build NidImage[] ────────────────────────────────────────────
      // When `image` is used, label as 'unknown' so smart mode's combined-side
      // detection can decide whether it is front, back, or both.
      const images: NidImage[] = imageFile
        ? [{ buffer: imageFile.buffer, mimeType: imageFile.mimetype, side: 'unknown' }]
        : [
            { buffer: frontFile!.buffer, mimeType: frontFile!.mimetype, side: 'front' },
            ...(backFile ? [{ buffer: backFile.buffer, mimeType: backFile.mimetype, side: 'back' as const }] : []),
          ];

      const result = await createStrategy(mode).extract(images);
      res.json({ success: true, ...result });

    } catch (err) {
      next(err);
    }
  },
);
