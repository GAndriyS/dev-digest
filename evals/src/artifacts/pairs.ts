/**
 * A/B PAIRS — an artifact and a frozen copy of it with exactly one dimension removed.
 *
 * The pair is the manipulation in a with-vs-without measurement: both variants are graded on the
 * same cases, so the only thing that may differ between them is the dimension under test. That
 * makes the pair a piece of MEASURING EQUIPMENT, and equipment drifts. The source is a live
 * artifact — someone will edit it — while its copy is frozen at the sha it was cut from, and a
 * delta measured across a drifted pair reports the drift, not the rule.
 *
 * Nothing in the repo could notice that: the warning lived in prose (`.claude/agents/README.md`,
 * an HTML comment in the variant), which is exactly the shape of rule this package exists to stop
 * trusting. So the pair is checked mechanically, twice over:
 *
 *   1. the SOURCE has not changed since the copy was cut (a hash of its normalised body), and
 *   2. the dimension is really gone from the copy and really present in the source — the
 *      2026-08-25 finding was that a cosmetic two-line edit measured noise (−20 on the target
 *      practice, −40 on an untouched control) while removing the dimension EVERYWHERE measured
 *      −80 with every control flat.
 *
 * Run by `pnpm eval:quality` and by `pairs.test.ts` next to this file (no model, no network).
 *
 * To re-sync after editing the source: copy it over the variant, remove the dimension again in
 * every place `variantMustNotContain` names, then update BOTH hashes here in the same commit.
 */

import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { AGENTS_DIR } from "./paths.js";

export interface ArtifactPair {
  /** The agent whose definition is the live one. */
  source: string;
  /** The frozen copy, graded against the source's own cases. */
  variant: string;
  /** What was removed from the variant — the dimension the A/B measures. */
  dimension: string;
  /** sha256 of the source's normalised body (frontmatter, HTML comments and blank runs stripped). */
  sourceSha: string;
  /** Same for the variant, so an edit to EITHER side surfaces. */
  variantSha: string;
  /** Strings that carry the dimension: present in the source, absent from the variant. */
  variantMustNotContain: string[];
}

export const PAIRS: ArtifactPair[] = [
  {
    source: "architecture-reviewer",
    variant: "architecture-reviewer-lite",
    dimension:
      "attribution — every finding must name the documented contract it breaks, with a locator",
    sourceSha: "db18d041c75b8a27738a617faa429ceca54f99701aa13a108fdc12cd17a04f6b",
    variantSha: "64b6897286c279f2299573db3f47278dd562418e9c4660feeba4929272f4f6f0",
    // One string per place the dimension appears. This list IS the definition of "removed
    // everywhere" — extend it whenever the source grows another citation requirement, or the next
    // measurement is again taken across a half-applied manipulation.
    variantMustNotContain: [
      "Quote the violated rule name", // Step 2 — the machine half
      "Do not carry a list of the rule names in your head", // Step 2 — read the config yourself
      "| Observation | Skill | Default severity |", // Step 3 — the per-observation Skill column
      "**Why:** <the rule, named, with its locator", // Return format — the rationale slot
    ],
  },
];

/** Body only: no frontmatter, no HTML comments, no runs of blank lines, trimmed. */
export function artifactBody(path: string): string {
  let md = readFileSync(path, "utf8").split("\r\n").join("\n");
  if (md.startsWith("---")) {
    const end = md.indexOf("\n---", 3);
    if (end !== -1) md = md.slice(end + 4);
  }
  return md
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

/** Everything wrong with one pair, as human-readable lines. Empty array = the pair is sound. */
export function checkPair(pair: ArtifactPair): string[] {
  const issues: string[] = [];
  const sourcePath = join(AGENTS_DIR, `${pair.source}.md`);
  const variantPath = join(AGENTS_DIR, `${pair.variant}.md`);
  for (const [name, p] of [
    [pair.source, sourcePath],
    [pair.variant, variantPath],
  ] as const) {
    if (!existsSync(p)) issues.push(`${name}.md not found — the pair is incomplete`);
  }
  if (issues.length) return issues;

  const source = artifactBody(sourcePath);
  const variant = artifactBody(variantPath);

  if (sha256(source) !== pair.sourceSha) {
    issues.push(
      `${pair.source}.md changed since ${pair.variant}.md was cut from it — re-sync the variant ` +
        `(remove: ${pair.dimension}), then set sourceSha to ${sha256(source)}`,
    );
  }
  if (sha256(variant) !== pair.variantSha) {
    issues.push(
      `${pair.variant}.md changed outside a re-sync — if that was deliberate, set variantSha to ` +
        `${sha256(variant)}; any measurement taken before this edit no longer describes it`,
    );
  }
  for (const marker of pair.variantMustNotContain) {
    if (!source.includes(marker)) {
      issues.push(
        `marker missing from ${pair.source}.md: "${marker}" — the manipulation is defined against ` +
          `text that no longer exists, so the pair proves nothing`,
      );
    }
    if (variant.includes(marker)) {
      issues.push(
        `${pair.variant}.md still carries the dimension: "${marker}" — a partial removal measures ` +
          `noise (measured 2026-08-25: −20 on the target practice, −40 on an untouched control)`,
      );
    }
  }
  return issues;
}

/** All pairs at once — `[label, issues]`, including the sound ones (empty array). */
export function checkPairs(): Array<[string, string[]]> {
  return PAIRS.map((p) => [`${p.variant} <- ${p.source}`, checkPair(p)]);
}
