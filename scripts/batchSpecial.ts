/**
 * Batch extraction on the special front+back paired folders.
 *
 * Usage:
 *   npx tsx scripts/batchSpecial.ts [--dir <path>] [--mode <mode>]
 *
 * Defaults: --dir ./nid_images/special  --mode combined
 *
 * Each subdirectory must contain a front.* and back.* image file.
 */
import 'dotenv/config';
import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { join, extname }                        from 'path';
import minimist                                  from 'minimist';
import { createStrategy }                        from '../src/strategies/index.js';
import { EXTRACTION_MODES }                      from '../src/core/types.js';
import type { ExtractionMode, NidImage }         from '../src/core/types.js';
import { mimeFromExt }                           from '../src/utils/mime.js';
import { ts }                                    from '../src/utils/timestamp.js';

const SUPPORTED = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);

const args = minimist(process.argv.slice(2), {
  string:  ['dir', 'mode'],
  default: { dir: './nid_images/special', mode: 'combined' },
});

const SPECIAL_DIR = args['dir'] as string;
const mode        = args['mode'] as ExtractionMode;
const RUN_TS      = ts();
const OUTPUT_DIR  = `./outputs/special_${RUN_TS}`;

if (!EXTRACTION_MODES.includes(mode)) {
  console.error(`Invalid mode "${mode}". Allowed: ${EXTRACTION_MODES.join(', ')}`);
  process.exit(1);
}

async function findSide(dir: string, side: 'front' | 'back'): Promise<{ path: string; mime: string } | null> {
  const files = await readdir(dir);
  const match = files.find((f) => {
    const lower = f.toLowerCase();
    return SUPPORTED.has(extname(lower)) && lower.includes(side);
  });
  if (!match) return null;
  return { path: join(dir, match), mime: mimeFromExt(extname(match)) };
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const pairs = (await readdir(SPECIAL_DIR, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => Number(a) - Number(b));

  console.log(`\nDirectory : ${SPECIAL_DIR}`);
  console.log(`Mode      : ${mode}`);
  console.log(`Pairs     : ${pairs.length}`);
  console.log(`Output    : ${OUTPUT_DIR}\n`);

  const summary: object[] = [];

  for (const pairId of pairs) {
    const pairDir = join(SPECIAL_DIR, pairId);
    const outFile = join(OUTPUT_DIR, `pair_${pairId}.json`);

    console.log(`\n${'─'.repeat(64)}`);
    console.log(`Pair ${pairId}`);

    const frontInfo = await findSide(pairDir, 'front');
    const backInfo  = await findSide(pairDir, 'back');

    if (!frontInfo) {
      console.error('  No front image — skipping');
      summary.push({ pairId, status: 'error', error: 'No front image found' });
      continue;
    }

    console.log(`  Front : ${frontInfo.path}`);
    console.log(`  Back  : ${backInfo?.path ?? '(none)'}`);

    try {
      const images: NidImage[] = [
        { buffer: await readFile(frontInfo.path), mimeType: frontInfo.mime, side: 'front' },
        ...(backInfo ? [{ buffer: await readFile(backInfo.path), mimeType: backInfo.mime, side: 'back' as const }] : []),
      ];

      const result = await createStrategy(mode).extract(images);

      // ── Timing breakdown ────────────────────────────────────────
      const { timing, geminiCallCount, extraction } = result;
      console.log(`  Timing: Vision ${timing.visionTotalMs}ms | Gemini ${timing.geminiTotalMs}ms | Total ${timing.totalFormatted} | Calls ${geminiCallCount}`);

      // ── Extraction summary ──────────────────────────────────────
      if (extraction) {
        console.log(`  Card  : ${extraction.cardType}  [${extraction.overallConfidence.toUpperCase()}]`);
        console.log(`  NID   : ${extraction.nidNumber.value ?? 'N/A'}  [${extraction.nidNumber.confidence}]`);
        console.log(`  Name  : ${extraction.nameEn.value ?? 'N/A'}  /  ${extraction.nameBn.value ?? 'N/A'}`);
        console.log(`  DOB   : ${extraction.dateOfBirth.value ?? 'N/A'}`);
        console.log(`  Father: ${extraction.fatherNameBn.value ?? 'N/A'}  [${extraction.fatherNameBn.confidence}]`);
        console.log(`  Mother: ${extraction.motherNameBn.value ?? 'N/A'}  [${extraction.motherNameBn.confidence}]`);
        console.log(`  Addr  : ${extraction.addressBn.value ?? 'N/A'}  [${extraction.addressBn.confidence}]`);
        console.log(`  Blood : ${extraction.bloodGroup.value ?? 'N/A'}  [${extraction.bloodGroup.confidence}]`);
        console.log(`  Issue : ${extraction.issueDate.value ?? 'N/A'}`);
        if (extraction.fieldsNeedingReview.length > 0) {
          console.log(`  Review: ${extraction.fieldsNeedingReview.join(', ')}`);
        }
      }

      await writeFile(outFile, JSON.stringify({ pairId, extractionMode: mode, frontImage: frontInfo.path, backImage: backInfo?.path ?? null, ...result }, null, 2), 'utf-8');

      const e = result.extraction;
      summary.push({
        pairId, status: 'ok', hasBothSides: !!backInfo,
        totalMs: timing.totalMs,
        ...(e ? {
          cardType: e.cardType, overallConfidence: e.overallConfidence,
          nidNumber: e.nidNumber.value, nameEn: e.nameEn.value, nameBn: e.nameBn.value,
          dateOfBirth: e.dateOfBirth.value, fatherNameBn: e.fatherNameBn.value,
          motherNameBn: e.motherNameBn.value, addressBn: e.addressBn.value,
          bloodGroup: e.bloodGroup.value, issueDate: e.issueDate.value,
          fieldsNeedingReview: e.fieldsNeedingReview,
        } : {}),
      });

    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`  ERROR: ${error}`);
      await writeFile(outFile, JSON.stringify({ pairId, error }, null, 2), 'utf-8');
      summary.push({ pairId, status: 'error', error });
    }
  }

  const summaryFile = join(OUTPUT_DIR, '_summary.json`');
  await writeFile(summaryFile, JSON.stringify(summary, null, 2), 'utf-8');

  const ok = summary.filter((r: any) => r.status === 'ok').length;
  console.log(`\n${'─'.repeat(64)}`);
  console.log(`Done. ${ok}/${pairs.length} succeeded.`);
  console.log(`Summary → ${summaryFile}`);
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
