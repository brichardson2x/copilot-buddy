import { createHmac } from 'node:crypto';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { createApp } from './index';
import {
  getEventById,
  getThreadState,
  insertEvent,
  insertTask,
  updateEventStatus,
  updateTaskStatus,
  upsertThreadState
} from './db';
import { callCopilot } from './copilot';
import { postComment } from './github';
import { appendHistory, readHistory } from './history';
import { processEvent } from './processor';

jest.mock('./db', () => ({
  getEventById: jest.fn(),
  getThreadState: jest.fn(),
  insertEvent: jest.fn(),
  insertTask: jest.fn(),
  updateEventStatus: jest.fn(),
  updateTaskStatus: jest.fn(),
  upsertThreadState: jest.fn()
}));

jest.mock('./copilot', () => ({
  callCopilot: jest.fn()
}));

jest.mock('./github', () => ({
  postComment: jest.fn()
}));

jest.mock('./history', () => ({
  appendHistory: jest.fn(),
  readHistory: jest.fn()
}));

jest.mock('./processor', () => ({
  processEvent: jest.fn()
}));

const mockedGetEventById = getEventById as jest.MockedFunction<typeof getEventById>;
const mockedGetThreadState = getThreadState as jest.MockedFunction<typeof getThreadState>;
const mockedInsertEvent = insertEvent as jest.MockedFunction<typeof insertEvent>;
const mockedInsertTask = insertTask as jest.MockedFunction<typeof insertTask>;
const mockedUpdateEventStatus = updateEventStatus as jest.MockedFunction<typeof updateEventStatus>;
const mockedUpdateTaskStatus = updateTaskStatus as jest.MockedFunction<typeof updateTaskStatus>;
const mockedUpsertThreadState = upsertThreadState as jest.MockedFunction<typeof upsertThreadState>;
const mockedCallCopilot = callCopilot as jest.MockedFunction<typeof callCopilot>;
const mockedPostComment = postComment as jest.MockedFunction<typeof postComment>;
const mockedAppendHistory = appendHistory as jest.MockedFunction<typeof appendHistory>;
const mockedReadHistory = readHistory as jest.MockedFunction<typeof readHistory>;
const mockedProcessEvent = processEvent as jest.MockedFunction<typeof processEvent>;

const WEBHOOK_SECRET = 'test-webhook-secret';
const BOT_HANDLE = 'agent-bot';
const FRIENDLY_ERROR_MESSAGE =
  '🤖 Sorry, I encountered an error processing your request. Please try again.';
const TRUNCATION_SUFFIX = '... (response truncated)';

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

const startServer = async (): Promise<Server> => {
  const app = createApp();
  const server = app.listen(0);
  await once(server, 'listening');
  return server;
};

const stopServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

