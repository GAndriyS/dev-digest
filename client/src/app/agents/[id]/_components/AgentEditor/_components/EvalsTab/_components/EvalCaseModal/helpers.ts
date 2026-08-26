/** Pretty-printed starting text for the expected-output textarea — an empty
    `must_not_flag` shape for a new case, or the case's own stored value
    round-tripped through JSON.stringify for an existing one. */
export function stringifyExpectedOutput(value: unknown): string {
  return JSON.stringify(value ?? { findings: [] }, null, 2);
}

export type ParsedJson = { ok: true; value: unknown } | { ok: false };

/** AC-10: the JSON-validity check the modal keys its indicator and its
    Save-blocking off. Never throws — a parse failure is a normal, expected
    result here, not an error state. */
export function parseExpectedOutput(text: string): ParsedJson {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}
