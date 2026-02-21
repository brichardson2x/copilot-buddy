import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type WebhookEventStatus = 'received' | 'processing' | 'done' | 'error';
export type AgentTaskStatus = 'queued' | 'running' | 'done' | 'failed';

export interface WebhookEvent {
  id: number;
  event_id: string;
  event_type: string;
  repo: string;
  thread_key: string;
  sender: string;
  status: WebhookEventStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface InsertEventInput {
  eventId: string;
  eventType: string;
  repo: string;
  threadKey: string;
  sender: string;
  status?: WebhookEventStatus;
  errorMessage?: string | null;
}

export interface InsertTaskInput {
  eventId: string;
  threadKey: string;
  model: string;
  status?: AgentTaskStatus;
}

export interface UpsertThreadStateInput {
  threadKey: string;
  lastCommentId?: number | null;
  messageCount: number;
  lastActivity?: string;
}

const sqlitePath = process.env.SQLITE_PATH ?? './data/agent.db';
const resolvedSqlitePath = resolve(sqlitePath);
mkdirSync(dirname(resolvedSqlitePath), { recursive: true });

export const db = new Database(resolvedSqlitePath);

db.exec(`
  CREATE TABLE IF NOT EXISTS webhook_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT UNIQUE,
    event_type TEXT,
    repo TEXT,
    thread_key TEXT,
    sender TEXT,
    status TEXT,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS agent_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT REFERENCES webhook_events(event_id),
    thread_key TEXT,
    model TEXT,
    status TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS thread_state (
    thread_key TEXT PRIMARY KEY,
    last_comment_id INTEGER,
    message_count INTEGER DEFAULT 0,
    last_activity DATETIME
  );
`);

const insertEventStatement = db.prepare(`
  INSERT INTO webhook_events (
    event_id,
    event_type,
    repo,
    thread_key,
    sender,
    status,
    error_message
  ) VALUES (
    @eventId,
    @eventType,
    @repo,
    @threadKey,
    @sender,
    @status,
    @errorMessage
  )
`);

const updateEventStatusStatement = db.prepare(`
  UPDATE webhook_events
  SET
    status = @status,
    error_message = @errorMessage,
    updated_at = CURRENT_TIMESTAMP
  WHERE event_id = @eventId
`);

const insertTaskStatement = db.prepare(`
  INSERT INTO agent_tasks (
    event_id,
    thread_key,
    model,
    status
  ) VALUES (
    @eventId,
    @threadKey,
    @model,
    @status
  )
`);

const updateTaskStatusStatement = db.prepare(`
  UPDATE agent_tasks
  SET
    status = @status,
    completed_at = @completedAt
  WHERE id = @id
`);

const upsertThreadStateStatement = db.prepare(`
  INSERT INTO thread_state (
    thread_key,
    last_comment_id,
    message_count,
    last_activity
  ) VALUES (
    @threadKey,
    @lastCommentId,
    @messageCount,
    @lastActivity
  )
  ON CONFLICT(thread_key) DO UPDATE SET
    last_comment_id = excluded.last_comment_id,
    message_count = excluded.message_count,
    last_activity = excluded.last_activity
`);

const getEventByIdStatement = db.prepare(`
  SELECT
    id,
    event_id,
    event_type,
    repo,
    thread_key,
    sender,
    status,
    error_message,
    created_at,
    updated_at
  FROM webhook_events
  WHERE event_id = ?
`);

const getThreadStateStatement = db.prepare(`
  SELECT message_count AS messageCount
  FROM thread_state
  WHERE thread_key = ?
`);

export function insertEvent(input: InsertEventInput): number {
  const result = insertEventStatement.run({
    eventId: input.eventId,
    eventType: input.eventType,
    repo: input.repo,
    threadKey: input.threadKey,
    sender: input.sender,
    status: input.status ?? 'received',
    errorMessage: input.errorMessage ?? null
  });

  return Number(result.lastInsertRowid);
}

export function updateEventStatus(
  eventId: string,
  status: WebhookEventStatus,
  errorMessage: string | null = null
): void {
  updateEventStatusStatement.run({ eventId, status, errorMessage });
}

export function insertTask(input: InsertTaskInput): number {
  const result = insertTaskStatement.run({
    eventId: input.eventId,
    threadKey: input.threadKey,
    model: input.model,
    status: input.status ?? 'queued'
  });

  return Number(result.lastInsertRowid);
}

export function updateTaskStatus(id: number, status: AgentTaskStatus): void {
  const completedAt =
    status === 'done' || status === 'failed' ? new Date().toISOString() : null;
  updateTaskStatusStatement.run({ id, status, completedAt });
}

export function upsertThreadState(input: UpsertThreadStateInput): void {
  upsertThreadStateStatement.run({
    threadKey: input.threadKey,
    lastCommentId: input.lastCommentId ?? null,
    messageCount: input.messageCount,
    lastActivity: input.lastActivity ?? new Date().toISOString()
  });
}

export function getThreadState(
  threadKey: string
): { messageCount?: number } | undefined {
  return getThreadStateStatement.get(threadKey) as { messageCount?: number } | undefined;
}

export function getEventById(eventId: string): WebhookEvent | undefined {
  return getEventByIdStatement.get(eventId) as WebhookEvent | undefined;
}
