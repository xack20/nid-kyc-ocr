/** Extracts the first JSON object from a string that may contain surrounding text. */
export function extractJson(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`No JSON object found in response. Preview: "${text.slice(0, 300)}"`);
  }
  return JSON.parse(match[0]);
}
