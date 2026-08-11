import { afterEach, describe, expect, it } from 'vitest';
import { GetBlastRadiusOutput } from '../../src/schemas.js';
import { makeFakeApiClient } from '../helpers/fake-api-client.js';
import { buildHarness } from '../helpers/harness.js';

describe('get_blast_radius (stub, no I/O)', () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('always returns status not_implemented and never isError, without touching the api client', async () => {
    const api = makeFakeApiClient();
    const harness = await buildHarness(api);
    close = harness.close;

    const result = await harness.client.callTool({
      name: 'get_blast_radius',
      arguments: { repo: 'devdigest/demo', pr: 42 },
    });

    expect(result.isError).toBeFalsy();
    const payload = GetBlastRadiusOutput.parse(result.structuredContent);
    expect(payload.status).toBe('not_implemented');
    expect(payload.message).toMatch(/get_findings/);

    expect(api.listRepos).not.toHaveBeenCalled();
    expect(api.listPulls).not.toHaveBeenCalled();
  });
});
