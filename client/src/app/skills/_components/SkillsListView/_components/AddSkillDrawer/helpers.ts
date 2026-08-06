/** First ATX markdown heading in a body, without its `#`s. "" when there is none. */
export function deriveNameFromBody(body: string): string {
  for (const line of body.split("\n")) {
    const match = /^\s{0,3}(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (match?.[2]) return match[2].trim();
  }
  return "";
}

/**
 * The name the skill will actually be created with: what was typed, else the
 * body's first heading (what `file.nameHint` promises).
 */
export function resolveSkillName(name: string, body: string): string {
  return name.trim() || deriveNameFromBody(body);
}
