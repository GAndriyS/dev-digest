import { describe, expect, it } from 'vitest';
import { resolveAgent, resolvePr, resolveRepo } from '../../src/lib/resolve.js';
import { makeFakeApiClient } from '../helpers/fake-api-client.js';
import { makeAgent, makePr, makeRepo } from '../helpers/fixtures.js';

describe('resolveRepo', () => {
  it('matches full_name case-insensitively', async () => {
    const api = makeFakeApiClient({
      listRepos: async () => [makeRepo({ full_name: 'DevDigest/Demo' })],
    });
    const repo = await resolveRepo(api, 'devdigest/demo');
    expect(repo.full_name).toBe('DevDigest/Demo');
  });

  it('matches a bare name when unambiguous', async () => {
    const api = makeFakeApiClient({
      listRepos: async () => [makeRepo({ name: 'demo', full_name: 'devdigest/demo' })],
    });
    const repo = await resolveRepo(api, 'DEMO');
    expect(repo.full_name).toBe('devdigest/demo');
  });

  it('says a bare name is ambiguous rather than claiming nothing matched', async () => {
    const api = makeFakeApiClient({
      listRepos: async () => [
        makeRepo({ id: 'r1', name: 'demo', full_name: 'devdigest/demo' }),
        makeRepo({ id: 'r2', name: 'demo', full_name: 'acme/demo' }),
      ],
    });
    await expect(resolveRepo(api, 'demo')).rejects.toThrow(
      /matches 2 imported repos: devdigest\/demo, acme\/demo/,
    );
  });

  it('lists candidates in the error on a miss', async () => {
    const api = makeFakeApiClient({
      listRepos: async () => [makeRepo({ full_name: 'devdigest/demo' })],
    });
    await expect(resolveRepo(api, 'nope/nope')).rejects.toThrow(/devdigest\/demo/);
  });
});

describe('resolvePr', () => {
  it('matches by number', async () => {
    const repo = makeRepo();
    const api = makeFakeApiClient({ listPulls: async () => [makePr({ number: 7, id: 'pr-7' })] });
    const { prId } = await resolvePr(api, repo, 7);
    expect(prId).toBe('pr-7');
  });

  it('lists known PR numbers on a miss', async () => {
    const repo = makeRepo();
    const api = makeFakeApiClient({ listPulls: async () => [makePr({ number: 7 })] });
    await expect(resolvePr(api, repo, 99)).rejects.toThrow(/7/);
  });

  it('rejects a PR with no internal id rather than proceeding with null', async () => {
    const repo = makeRepo();
    const api = makeFakeApiClient({ listPulls: async () => [makePr({ number: 7, id: null })] });
    await expect(resolvePr(api, repo, 7)).rejects.toThrow(/no internal id/);
  });
});

describe('resolveAgent', () => {
  it('matches name case-insensitively', async () => {
    const api = makeFakeApiClient({ listAgents: async () => [makeAgent({ name: 'Reviewer' })] });
    const agent = await resolveAgent(api, 'reviewer');
    expect(agent.name).toBe('Reviewer');
  });

  it('falls back to a uuid match', async () => {
    const api = makeFakeApiClient({ listAgents: async () => [makeAgent({ id: 'agent-xyz', name: 'Reviewer' })] });
    const agent = await resolveAgent(api, 'agent-xyz');
    expect(agent.id).toBe('agent-xyz');
  });

  it('names list_agents in the error on a miss', async () => {
    const api = makeFakeApiClient({ listAgents: async () => [makeAgent({ name: 'Reviewer' })] });
    await expect(resolveAgent(api, 'nope')).rejects.toThrow(/list_agents/);
  });
});
