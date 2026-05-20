/**
 * One-off diagnostic: crop the motherNameBn gap region from the trigger image,
 * generate the raw crop + CLAHE-enhanced variant, and save both to outputs/
 * so we can visually inspect what (if anything) remains in the flashed zone.
 */
import 'dotenv/config';
import sharp from 'sharp';
import { readFile, mkdir } from 'fs/promises';
import { join } from 'path';

const FRONT = 'nid_images/nid_images/WhatsApp Image 2026-04-20 at 2.19.09 PM.jpeg';

// From inspectVision: Block 6 "মাতা :" at x=358-424, Block 7 "আরা বেগম" at x=542-673, y=1033-1059
// Crop with generous padding so we see ascenders / descenders / above-line marks
const CROP = { left: 340, top: 1000, width: 360, height: 100 };

async function main() {
  const buf = await readFile(FRONT);
  await mkdir('outputs', { recursive: true });

  // 1. Raw crop
  await sharp(buf)
    .extract(CROP)
    .jpeg({ quality: 95 })
    .toFile(join('outputs', 'gap_raw.jpg'));

  // 2. Current production enhancement: CLAHE(50,50) + normalise
  await sharp(buf)
    .extract(CROP)
    .clahe({ width: 50, height: 50, maxSlope: 3 })
    .normalise()
    .jpeg({ quality: 95 })
    .toFile(join('outputs', 'gap_clahe50.jpg'));

  // 3. More aggressive: smaller CLAHE tile + gamma pulled down
  await sharp(buf)
    .extract(CROP)
    .clahe({ width: 20, height: 20, maxSlope: 5 })
    .gamma(2.4)
    .normalise()
    .jpeg({ quality: 95 })
    .toFile(join('outputs', 'gap_aggressive.jpg'));

  // 4. Linear contrast stretch + slight blur reduction
  await sharp(buf)
    .extract(CROP)
    .linear(2.0, -180) // sharp contrast push, clip whites
    .sharpen({ sigma: 1.2 })
    .jpeg({ quality: 95 })
    .toFile(join('outputs', 'gap_linear.jpg'));

  // 5. Inverted (sometimes makes faint strokes pop)
  await sharp(buf)
    .extract(CROP)
    .negate()
    .normalise()
    .jpeg({ quality: 95 })
    .toFile(join('outputs', 'gap_negate.jpg'));

  console.log('Wrote outputs/gap_raw.jpg, gap_clahe50.jpg, gap_aggressive.jpg, gap_linear.jpg, gap_negate.jpg');
}

main().catch((e) => { console.error(e); process.exit(1); });
