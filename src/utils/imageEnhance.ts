import sharp from 'sharp';

/**
 * CLAHE (Contrast-Limited Adaptive Histogram Equalization) recovers detail
 * from over-exposed regions caused by flash, glare, or specular reflection.
 *
 *   tile size  ≈ 50 px works well at NID-field scale
 *   maxSlope=3 prevents extreme amplification of noise in already-flat regions
 *
 * Followed by .normalise() to stretch the global histogram so dim sides come up.
 * Emitted as JPEG q=92 — same quality as imageCrop.ts so the Files API payload
 * stays comparable across modes.
 */
export async function enhanceForGlareRecovery(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .clahe({ width: 50, height: 50, maxSlope: 3 })
    .normalise()
    .jpeg({ quality: 92 })
    .toBuffer();
}

/**
 * Aggressive enhancement for gap-detected crops where the glare strip is narrow
 * (~26–40 px tall). Smaller CLAHE tiles (20 px) prevent the equalization from
 * averaging across the strip height, preserving fine stroke detail. Gamma
 * pull-down (2.4) pushes bright midtones toward grey, revealing strokes that
 * sit just below the clipping threshold.
 *
 * Visual finding from gap_aggressive.jpg: more texture inside the glare blob
 * and the "ৎ" character at the right edge is better resolved than with tile=50.
 */
export async function enhanceForGapRecovery(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .clahe({ width: 20, height: 20, maxSlope: 5 })
    .gamma(2.4)
    .normalise()
    .jpeg({ quality: 95 })
    .toBuffer();
}

/**
 * Negation + normalise: inverts pixel intensities so the bright glare zone
 * becomes dark and surviving letter strokes (which were darker than the glare)
 * become light/visible against a dark background.
 *
 * Visual finding from gap_negate.jpg: the "ৎ" character at the right edge of
 * the glare zone becomes clearly legible after negation, whereas it was
 * partially buried in the bright zone in the raw and CLAHE variants.
 */
export async function enhanceNegatedForGap(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .negate()
    .normalise()
    .jpeg({ quality: 95 })
    .toBuffer();
}
