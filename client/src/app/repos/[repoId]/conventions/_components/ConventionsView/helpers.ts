import type { ConventionCandidate } from "@devdigest/shared";

/** Pure helpers for the conventions view. */

export function acceptedOf(list: ConventionCandidate[]): ConventionCandidate[] {
  return list.filter((c) => c.status === "accepted");
}

/** Pending first — the ones still needing a decision are the work. */
export function sortForReview(list: ConventionCandidate[]): ConventionCandidate[] {
  const rank = (s: ConventionCandidate["status"]) =>
    s === "pending" ? 0 : s === "accepted" ? 1 : 2;
  return [...list].sort((a, b) => rank(a.status) - rank(b.status));
}

/** `acme/payments-api` → `payments-api`; used for the default skill name. */
export function repoSlug(fullName: string): string {
  const [, name] = fullName.split("/");
  return name ?? fullName;
}

export function defaultSkillName(fullName: string): string {
  return `${repoSlug(fullName)}-conventions`;
}

/**
 * Merge accepted candidates into one skill body.
 *
 * The evidence travels with the rule on purpose: an agent reading this body gets
 * the house rule AND a real example of the shape being described, and a human
 * auditing the skill later can check the citation without re-running the scan.
 * `file:line` is written as text rather than a link because the body is a prompt,
 * not a document — the model reads it as data.
 */
export function buildConventionsSkill(
  fullName: string,
  accepted: ConventionCandidate[],
): string {
  const header =
    `# ${defaultSkillName(fullName)}\n\n` +
    `House conventions for \`${fullName}\`. Flag changes that violate any rule ` +
    `below and cite the offending \`file:line\`.\n`;

  const sections = accepted.map((c) => {
    const where =
      c.evidence_path.length > 0
        ? `\nDetected in \`${c.evidence_path}${c.evidence_line != null ? `:${c.evidence_line}` : ""}\`:\n\n\`\`\`\n${c.evidence_snippet}\n\`\`\`\n`
        : "";
    return `\n## ${c.category}\n\n${c.rule}\n${where}`;
  });

  return `${header}${sections.join("")}`;
}
