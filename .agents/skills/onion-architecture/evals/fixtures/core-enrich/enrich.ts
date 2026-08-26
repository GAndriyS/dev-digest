import type { LLMProvider, Finding, EnrichedFinding } from '@devdigest/shared';
import { ENRICH_SCHEMA, buildEnrichMessages } from './prompts.js';

const ADVISORY_API = 'https://advisories.internal.acme.dev/v1/lookup';
const ADVISORY_TIMEOUT_MS = 4000;

export interface EnrichInput {
  findings: Finding[];
  /** Package names the pull request added or bumped, as they appear in the manifest. */
  changedPackages: string[];
  model: string;
}

/**
 * Adds the "is this already known" half to a security finding: the review pass
 * says what the code does wrong, the advisory lookup says whether the ecosystem
 * has already named it. A finding that matches a published advisory carries its
 * identifier, so the reviewer can decide with one click instead of one search.
 */
export async function enrichFindings(
  llm: LLMProvider,
  input: EnrichInput,
): Promise<EnrichedFinding[]> {
  const advisories = await lookupAdvisories(input.changedPackages);

  const result = await llm.completeStructured<{ findings: EnrichedFinding[] }>({
    model: input.model,
    schema: ENRICH_SCHEMA,
    schemaName: 'enriched_findings',
    messages: buildEnrichMessages(input.findings, advisories),
    temperature: 0,
  });

  return result.value.findings;
}

async function lookupAdvisories(packages: string[]): Promise<Record<string, string[]>> {
  if (packages.length === 0) return {};

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ADVISORY_TIMEOUT_MS);

  try {
    const res = await fetch(`${ADVISORY_API}?packages=${packages.join(',')}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return {};

    const json = (await res.json()) as { advisories?: Record<string, string[]> };
    return json.advisories ?? {};
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

export function summarizeSeverity(findings: EnrichedFinding[]): string {
  const critical = findings.filter((f) => f.severity === 'critical').length;
  const known = findings.filter((f) => f.advisoryIds.length > 0).length;
  return `${findings.length} findings · ${critical} critical · ${known} with a published advisory`;
}
