/**
 * Run extraction on a single NID image (or front+back pair).
 *
 * Usage:
 *   npx tsx scripts/runOne.ts --front <path> [--back <path>] [--mode <mode>]
 *
 * Modes: gemini_only | vision_only | vision_fed_gemini | gemini_with_vision_tool | combined (default)
 */
import 'dotenv/config';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { extname, basename, join }    from 'path';
import minimist                        from 'minimist';
import { createStrategy }              from '../src/strategies/index.js';
import { EXTRACTION_MODES }            from '../src/core/types.js';
import type { ExtractionMode, NidImage } from '../src/core/types.js';
import { mimeFromExt }                 from '../src/utils/mime.js';
import { ts }                          from '../src/utils/timestamp.js';

const args = minimist(process.argv.slice(2), {
  string:  ['front', 'back', 'mode'],
  default: { mode: 'combined' },
});

const frontPath: string | undefined = args['front'];
const backPath:  string | undefined = args['back'];
const mode = args['mode'] as ExtractionMode;

if (!frontPath) {
  console.error('Usage: npx tsx scripts/runOne.ts --front <path> [--back <path>] [--mode <mode>]');
  console.error(`Modes: ${EXTRACTION_MODES.join(' | ')}`);
  process.exit(1);
}

if (!EXTRACTION_MODES.includes(mode)) {
  console.error(`Invalid mode "${mode}". Allowed: ${EXTRACTION_MODES.join(', ')}`);
  process.exit(1);
}

async function main() {
  const images: NidImage[] = [
    {
      buffer:   await readFile(frontPath!),
      mimeType: mimeFromExt(extname(frontPath!)),
      side:     'front',
    },
  ];

  if (backPath) {
    images.push({
      buffer:   await readFile(backPath),
      mimeType: mimeFromExt(extname(backPath)),
      side:     'back',
    });
  }

  console.log(`\nMode    : ${mode}`);
  console.log(`Front   : ${frontPath}`);
  if (backPath) console.log(`Back    : ${backPath}`);
  console.log('─'.repeat(64));

  const result = await createStrategy(mode).extract(images);

  // ── Console output ────────────────────────────────────────────────
  const { timing, geminiCallCount, extraction, visionOutputs } = result;

  console.log('\n── Timing ─────────────────────────────────────────────────');
  for (const [name, step] of Object.entries(timing.steps)) {
    const calls = step.callCount ? ` (×${step.callCount})` : '';
    console.log(`  ${name.padEnd(32)} ${step.formatted}${calls}`);
  }
  console.log(`  ${'Vision total'.padEnd(32)} ${String(timing.visionTotalMs).padStart(6)}ms`);
  console.log(`  ${'Gemini total'.padEnd(32)} ${String(timing.geminiTotalMs).padStart(6)}ms`);
  console.log(`  ${'TOTAL'.padEnd(32)} ${timing.totalFormatted}`);
  console.log(`  Gemini calls: ${geminiCallCount}`);

  if (visionOutputs.length > 0) {
    console.log('\n── Cloud Vision Raw Text ──────────────────────────────────');
    for (const vo of visionOutputs) {
      console.log(`  [${vo.side}] ${vo.rawText || '(nothing detected)'}`);
    }
  }

  if (extraction) {
    console.log('\n── Extraction ─────────────────────────────────────────────');
    console.log(`  Card type     : ${extraction.cardType}`);
    console.log(`  NID number    : ${extraction.nidNumber.value ?? 'N/A'}  [${extraction.nidNumber.confidence}]`);
    console.log(`  Name (EN)     : ${extraction.nameEn.value ?? 'N/A'}  [${extraction.nameEn.confidence}]`);
    console.log(`  Name (BN)     : ${extraction.nameBn.value ?? 'N/A'}  [${extraction.nameBn.confidence}]`);
    console.log(`  Date of birth : ${extraction.dateOfBirth.value ?? 'N/A'}  [${extraction.dateOfBirth.confidence}]`);
    console.log(`  Father (BN)   : ${extraction.fatherNameBn.value ?? 'N/A'}  [${extraction.fatherNameBn.confidence}]`);
    console.log(`  Mother (BN)   : ${extraction.motherNameBn.value ?? 'N/A'}  [${extraction.motherNameBn.confidence}]`);
    console.log(`  Address (BN)  : ${extraction.addressBn.value ?? 'N/A'}  [${extraction.addressBn.confidence}]`);
    console.log(`  Blood group   : ${extraction.bloodGroup.value ?? 'N/A'}  [${extraction.bloodGroup.confidence}]`);
    console.log(`  Issue date    : ${extraction.issueDate.value ?? 'N/A'}  [${extraction.issueDate.confidence}]`);
    console.log(`  Place of Birth: ${extraction.placeOfBirth.value ?? 'N/A'}  [${extraction.placeOfBirth.confidence}]`);
    console.log(`  Overall       : ${extraction.overallConfidence.toUpperCase()}`);
    if (extraction.fieldsNeedingReview.length > 0) {
      console.log(`  Needs review  : ${extraction.fieldsNeedingReview.join(', ')}`);
    }
  }

  // ── Save output ───────────────────────────────────────────────────
  const OUTPUT_DIR = './outputs';
  await mkdir(OUTPUT_DIR, { recursive: true });
  const outFile = join(OUTPUT_DIR, `${basename(frontPath!)}_${mode}_${ts()}.json`);
  await writeFile(outFile, JSON.stringify({ frontPath, backPath: backPath ?? null, ...result }, null, 2), 'utf-8');
  console.log(`\nSaved → ${outFile}`);
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
