import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeDb, resetDb, seedWorkspace, seedPull } from '../../../test/helpers/db.js';
import { Container } from '../../platform/container.js';
import { loadConfig } from '../../platform/config.js';
import { WatchlistService } from './service.js';

vi.mock('../../adapters/github/octokit.js', () => ({
  OctokitGitHubClient: class {
    async getPull() {
      return { headSha: 'deadbeef', title: 'Add rate limiting', state: 'open' };
    }
  },
}));

describe('WatchlistService', () => {
  const db = makeDb();
  let container: Container;
  let workspaceId: string;
  let userId: string;

  beforeEach(async () => {
    await resetDb(db);
    ({ workspaceId, userId } = await seedWorkspace(db));
    container = new Container(loadConfig(), db);
  });

  it('records the sha the reviewer last saw', async () => {
    const prId = await seedPull(db, workspaceId, { headSha: 'aaa111' });
    const service = new WatchlistService(container);

    const entry = await service.add(workspaceId, userId, prId);

    expect(entry.seen_sha).toBe('aaa111');
  });

  it('drops the oldest entry once the cap is reached', async () => {
    const service = new WatchlistService(container);
    for (let i = 0; i < 26; i++) {
      const prId = await seedPull(db, workspaceId, { headSha: `sha${i}` });
      await service.add(workspaceId, userId, prId);
    }

    const digest = await service.digest(workspaceId, userId);

    expect(digest.watched).toBe(25);
  });

  it('reports a watched pull as moved once its head sha changes', async () => {
    const prId = await seedPull(db, workspaceId, { headSha: 'aaa111' });
    const service = new WatchlistService(container);
    await service.add(workspaceId, userId, prId);

    await seedPull(db, workspaceId, { id: prId, headSha: 'bbb222' });
    const digest = await service.digest(workspaceId, userId);

    expect(digest.moved).toHaveLength(1);
  });
});