describe('createApp default async processing', () => {
  beforeEach(() => {
    process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.BOT_HANDLE = BOT_HANDLE;
    mockedGetEventById.mockReturnValue(undefined);
    mockedInsertEvent.mockReturnValue(33);
    mockedInsertTask.mockReturnValue(41);
    mockedProcessEvent.mockResolvedValue({
      taskId: 41,
      responseText: 'assistant reply',
      model: 'gpt-4o',
      userMessage: 'clean body'
    });
    mockedReadHistory.mockResolvedValue('history block');
    mockedCallCopilot.mockResolvedValue('assistant reply');
    mockedPostComment.mockResolvedValue(9001);
    mockedGetThreadState.mockReturnValue(undefined);
  });

  it('prevents bot loop before DB writes and processing/post flow', async () => {
    const payload = JSON.stringify({
      action: 'created',
      sender: { login: BOT_HANDLE },
      repository: { full_name: 'acme/project', name: 'project', owner: { login: 'acme' } },
      issue: { number: 7 },
      comment: { body: 'bot message' }
    });
    const server = await startServer();

    try {
      const status = await postWebhook(server, payload, {
        'x-github-event': 'issue_comment',
        'x-github-delivery': 'evt-bot-loop-default',
        'x-hub-signature-256': createSignature(payload)
      });

      expect(status).toBe(200);
      expect(mockedGetEventById).not.toHaveBeenCalled();
      expect(mockedInsertEvent).not.toHaveBeenCalled();
      expect(mockedProcessEvent).not.toHaveBeenCalled();
      expect(mockedPostComment).not.toHaveBeenCalled();
    } finally {
      await stopServer(server);
    }
  });

  it('posts friendly error message on processing failure', async () => {
    mockedProcessEvent.mockRejectedValue(new Error('copilot boom'));
    const payload = JSON.stringify({
      action: 'created',
      sender: { login: 'octocat' },
      repository: { full_name: 'acme/project', name: 'project', owner: { login: 'acme' } },
      issue: { number: 42, body: 'issue body' },
      comment: { body: '@agent-bot please run' }
    });
    const server = await startServer();

    try {
      const status = await postWebhook(server, payload, {
        'x-github-event': 'issue_comment',
        'x-github-delivery': 'evt-processing-error',
        'x-hub-signature-256': createSignature(payload)
      });

      expect(status).toBe(202);
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockedUpdateEventStatus).toHaveBeenCalledWith('evt-processing-error', 'processing');
      expect(mockedUpdateEventStatus).toHaveBeenCalledWith(
        'evt-processing-error',
        'error',
        'copilot boom'
      );
      expect(mockedPostComment).toHaveBeenCalledWith('acme', 'project', 42, FRIENDLY_ERROR_MESSAGE);
      expect(mockedUpsertThreadState).not.toHaveBeenCalled();
      expect(mockedAppendHistory).not.toHaveBeenCalled();
    } finally {
      await stopServer(server);
    }
  });

  it('truncates long responses and upserts thread state with returned comment id', async () => {
    mockedProcessEvent.mockResolvedValue({
      taskId: 41,
      responseText: 'x'.repeat(65_050),
      model: 'gpt-4o',
      userMessage: 'clean body'
    });
    mockedGetThreadState.mockReturnValue({ messageCount: 4 });

    const payload = JSON.stringify({
      action: 'created',
      sender: { login: 'octocat' },
      repository: { full_name: 'acme/project', name: 'project', owner: { login: 'acme' } },
      issue: { number: 11, body: 'issue body' },
      comment: { body: 'MODEL: gpt-4o\n@agent-bot please run' }
    });
    const server = await startServer();

    try {
      const status = await postWebhook(server, payload, {
        'x-github-event': 'issue_comment',
        'x-github-delivery': 'evt-truncate',
        'x-hub-signature-256': createSignature(payload)
      });

      expect(status).toBe(202);
      await new Promise((resolve) => setImmediate(resolve));

      const postedBody = mockedPostComment.mock.calls[0]?.[3] ?? '';
      expect(postedBody.length).toBe(65_000);
      expect(postedBody.endsWith(TRUNCATION_SUFFIX)).toBe(true);
      expect(mockedAppendHistory).toHaveBeenCalledWith(
        expect.objectContaining({ threadKey: 'acme-project-issue-11' }),
        [
          { role: 'User', sender: 'octocat', message: 'clean body' },
          { role: 'Agent', message: postedBody }
        ]
      );
      expect(mockedUpsertThreadState).toHaveBeenCalledWith({
        threadKey: 'acme-project-issue-11',
        lastCommentId: 9001,
        messageCount: 5
      });
      expect(mockedUpdateEventStatus).toHaveBeenCalledWith('evt-truncate', 'done');
    } finally {
      await stopServer(server);
    }
  });

  it('marks task failed when downstream posting fails', async () => {
    mockedPostComment.mockRejectedValueOnce(new Error('github boom')).mockResolvedValueOnce(9002);
    const payload = JSON.stringify({
      action: 'created',
      sender: { login: 'octocat' },
      repository: { full_name: 'acme/project', name: 'project', owner: { login: 'acme' } },
      issue: { number: 16, body: 'issue body' },
      comment: { body: '@agent-bot please run' }
    });
    const server = await startServer();

    try {
      const status = await postWebhook(server, payload, {
        'x-github-event': 'issue_comment',
        'x-github-delivery': 'evt-post-fail',
        'x-hub-signature-256': createSignature(payload)
      });

      expect(status).toBe(202);
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockedUpdateTaskStatus).toHaveBeenCalledWith(41, 'failed');
      expect(mockedUpdateTaskStatus).not.toHaveBeenCalledWith(41, 'done');
      expect(mockedUpdateEventStatus).toHaveBeenCalledWith('evt-post-fail', 'error', 'github boom');
      expect(mockedAppendHistory).not.toHaveBeenCalled();
      expect(mockedUpsertThreadState).not.toHaveBeenCalled();
      expect(mockedPostComment).toHaveBeenLastCalledWith('acme', 'project', 16, FRIENDLY_ERROR_MESSAGE);
    } finally {
      await stopServer(server);
    }
  });

  it('strips MODEL override content in webhook flow before history append', async () => {
    process.env.AGENT_MODEL = 'gpt-4o';
    const actualProcessEvent = jest.requireActual('./processor').processEvent as typeof processEvent;
    mockedProcessEvent.mockImplementation(actualProcessEvent);
    mockedCallCopilot.mockResolvedValue('assistant final');

    const payload = JSON.stringify({
      action: 'created',
      sender: { login: 'octocat' },
      repository: { full_name: 'acme/project', name: 'project', owner: { login: 'acme' } },
      issue: { number: 15, body: 'issue body' },
      comment: { body: 'MODEL: gpt-5\n@agent-bot please summarize this thread' }
    });
    const server = await startServer();

    try {
      const status = await postWebhook(server, payload, {
        'x-github-event': 'issue_comment',
        'x-github-delivery': 'evt-model-strip',
        'x-hub-signature-256': createSignature(payload)
      });

      expect(status).toBe(202);
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockedUpdateTaskStatus).toHaveBeenCalledWith(41, 'done');
      expect(mockedInsertTask).toHaveBeenCalledWith(
        expect.objectContaining({ threadKey: 'acme-project-issue-15', model: 'gpt-5' })
      );
      expect(mockedCallCopilot).toHaveBeenCalledWith(expect.any(String), 'gpt-5');
      const promptArg =
        mockedCallCopilot.mock.calls[mockedCallCopilot.mock.calls.length - 1]?.[0] ?? '';
      expect(promptArg).toContain('please summarize this thread');
      expect(promptArg).not.toContain('MODEL: gpt-5');
      expect(mockedAppendHistory).toHaveBeenCalledWith(
        expect.objectContaining({ threadKey: 'acme-project-issue-15' }),
        [
          { role: 'User', sender: 'octocat', message: '@agent-bot please summarize this thread' },
          { role: 'Agent', message: 'assistant final' }
        ]
      );
    } finally {
      await stopServer(server);
    }
  });
});
