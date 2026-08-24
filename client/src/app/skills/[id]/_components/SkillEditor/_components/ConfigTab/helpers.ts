/**
 * Deterministic client-side token estimate for the body text currently in the
 * field (AC-19), including unsaved keystrokes — no network call, no model.
 * Same approximation the server uses for stored context documents
 * (`estimateTokens` in `server/src/modules/context/helpers.ts`,
 * `BYTES_PER_TOKEN_EST = 4`): `max(1, ceil(length / 4))`. The one deliberate
 * difference is what "length" counts — the client measures JS string length
 * (UTF-16 code units, i.e. characters), the server measures UTF-8 bytes. They
 * agree on ASCII bodies and drift apart on multi-byte text; the "≈" in the
 * label (`config.bodyTokens`) is what covers that gap, not exactness.
 */
export function estimateBodyTokens(body: string): number {
  if (body.length === 0) return 0;
  return Math.max(1, Math.ceil(body.length / 4));
}
