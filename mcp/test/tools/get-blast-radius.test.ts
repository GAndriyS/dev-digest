import { afterEach, describe, expect, it } from 'vitest';
import { GetBlastRadiusOutput } from '../../src/schemas.js';
import {
  MAX_BLAST_CALLERS_PER_SYMBOL,
  MAX_BLAST_ENDPOINTS,
  MAX_BLAST_SYMBOLS,
} from '../../src/constants.js';
import { makeFakeApiClient } from '../helpers/fake-api-client.js';
import { makeBlastRadius, makePr, makeRepo } from '../helpers/fixtures.js';
import { buildHarness } from '../helpers/harness.js';

const REPO = makeRepo();
const PR = makePr({ number: 42 });

function api(blast = makeBlastRadius()) {
  return makeFakeApiClient({
    listRepos: async () => [REPO],
    listPulls: async () => [PR],
    getBlastRadius: async () => blast,
  });
}

describe('get_blast_radius (round-trip through a real MCP server + client)', () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  async function call(fake = api()) {
    const harness = await buildHarness(fake);
    close = harness.close;
    return harness.client.callTool({
      name: 'get_blast_radius',
      arguments: { repo: 'devdigest/demo', pr: 42 },
    });
  }

  it('returns counts plus the callers that locate the impact in the code', async () => {
    const result = await call();

    expect(result.isError).toBeFalsy();
    const payload = GetBlastRadiusOutput.parse(result.structuredContent);

    expect(payload.pr).toBe('devdigest/demo#42');
    expect(payload.status).toBe('full');
    expect(payload.changed_symbols).toBe(1);
    expect(payload.total_callers).toBe(2);
    expect(payload.endpoints).toEqual(['GET /api/public/items']);
    expect(payload.crons).toEqual(['reset-rate-buckets (hourly)']);
    expect(payload.impacts[0]?.top_callers[0]).toEqual({
      name: 'publicRouter',
      file: 'src/api/public/index.ts',
      line: 23,
    });
  });

  it('reports the commit its line numbers resolve against', async () => {
    const result = await call(api(makeBlastRadius({ indexed_sha: 'b4a4f6e' })));
    const payload = GetBlastRadiusOutput.parse(result.structuredContent);

    // A caller opening `file:line` needs the commit those lines belong to —
    // the index's, not the PR head's.
    expect(payload.indexed_sha).toBe('b4a4f6e');
  });

  it('resolves the GitHub number to the internal id before reading the map', async () => {
    const fake = api();
    await call(fake);

    expect(fake.getBlastRadius).toHaveBeenCalledWith('pr-1');
  });

  it('reports a degraded index as a success with an onward message, not an error', async () => {
    const result = await call(
      api(
        makeBlastRadius({
          status: 'degraded',
          reason: 'no_data',
          changed_symbols: [],
          downstream: [],
        }),
      ),
    );

    expect(result.isError).toBeFalsy();
    const payload = GetBlastRadiusOutput.parse(result.structuredContent);

    expect(payload.status).toBe('degraded');
    expect(payload.reason).toBe('no_data');
    // The distinction the whole feature turns on must survive into the message.
    expect(payload.message).toMatch(/not the same as nothing depending/);
    expect(payload.message).toMatch(/get_blast_radius/);
  });

  it('points an un-imported file list at the PR, not at re-indexing', async () => {
    const result = await call(
      api(
        makeBlastRadius({
          status: 'degraded',
          reason: 'no_changed_files',
          changed_symbols: [],
          downstream: [],
        }),
      ),
    );
    const payload = GetBlastRadiusOutput.parse(result.structuredContent);

    expect(payload.message).toMatch(/have not been imported/);
    expect(payload.message).not.toMatch(/Re-index/);
  });

  it('flags a partial index while still returning its data', async () => {
    const result = await call(api(makeBlastRadius({ status: 'partial' })));
    const payload = GetBlastRadiusOutput.parse(result.structuredContent);

    expect(payload.status).toBe('partial');
    expect(payload.total_callers).toBe(2);
    expect(payload.message).toMatch(/partially built/);
  });

  it('says so plainly when a healthy index found no callers', async () => {
    const result = await call(
      api(
        makeBlastRadius({
          downstream: [
            { symbol: 'rateLimit', callers: [], endpoints_affected: [], crons_affected: [] },
          ],
        }),
      ),
    );
    const payload = GetBlastRadiusOutput.parse(result.structuredContent);

    expect(payload.status).toBe('full');
    expect(payload.total_callers).toBe(0);
    expect(payload.message).toMatch(/Nothing in the repository references/);
  });

  it('caps the returned map but never the counts it reports', async () => {
    const symbols = MAX_BLAST_SYMBOLS + 4;
    const callersPer = MAX_BLAST_CALLERS_PER_SYMBOL + 3;
    const result = await call(
      api(
        makeBlastRadius({
          changed_symbols: Array.from({ length: symbols }, (_, i) => ({
            name: `sym${i}`,
            file: `src/s${i}.ts`,
            kind: 'function',
          })),
          downstream: Array.from({ length: symbols }, (_, i) => ({
            symbol: `sym${i}`,
            callers: Array.from({ length: callersPer }, (_, j) => ({
              name: `caller${j}`,
              file: `src/c${i}-${j}.ts`,
              line: j + 1,
              rank: 1 - j / 100,
            })),
            endpoints_affected: [`GET /e${i}`],
            crons_affected: [],
          })),
        }),
      ),
    );
    const payload = GetBlastRadiusOutput.parse(result.structuredContent);

    expect(payload.impacts).toHaveLength(MAX_BLAST_SYMBOLS);
    expect(payload.impacts[0]?.top_callers).toHaveLength(MAX_BLAST_CALLERS_PER_SYMBOL);
    expect(payload.endpoints.length).toBeLessThanOrEqual(MAX_BLAST_ENDPOINTS);
    expect(payload.truncated).toBe(true);
    // Counts describe the WHOLE map — the caller must not read a truncated total.
    expect(payload.changed_symbols).toBe(symbols);
    expect(payload.total_callers).toBe(symbols * callersPer);
    expect(payload.impacts[0]?.caller_count).toBe(callersPer);
  });

  it('errors with the next call named when the repo is unknown', async () => {
    const result = await call(makeFakeApiClient({ listRepos: async () => [] }));

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(JSON.stringify(result.content)).toMatch(/devdigest\/demo/);
  });

  it('errors when the PR number does not exist in the repo', async () => {
    const result = await call(
      makeFakeApiClient({ listRepos: async () => [REPO], listPulls: async () => [] }),
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });
});
