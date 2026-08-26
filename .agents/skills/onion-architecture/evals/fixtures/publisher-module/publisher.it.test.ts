import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeDb, resetDb, seedWorkspace, seedPull, seedReview } from '../../../test/helpers/db.js';
import { Container } from '../../platform/container.js';
import { loadConfig } from '../../platform/config.js';
import { PublisherService } from './service.js';

const postMessage = vi.fn(async () => ({ ts: '1712345678.000100' }));

vi.mock('../../adapters/slack/slack.client.js', () => ({
  SlackWebhookClient: class {
    postMessage = postMessage;
  },
}));

describe('PublisherService', () => {
  const db = makeDb();
  let container: Container;
  let workspaceId: string;
  let prId: string;

  beforeEach(async () => {
    await resetDb(db);
    ({ workspaceId } = await seedWorkspace(db));
    prId = await seedPull(db, workspaceId, { title: 'Add rate limiting' });
    await seedReview(db, workspaceId, prId, { kind: 'review', verdict: 'request_changes' });
    container = new Container(loadConfig(), db, {
      secrets: {
        get: async (key: string) => (key === 'SLACK_BOT_TOKEN' ? 'xoxb-test' : undefined),
      } as never,
    });
    postMessage.mockClear();
  });

  it('records the delivery before attempting it', async () => {
    const service = new PublisherService(container);

    const record = await service.publish(workspaceId, prId, 'slack', '#reviews');

    expect(record.status).toBe('delivered');
    expect(record.external_id).toBe('1712345678.000100');
    expect(postMessage).toHaveBeenCalledOnce();
  });

  it('leaves a retryable row when Slack times out', async () => {
    postMessage.mockRejectedValueOnce(new Error('fetch failed'));
    const service = new PublisherService(container);

    await expect(service.publish(workspaceId, prId, 'slack')).rejects.toThrow('fetch failed');

    const history = await service.history(workspaceId, prId);
    expect(history[0]!.status).toBe('retryable');
  });

  it('re-sends everything marked retryable and returns how many went out', async () => {
    postMessage.mockRejectedValueOnce(new Error('fetch failed'));
    const service = new PublisherService(container);
    await expect(service.publish(workspaceId, prId, 'slack')).rejects.toThrow();

    const sent = await service.retryFailed(workspaceId);

    expect(sent).toBe(1);
    expect(postMessage).toHaveBeenCalledTimes(2);
  });

  it('renders markdown without touching Slack when the target is markdown', async () => {
    const service = new PublisherService(container);

    const record = await service.publish(workspaceId, prId, 'markdown');

    expect(record.status).toBe('delivered');
    expect(postMessage).not.toHaveBeenCalled();
  });
});
