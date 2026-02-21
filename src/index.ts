import dotenv from 'dotenv';
import { getThreadState, updateEventStatus, updateTaskStatus, upsertThreadState } from './db';
import { postComment } from './github';
import { processEvent } from './processor';
import { appendHistory } from './history';
import { createApp as createServerApp, type CreateAppOptions } from './server';
import type { ProcessEventInput } from './webhook';
import { validateTokens } from './startup';

dotenv.config();

const DEFAULT_PORT = 3000;
const MAX_COMMENT_LENGTH = 65_000;
const TRUNCATION_SUFFIX = '... (response truncated)';
const PROCESSING_FAILURE_MESSAGE =
  '🤖 Sorry, I encountered an error processing your request. Please try again.';

const getNextMessageCount = (threadKey: string): number => {
  const row = getThreadState(threadKey);
  return (row?.messageCount ?? 0) + 1;
};

const guardCommentLength = (responseText: string): string => {
  if (responseText.length <= MAX_COMMENT_LENGTH) {
    return responseText;
  }

  const maxPrefixLength = MAX_COMMENT_LENGTH - TRUNCATION_SUFFIX.length;
  return `${responseText.slice(0, maxPrefixLength)}${TRUNCATION_SUFFIX}`;
};

const defaultOnProcessEvent = async (input: ProcessEventInput): Promise<void> => {
  updateEventStatus(input.eventId, 'processing');
  let taskId: number | undefined;

  try {
    const result = await processEvent(input);
    const { responseText, userMessage } = result;
    taskId = result.taskId;
    const boundedResponse = guardCommentLength(responseText);
    const commentId = await postComment(
      input.context.owner,
      input.context.repo,
      input.context.threadNumber,
      boundedResponse
    );

    await appendHistory(input.context, [
      {
        role: 'User',
        sender: input.context.sender,
        message: userMessage
      },
      {
        role: 'Agent',
        message: boundedResponse
      }
    ]);

    upsertThreadState({
      threadKey: input.context.threadKey,
      lastCommentId: commentId,
      messageCount: getNextMessageCount(input.context.threadKey)
    });
    updateTaskStatus(taskId, 'done');
    updateEventStatus(input.eventId, 'done');
  } catch (error) {
    if (taskId !== undefined) {
      updateTaskStatus(taskId, 'failed');
    }
    updateEventStatus(input.eventId, 'error', error instanceof Error ? error.message : 'Unknown error');
    try {
      await postComment(
        input.context.owner,
        input.context.repo,
        input.context.threadNumber,
        PROCESSING_FAILURE_MESSAGE
      );
    } catch {
      // best-effort error response
    }
  }
};

export const createApp = (options: CreateAppOptions = {}) =>
  createServerApp({ ...options, onProcessEvent: options.onProcessEvent ?? defaultOnProcessEvent });

export const startCli = async (): Promise<void> => {
  const parsedPort = Number.parseInt(process.env.PORT ?? '', 10);
  const port = Number.isNaN(parsedPort) ? DEFAULT_PORT : parsedPort;

  try {
    await validateTokens();
  } catch {
    console.error('FATAL: Startup token validation failed. Exiting.');
    process.exitCode = 1;
    return;
  }

  createApp().listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
};

if (require.main === module) {
  void startCli();
}
