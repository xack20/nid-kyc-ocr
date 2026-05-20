/**
 * Batch extraction on a directory recursively (auto-detecting sides).
 *
 * Usage:
 *   npx tsx scripts/batchRecursive.ts [--dir <path>] [--mode <mode>]
 *
 * Defaults: --dir ./nid_images/both_side_combined  --mode smart
 */
import 'dotenv/config';
import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { join, extname, basename, relative }    from 'path';
import minimist                                 from 'minimist';
import { createStrategy }                       from '../src/strategies/index.js';
import { EXTRACTION_MODES }                     from '../src/core/types.js';
import type { ExtractionMode, NidImage }        from '../src/core/types.js';
import { mimeFromExt }                          from '../src/utils/mime.js';
import { ts }                                   from '../src/utils/timestamp.js';

const SUPPORTED = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);

const args = minimist(process.argv.slice(2), {
  string:  ['dir', 'mode'],
  default: { dir: './nid_images/both_side_combined', mode: 'smart' },
});

const IMAGE_DIR  = args['dir'] as string;
const mode       = args['mode'] as ExtractionMode;
const RUN_TS     = ts();
const OUTPUT_DIR = `./outputs/batch_recursive_${mode}_${RUN_TS}`;

if (!EXTRACTION_MODES.includes(mode)) {
  console.error(`Invalid mode "${mode}". Allowed: ${EXTRACTION_MODES.join(', ')}`);
  process.exit(1);
}

async function getFilesRecursive(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const res = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await getFilesRecursive(res)));
    } else if (entry.isFile() && SUPPORTED.has(extname(entry.name).toLowerCase())) {
      files.push(res);
    }
  }

  return files;
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const files = await getFilesRecursive(IMAGE_DIR);
  files.sort();

  console.log(`\nDirectory : ${IMAGE_DIR}`);
  console.log(`Mode      : ${mode}`);
  console.log(`Images    : ${files.length}`);
  console.log(`Output    : ${OUTPUT_DIR}\n`);

  if (files.length === 0) {
    console.log('No supported images found in directory.');
    return;
  }

  const summary: object[] = [];

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    const relPath  = relative(IMAGE_DIR, filePath);
    // Flatten subdirectory structure in filenames for saving output to single output directory
    const flattenedName = relPath.replace(/[\/\\]/g, '__');
    const outFile  = join(OUTPUT_DIR, `${flattenedName}.json`);

    console.log(`[${i + 1}/${files.length}] Processing: ${relPath}`);

    try {
      const images: NidImage[] = [{
        buffer:   await readFile(filePath),
        mimeType: mimeFromExt(extname(filePath)),
        side:     'unknown', // Enable smart auto-detection
      }];

      const result = await createStrategy(mode).extract(images);

      await writeFile(outFile, JSON.stringify({ file: relPath, filePath, extractionMode: mode, ...result }, null, 2), 'utf-8');

      const e = result.extraction;
      console.log(
        `  ✓ [${result.timing.totalFormatted}]  ${e?.overallConfidence?.toUpperCase() ?? 'RAW'}` +
        (e ? `  NID: ${e.nidNumber.value ?? '?'}  Name: ${e.nameEn.value ?? '?'}` : ''),
      );

      summary.push({
        file: relPath,
        filePath,
        status:  'ok',
        totalMs: result.timing.totalMs,
        ...(e ? {
          cardType:            e.cardType,
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
          placeOfBirth:        e.placeOfBirth.value,
          validUntil:          e.validUntil.value,
          fieldsNeedingReview: e.fieldsNeedingReview,
          qualityIssues:       e.qualityIssues,
          suggestions:         e.suggestions,
        } : {}),
      });

    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ERROR on ${relPath}: ${error}`);
      await writeFile(outFile, JSON.stringify({ file: relPath, filePath, error }, null, 2), 'utf-8');
      summary.push({ file: relPath, filePath, status: 'error', error });
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
