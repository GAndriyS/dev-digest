import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GetBlastRadiusInput, GetBlastRadiusOutput } from '../schemas.js';

const DESCRIPTION =
  'Not implemented yet — a placeholder for the second half of L04. Always returns `status: "not_implemented"` and never fails. Do not plan work around its output; for this PR\'s review data use `get_findings`.';

/**
 * No HTTP endpoint exists for blast radius yet (verified API fact — it is
 * homework for a later lesson). This tool does NO I/O at all: it declares the
 * real schema it will keep once implemented, so the call site does not change,
 * and returns the stub result. It never returns `isError` (plan decision 5).
 *
 * "Never isError" covers the stub's own answer, not malformed input: the SDK
 * rejects bad arguments as a -32602 protocol error before this handler runs.
 */
export function registerGetBlastRadius(server: McpServer): void {
  server.registerTool(
    'get_blast_radius',
    {
      title: 'Get blast radius (stub)',
      description: DESCRIPTION,
      inputSchema: GetBlastRadiusInput,
      outputSchema: GetBlastRadiusOutput.shape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      const payload = GetBlastRadiusOutput.parse({
        status: 'not_implemented' as const,
        message: `Blast radius is not implemented yet for ${args.repo}#${args.pr}. Use get_findings for this PR's review data.`,
      });
      return {
        content: [{ type: 'text' as const, text: payload.message }],
        structuredContent: payload,
      };
    },
  );
}
