import { createHmac, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { getEventById, insertEvent } from './db';
import { logger } from './logger';

type AcceptedEventType =
  | 'issue_comment'
  | 'pull_request_review_comment'
  | 'issues'
  | 'pull_request';
type ThreadType = 'issue' | 'pull_request';

export interface ParsedWebhookContext {
  owner: string;
  repo: string;
  sender: string;
  threadType: ThreadType;
  threadNumber: number;
  threadKey: string;
  commentBody: string | null;
  eventType: AcceptedEventType;
  action?: string;
}

export interface ProcessEventInput {
  eventId: string;
  eventRowId: number;
  context: ParsedWebhookContext;
}

export type OnProcessEvent = (input: ProcessEventInput) => Promise<void> | void;

export interface CreateWebhookHandlerOptions {
  onProcessEvent?: OnProcessEvent;
  botHandle?: string;
  webhookSecret?: string;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;

const readString = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
};

const readNumber = (record: Record<string, unknown>, key: string): number | undefined => {
  const value = record[key];
  return typeof value === 'number' ? value : undefined;
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const hasBotMention = (message: string | null, botHandle: string): boolean => {
  if (!message || !botHandle) {
    return false;
  }

  const mentionRegex = new RegExp(`(^|[^A-Za-z0-9-])@${escapeRegex(botHandle)}(?![A-Za-z0-9-])`, 'i');
  return mentionRegex.test(message);
};

const isAcceptedEvent = (
  eventType: string | undefined,
  action: string | undefined
): eventType is AcceptedEventType => {
  if (eventType === 'issue_comment' || eventType === 'pull_request_review_comment') {
    return true;
  }

  if (eventType === 'issues' || eventType === 'pull_request') {
    return action === 'opened';
  }

  return false;
};

const verifySignature = (
  signature: string | undefined,
  body: Buffer,
  secret: string
): boolean => {
  if (!signature || !signature.startsWith('sha256=')) {
    return false;
  }

  const expected = Buffer.from(
    `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    'utf8'
  );
  const actual = Buffer.from(signature, 'utf8');

  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
};

const parseRepository = (
  payload: Record<string, unknown>
): { owner: string; repo: string } | undefined => {
  const repository = asRecord(payload.repository);
  if (!repository) {
    return undefined;
  }

  const fullName = readString(repository, 'full_name');
  const ownerRecord = asRecord(repository.owner);
  const owner = (ownerRecord ? readString(ownerRecord, 'login') : undefined) ?? fullName?.split('/')[0];
  const repo = readString(repository, 'name') ?? fullName?.split('/')[1];

  if (!owner || !repo) {
    return undefined;
  }

  return { owner, repo };
};

const parseThreadContext = (
  eventType: AcceptedEventType,
  action: string | undefined,
  payload: Record<string, unknown>
): ParsedWebhookContext | undefined => {
  const repository = parseRepository(payload);
  const senderRecord = asRecord(payload.sender);
  const sender = senderRecord ? readString(senderRecord, 'login') : undefined;
  if (!repository || !sender) {
    return undefined;
  }

  const commentRecord = asRecord(payload.comment);
  const issueRecord = asRecord(payload.issue);
  const pullRequestRecord = asRecord(payload.pull_request);

  let threadType: ThreadType;
  let threadNumber: number | undefined;
  let commentBody: string | null;

  if (eventType === 'issue_comment') {
    threadType = asRecord(issueRecord?.pull_request) ? 'pull_request' : 'issue';
    threadNumber = issueRecord ? readNumber(issueRecord, 'number') : undefined;
    commentBody = commentRecord ? readString(commentRecord, 'body') ?? null : null;
  } else if (eventType === 'pull_request_review_comment') {
    threadType = 'pull_request';
    threadNumber = pullRequestRecord ? readNumber(pullRequestRecord, 'number') : undefined;
    commentBody = commentRecord ? readString(commentRecord, 'body') ?? null : null;
  } else if (eventType === 'issues') {
    threadType = 'issue';
    threadNumber = issueRecord ? readNumber(issueRecord, 'number') : undefined;
    commentBody = issueRecord ? readString(issueRecord, 'body') ?? null : null;
  } else {
    threadType = 'pull_request';
    threadNumber = pullRequestRecord ? readNumber(pullRequestRecord, 'number') : undefined;
    commentBody = pullRequestRecord ? readString(pullRequestRecord, 'body') ?? null : null;
  }

  if (!threadNumber) {
    return undefined;
  }

  return {
    owner: repository.owner,
    repo: repository.repo,
    sender,
    threadType,
    threadNumber,
    threadKey: `${repository.owner}-${repository.repo}-${threadType}-${threadNumber}`,
    commentBody,
    eventType,
    action
  };
};

export const createWebhookHandler = (
  options: CreateWebhookHandlerOptions = {}
): RequestHandler => {
  const webhookSecret = options.webhookSecret ?? process.env.WEBHOOK_SECRET ?? '';
  const botHandle = options.botHandle ?? process.env.BOT_HANDLE ?? '';

  return (req, res) => {
    if (!Buffer.isBuffer(req.body)) {
      return res.sendStatus(400);
    }

    const rawBody = req.body as Buffer;
    const signature = req.get('X-Hub-Signature-256') ?? undefined;

    if (!verifySignature(signature, rawBody, webhookSecret)) {
      return res.sendStatus(403);
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    } catch {
      return res.sendStatus(400);
    }

    const senderRecord = asRecord(payload.sender);
    const sender = senderRecord ? readString(senderRecord, 'login') : undefined;
    if (sender && sender === botHandle) {
      return res.sendStatus(200);
    }

    const eventType = req.get('X-GitHub-Event') ?? undefined;
    const action = typeof payload.action === 'string' ? payload.action : undefined;
    if (!isAcceptedEvent(eventType, action)) {
      return res.sendStatus(202);
    }

    const deliveryId = req.get('X-GitHub-Delivery') ?? undefined;
    if (!deliveryId) {
      return res.sendStatus(400);
    }

    if (getEventById(deliveryId)) {
      return res.sendStatus(202);
    }

    const context = parseThreadContext(eventType, action, payload);
    if (!context) {
      return res.sendStatus(400);
    }

    if (botHandle && !hasBotMention(context.commentBody, botHandle)) {
      return res.sendStatus(202);
    }

    const eventRowId = insertEvent({
      eventId: deliveryId,
      eventType,
      repo: `${context.owner}/${context.repo}`,
      threadKey: context.threadKey,
      sender: context.sender,
      status: 'received'
    });

    res.sendStatus(202);

    if (options.onProcessEvent) {
      setImmediate(() => {
        void Promise.resolve(
          options.onProcessEvent?.({
            eventId: deliveryId,
            eventRowId,
            context
          })
        ).catch((error: unknown) => {
          logger.error('Async webhook callback failed', { error });
        });
      });
    }

    return undefined;
  };
};
