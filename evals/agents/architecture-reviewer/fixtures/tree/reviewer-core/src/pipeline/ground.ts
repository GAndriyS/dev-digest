import type { Finding } from "./types.js";

/** Grounding is mandatory: a finding whose file is not in the diff is dropped. */
export async function groundFindings(findings: Finding[], diff: string): Promise<Finding[]> {
  return findings.filter((f) => diff.includes(f.file));
}
