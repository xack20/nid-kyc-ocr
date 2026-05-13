/**
 * Batch extraction on a directory of NID images (front-only).
 *
 * Usage:
 *   npx tsx scripts/batch.ts [--dir <path>] [--mode <mode>]
 *
 * Defaults: --dir ./nid_images/others  --mode combined
 */
import 'dotenv/config';
import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { join, extname, basename }             from 'path';
import minimist                                 from 'minimist';
import { createStrategy }                       from '../src/strategies/index.js';
import { EXTRACTION_MODES }                     from '../src/core/types.js';
import type { ExtractionMode, NidImage }        from '../src/core/types.js';
import { mimeFromExt }                          from '../src/utils/mime.js';
import { ts }                                   from '../src/utils/timestamp.js';

const SUPPORTED = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);

const args = minimist(process.argv.slice(2), {
  string:  ['dir', 'mode'],
  default: { dir: './nid_images/others', mode: 'combined' },
});

const IMAGE_DIR  = args['dir'] as string;
const mode       = args['mode'] as ExtractionMode;
const RUN_TS     = ts();
const OUTPUT_DIR = `./outputs/batch_${mode}_${RUN_TS}`;

if (!EXTRACTION_MODES.includes(mode)) {
  console.error(`Invalid mode "${mode}". Allowed: ${EXTRACTION_MODES.join(', ')}`);
  process.exit(1);
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const files = (await readdir(IMAGE_DIR))
    .filter((f) => SUPPORTED.has(extname(f).toLowerCase()))
    .sort();

  console.log(`\nDirectory : ${IMAGE_DIR}`);
  console.log(`Mode      : ${mode}`);
  console.log(`Images    : ${files.length}`);
  console.log(`Output    : ${OUTPUT_DIR}\n`);

  const summary: object[] = [];

  for (const file of files) {
    const filePath = join(IMAGE_DIR, file);
    const outFile  = join(OUTPUT_DIR, `${basename(file)}.json`);

    console.log(`Processing: ${file}`);

    try {
      const images: NidImage[] = [{
        buffer:   await readFile(filePath),
        mimeType: mimeFromExt(extname(file)),
        side:     'front',
      }];

      const result = await createStrategy(mode).extract(images);

      await writeFile(outFile, JSON.stringify({ file, extractionMode: mode, ...result }, null, 2), 'utf-8');

      const e = result.extraction;
      console.log(
        `  ✓ [${result.timing.totalFormatted}]  ${e?.overallConfidence?.toUpperCase() ?? 'RAW'}` +
        (e ? `  NID: ${e.nidNumber.value ?? '?'}  Name: ${e.nameEn.value ?? '?'}` : ''),
      );

      summary.push({
        file,
        status:  'ok',
        totalMs: result.timing.totalMs,
        ...(e ? {
          overallConfidence:   e.overallConfidence,
          nidNumber:           e.nidNumber.value,
          nameEn:              e.nameEn.value,
          nameBn:              e.nameBn.value,
          dateOfBirth:         e.dateOfBirth.value,
          fatherNameBn:        e.fatherNameBn.value,
          motherNameBn:        e.motherNameBn.value,
          addressBn:           e.addressBn.value,
          bloodGroup:          e.bloodGroup.value,
          issueDate:           e.issueDate.value,
          fieldsNeedingReview: e.fieldsNeedingReview,
        } : {}),
      });

    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ERROR: ${error}`);
      await writeFile(outFile, JSON.stringify({ file, error }, null, 2), 'utf-8');
      summary.push({ file, status: 'error', error });
    }
  }

  const summaryFile = join(OUTPUT_DIR, '_summary.json');
  await writeFile(summaryFile, JSON.stringify(summary, null, 2), 'utf-8');

  const ok = summary.filter((r: any) => r.status === 'ok').length;
  console.log(`\nDone. ${ok}/${files.length} succeeded.`);
  console.log(`Summary → ${summaryFile}`);
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
