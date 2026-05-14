/**
 * Inspect raw Cloud Vision documentTextDetection response.
 * Usage: npx tsx scripts/inspectVision.ts --front <path>
 */
import 'dotenv/config';
import { readFile }               from 'fs/promises';
import { extname }                from 'path';
import minimist                   from 'minimist';
import { ImageAnnotatorClient }   from '@google-cloud/vision';
import { mimeFromExt }            from '../src/utils/mime.js';

const args = minimist(process.argv.slice(2), { string: ['front'] });
const frontPath: string = args['front'];

if (!frontPath) {
  console.error('Usage: npx tsx scripts/inspectVision.ts --front <path>');
  process.exit(1);
}

const client = new ImageAnnotatorClient();

async function main() {
  const buffer = await readFile(frontPath);
  const [result] = await client.documentTextDetection({
    image:        { content: buffer },
    imageContext: { languageHints: ['bn', 'en'] },
  });

  console.log('\n══ 1. FULL TEXT (fullTextAnnotation.text) ═════════════════════');
  console.log(result.fullTextAnnotation?.text ?? '(none)');

  console.log('\n══ 2. PAGES / BLOCKS / PARAGRAPHS / WORDS ════════════════════');
  const pages = result.fullTextAnnotation?.pages ?? [];
  console.log(`Pages: ${pages.length}`);

  for (const [pi, page] of pages.entries()) {
    console.log(`\n  Page ${pi + 1}  (${page.width}×${page.height})`);
    console.log(`  Blocks: ${page.blocks?.length ?? 0}`);

    for (const [bi, block] of (page.blocks ?? []).entries()) {
      console.log(`\n    Block ${bi + 1}  [type: ${block.blockType}]`);
      console.log(`    Confidence: ${((block.confidence ?? 0) * 100).toFixed(1)}%`);
      console.log(`    Bounding box: ${JSON.stringify(block.boundingBox?.vertices)}`);

      for (const [pri, para] of (block.paragraphs ?? []).entries()) {
        const words = para.words ?? [];
        const paraText = words
          .map(w => w.symbols?.map(s => s.text).join(''))
          .join(' ');
        console.log(`      Para ${pri + 1}: "${paraText.slice(0, 120)}"`);
        console.log(`      Words: ${words.length}  |  Confidence: ${((para.confidence ?? 0) * 100).toFixed(1)}%`);

        // Show first 3 words with per-symbol confidence
        for (const word of words.slice(0, 3)) {
          const wordText = word.symbols?.map(s => s.text).join('') ?? '';
          const symbolConf = word.symbols?.map(s => ((s.confidence ?? 0) * 100).toFixed(0) + '%').join(' ');
          console.log(`        Word: "${wordText}"  symbols conf: [${symbolConf}]`);
        }
      }
    }
  }

  console.log('\n══ 3. TEXT ANNOTATIONS (simpler bounding-box list) ════════════');
  const annotations = result.textAnnotations ?? [];
  console.log(`Total annotations: ${annotations.length}`);
  console.log('First 8 (each is a detected text segment with bounding box):');
  for (const ann of annotations.slice(0, 8)) {
    console.log(`  "${ann.description}"  →  ${JSON.stringify(ann.boundingPoly?.vertices)}`);
  }

  console.log('\n══ 4. DETECTED LANGUAGES ══════════════════════════════════════');
  for (const page of pages) {
    const langs = page.property?.detectedLanguages ?? [];
    for (const l of langs) {
      console.log(`  ${l.languageCode}  confidence: ${((l.confidence ?? 0) * 100).toFixed(1)}%`);
    }
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
