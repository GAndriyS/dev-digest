/**
 * Prompt-budget helpers shared by the LLM features (conventions, onboarding).
 * One truncation rule so the ellipsis marker and "keep the head" strategy
 * cannot drift between modules.
 */

/** Keep the first `maxChars` characters and mark the cut with an ellipsis line. */
export function clipHead(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n…`;
}
