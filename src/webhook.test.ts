import { createHmac } from 'node:crypto';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { createApp } from './server';
import { getEventById, insertEvent } from './db';

jest.mock('./db', () => ({
  getEventById: jest.fn(),
  insertEvent: jest.fn()
}));

const mockedGetEventById = getEventById as jest.MockedFunction<typeof getEventById>;
const mockedInsertEvent = insertEvent as jest.MockedFunction<typeof insertEvent>;

const WEBHOOK_SECRET = 'test-webhook-secret';
const BOT_HANDLE = 'agent-bot';

const createSignature = (body: string): string =>
  `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')}`;

const postWebhook = async (
  server: Server,
  body: string,
  headers: Record<string, string>
): Promise<number> => {
  const { port } = server.address() as AddressInfo;

  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/webhook',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body).toString(),
          ...headers
        }
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      }
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
};

const startServer = (onProcessEvent?: jest.Mock): Promise<Server> => {
  const app = createApp(onProcessEvent ? { onProcessEvent } : {});
  const server = app.listen(0);
  return once(server, 'listening').then(() => server);
};

const stopServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

describe('POST /webhook', () => {
  beforeEach(() => {
    process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.BOT_HANDLE = BOT_HANDLE;
    mockedGetEventById.mockReturnValue(undefined);
    mockedInsertEvent.mockReturnValue(77);
  });

  it('returns 403 when HMAC verification fails', async () => {
    const payload = JSON.stringify({
      action: 'created',
      sender: { login: 'octocat' },
      repository: { full_name: 'acme/project', name: 'project', owner: { login: 'acme' } },
      issue: { number: 12 },
      comment: { body: 'hello' }
    });
    const server = await startServer();

    try {
      const status = await postWebhook(server, payload, {
        'x-github-event': 'issue_comment',
        'x-github-delivery': 'evt-invalid-signature',
        'x-hub-signature-256': 'sha256=invalid'
      });

      expect(status).toBe(403);
      expect(mockedGetEventById).not.toHaveBeenCalled();
      expect(mockedInsertEvent).not.toHaveBeenCalled();
    } finally {
      await stopServer(server);
    }
  });

  it('returns 202 for unsupported event action combinations', async () => {
    const payload = JSON.stringify({
      action: 'edited',
      sender: { login: 'octocat' },
      repository: { full_name: 'acme/project', name: 'project', owner: { login: 'acme' } },
      issue: { number: 12, body: 'body' }
    });
    const server = await startServer();

    try {
      const status = await postWebhook(server, payload, {
        'x-github-event': 'issues',
        'x-github-delivery': 'evt-unsupported-action',
        'x-hub-signature-256': createSignature(payload)
      });

      expect(status).toBe(202);
      expect(mockedGetEventById).not.toHaveBeenCalled();
      expect(mockedInsertEvent).not.toHaveBeenCalled();
    } finally {
      await stopServer(server);
    }
  });

  it('returns 200 for bot loop prevention before DB writes', async () => {
    const payload = JSON.stringify({
      action: 'created',
      sender: { login: BOT_HANDLE },
      repository: { full_name: 'acme/project', name: 'project', owner: { login: 'acme' } },
      issue: { number: 12 },
      comment: { body: 'bot generated comment' }
    });
    const onProcessEvent = jest.fn().mockResolvedValue(undefined);
    const server = await startServer(onProcessEvent);

    try {
      const status = await postWebhook(server, payload, {
        'x-github-event': 'issue_comment',
        'x-github-delivery': 'evt-bot-loop',
        'x-hub-signature-256': createSignature(payload)
      });

      expect(status).toBe(200);
      expect(mockedGetEventById).not.toHaveBeenCalled();
      expect(mockedInsertEvent).not.toHaveBeenCalled();
      expect(onProcessEvent).not.toHaveBeenCalled();
    } finally {
      await stopServer(server);
    }
  });

  it('accepts valid webhook with async callback and mocked DB helpers', async () => {
    const payload = JSON.stringify({
      action: 'created',
      sender: { login: 'octocat' },
      repository: { full_name: 'acme/project', name: 'project', owner: { login: 'acme' } },
      issue: { number: 42, body: 'issue body' },
      comment: { body: 'please run' }
    });
    mockedInsertEvent.mockReturnValue(123);
    const onProcessEvent = jest.fn().mockResolvedValue(undefined);
    const server = await startServer(onProcessEvent);

    try {
      const status = await postWebhook(server, payload, {
        'x-github-event': 'issue_comment',
        'x-github-delivery': 'evt-valid',
        'x-hub-signature-256': createSignature(payload)
      });

      expect(status).toBe(202);
      expect(mockedGetEventById).toHaveBeenCalledWith('evt-valid');
      expect(mockedInsertEvent).toHaveBeenCalledWith({
        eventId: 'evt-valid',
        eventType: 'issue_comment',
        repo: 'acme/project',
        threadKey: 'acme-project-issue-42',
        sender: 'octocat',
        status: 'received'
      });

      await new Promise((resolve) => setImmediate(resolve));

      expect(onProcessEvent).toHaveBeenCalledWith({
        eventId: 'evt-valid',
        eventRowId: 123,
        context: {
          owner: 'acme',
          repo: 'project',
          sender: 'octocat',
          threadType: 'issue',
          threadNumber: 42,
          threadKey: 'acme-project-issue-42',
          commentBody: 'please run',
          eventType: 'issue_comment',
          action: 'created'
        }
      });
    } finally {
      await stopServer(server);
    }
  });
});
