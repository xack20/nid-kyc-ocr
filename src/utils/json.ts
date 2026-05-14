/**
 * Robustly extracts and parses the first complete JSON object from a string.
 *
 * Handles:
 * - Leading/trailing prose or markdown around the JSON
 * - Multiple JSON objects in the string (takes the first complete one)
 * - Trailing commas inside objects/arrays (common model error)
 * - JSON followed by extra text after the closing brace
 */
export function extractJson(text: string): unknown {
  if (!text || !text.trim()) {
    throw new Error(`No JSON object found in response. Preview: "${text?.slice(0, 300) ?? ''}"`);
  }

  // Find the first opening brace
  const start = text.indexOf('{');
  if (start === -1) {
    throw new Error(`No JSON object found in response. Preview: "${text.slice(0, 300)}"`);
  }

  // Walk forward tracking brace depth to find the matching close brace
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        // Found the matching close brace — extract and parse
        const candidate = text.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          // Try cleaning trailing commas before arrays/objects close
          const cleaned = candidate
            .replace(/,\s*([\]}])/g, '$1');
          return JSON.parse(cleaned);
        }
      }
    }
  }

  throw new Error(`No complete JSON object found in response. Preview: "${text.slice(0, 300)}"`);
}
