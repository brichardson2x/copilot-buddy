import { insertTask, updateEventStatus, updateTaskStatus } from './db';
import { appendHistory, readHistory } from './history';
import { buildPrompt, parseModelOverride, resolveModel } from './prompt';
import type { ProcessEventInput } from './webhook';
import { callCopilot } from './copilot';

export interface ProcessEventResult {
  responseText: string;
  model: string;
}

export async function processEvent(input: ProcessEventInput): Promise<ProcessEventResult> {
  const { modelOverride, strippedBody } = parseModelOverride(input.context.commentBody ?? '');
  const model = resolveModel(modelOverride) ?? '';

  const taskId = insertTask({
    eventId: input.eventId,
    threadKey: input.context.threadKey,
    model,
    status: 'queued'
  });

  try {
    updateTaskStatus(taskId, 'running');

    const history = await readHistory(input.context);
    const prompt = buildPrompt({
      context: input.context,
      reviewer: process.env.REVIEWER_USERNAME,
      timestamp: new Date().toISOString(),
      history,
      message: strippedBody
    });

    const responseText = await callCopilot(prompt, model || undefined);

    await appendHistory(input.context, [
      {
        role: 'User',
        sender: input.context.sender,
        message: strippedBody
      },
      {
        role: 'Agent',
        message: responseText
      }
    ]);

    updateTaskStatus(taskId, 'done');
    updateEventStatus(input.eventId, 'done');

    return { responseText, model };
  } catch (error) {
    updateTaskStatus(taskId, 'failed');
    updateEventStatus(input.eventId, 'error', error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
}
