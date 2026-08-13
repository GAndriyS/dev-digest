import { z } from 'zod';
import {
  DEFAULT_CONVENTIONS_LIMIT,
  DEFAULT_FINDINGS_LIMIT,
  MAX_CONVENTIONS_LIMIT,
  MAX_FINDINGS_LIMIT,
} from './constants.js';

/**
 * The five tools' input/output Zod schemas — the edge validation for this
 * package (the analogue of a Fastify route schema, plan decision 8). Every
 * object is `.strict()` so an unknown argument is rejected instead of being
 * silently dropped.
 *
 * `inputSchema` is handed the STRICT ZodObject itself, never `Schema.shape`,
 * and that is load-bearing: from a raw shape the SDK rebuilds a plain
 * `z.object(...)`, which is non-strict, and zod objects strip unknown keys —
 * so `.shape` would leave `additionalProperties:false` in the advertised JSON
 * Schema while runtime quietly accepted (and dropped) a typo'd argument. SDK
 * >= 1.30 accepts either form and passes a schema instance through untouched.
 * `outputSchema` keeps `.shape`; each handler parses with the strict object
 * before returning anyway. See mcp/INSIGHTS.md.
 *
 * `.describe()` texts here are verbatim from the plan — they ARE the budget
 * (~400 tokens measured across all five tool descriptions + fields).
 */

// ---- Shared building blocks ------------------------------------------------

export const SeverityCounts = z.object({
  critical: z.number().int(),
  warning: z.number().int(),
  suggestion: z.number().int(),
});
export type SeverityCounts = z.infer<typeof SeverityCounts>;

export const FindingSummary = z.object({
  severity: z.string(),
  category: z.string(),
  title: z.string(),
  file: z.string(),
  lines: z.string(),
  agent: z.string().nullable(),
  confidence: z.number(),
  rationale: z.string(),
  suggestion: z.string().optional(),
});
export type FindingSummary = z.infer<typeof FindingSummary>;

// ---- list_agents ------------------------------------------------------------

export const ListAgentsInput = z
  .object({
    enabled_only: z
      .boolean()
      .default(true)
      .describe('Only agents that a run without an explicit agent would execute (default true).'),
  })
  .strict();
export type ListAgentsInput = z.infer<typeof ListAgentsInput>;

export const AgentSummary = z.object({
  name: z.string(),
  description: z.string(),
  provider: z.string(),
  model: z.string(),
  enabled: z.boolean(),
  strategy: z.string(),
  ci_fail_on: z.string(),
});
export type AgentSummary = z.infer<typeof AgentSummary>;

export const ListAgentsOutput = z
  .object({
    count: z.number().int(),
    agents: z.array(AgentSummary),
    truncated: z.boolean().optional(),
    message: z.string().optional(),
  })
  .strict();
export type ListAgentsOutput = z.infer<typeof ListAgentsOutput>;

// ---- run_agent_on_pr ---------------------------------------------------------

export const RunAgentOnPrInput = z
  .object({
    repo: z.string().describe('Repository as "owner/name".'),
    pr: z.number().int().describe('Pull request number (the GitHub #number, not an internal id).'),
    agent: z
      .string()
      .optional()
      .describe('Agent name from list_agents; omit to run all enabled agents.'),
  })
  .strict();
export type RunAgentOnPrInput = z.infer<typeof RunAgentOnPrInput>;

export const AgentRunOutcome = z.object({
  agent: z.string(),
  status: z.string(),
  verdict: z.string().nullable(),
  score: z.number().int().nullable(),
  findings_count: z.number().int(),
  error: z.string().optional(),
});
export type AgentRunOutcome = z.infer<typeof AgentRunOutcome>;

export const RunAgentOnPrOutput = z
  .object({
    status: z.enum(['completed', 'partial', 'timeout']),
    verdict: z.string().nullable(),
    score: z.number().int().nullable(),
    counts: SeverityCounts,
    agents_run: z.array(AgentRunOutcome),
    findings: z.array(FindingSummary),
    truncated: z.boolean().optional(),
    message: z.string().optional(),
  })
  .strict();
export type RunAgentOnPrOutput = z.infer<typeof RunAgentOnPrOutput>;

// ---- get_findings -------------------------------------------------------------

export const GetFindingsInput = z
  .object({
    repo: z.string().describe('Repository as "owner/name".'),
    pr: z.number().int().describe('Pull request number (the GitHub #number, not an internal id).'),
    severity: z
      .enum(['CRITICAL', 'WARNING', 'SUGGESTION'])
      .optional()
      .describe('Only findings of this severity (CRITICAL | WARNING | SUGGESTION); omit for all.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_FINDINGS_LIMIT)
      .default(DEFAULT_FINDINGS_LIMIT)
      .describe('Max findings per page, 1-100 (default 20).'),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe('Findings to skip for pagination (default 0).'),
  })
  .strict();
export type GetFindingsInput = z.infer<typeof GetFindingsInput>;

export const GetFindingsOutput = z
  .object({
    pr: z.string(),
    total: z.number().int(),
    returned: z.number().int(),
    offset: z.number().int(),
    next_offset: z.number().int().optional(),
    counts: SeverityCounts,
    findings: z.array(FindingSummary),
    truncated: z.boolean().optional(),
    message: z.string().optional(),
  })
  .strict();
export type GetFindingsOutput = z.infer<typeof GetFindingsOutput>;

// ---- get_conventions -----------------------------------------------------------

export const GetConventionsInput = z
  .object({
    repo: z.string().describe('Repository as "owner/name".'),
    status: z
      .enum(['accepted', 'pending', 'rejected'])
      .default('accepted')
      .describe('accepted (default) | pending | rejected.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_CONVENTIONS_LIMIT)
      .default(DEFAULT_CONVENTIONS_LIMIT)
      .describe('Max conventions per page, 1-100 (default 50).'),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe('Conventions to skip for pagination (default 0).'),
  })
  .strict();
export type GetConventionsInput = z.infer<typeof GetConventionsInput>;

export const ConventionSummary = z.object({
  category: z.string(),
  rule: z.string(),
  evidence: z.string(),
  confidence: z.number(),
  status: z.string(),
});
export type ConventionSummary = z.infer<typeof ConventionSummary>;

/** Same `total`/`returned`/`offset`/`next_offset` shape as `get_findings` — a
 *  caller that learned to page one list can page the other without re-reading
 *  a second convention. */
export const GetConventionsOutput = z
  .object({
    repo: z.string(),
    total: z.number().int(),
    returned: z.number().int(),
    offset: z.number().int(),
    next_offset: z.number().int().optional(),
    conventions: z.array(ConventionSummary),
    truncated: z.boolean().optional(),
    message: z.string().optional(),
  })
  .strict();
export type GetConventionsOutput = z.infer<typeof GetConventionsOutput>;

// ---- get_blast_radius ------------------------------------------------------------

export const GetBlastRadiusInput = z
  .object({
    repo: z.string().describe('Repository as "owner/name".'),
    pr: z.number().int().describe('Pull request number (the GitHub #number, not an internal id).'),
  })
  .strict();
export type GetBlastRadiusInput = z.infer<typeof GetBlastRadiusInput>;

export const GetBlastRadiusOutput = z
  .object({
    status: z.literal('not_implemented'),
    message: z.string(),
  })
  .strict();
export type GetBlastRadiusOutput = z.infer<typeof GetBlastRadiusOutput>;
