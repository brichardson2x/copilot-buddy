import { insertTask, updateTaskStatus } from './db';
import { readHistory } from './history';
import { buildPrompt, parseModelOverride, resolveModel } from './prompt';
import type { ProcessEventInput } from './webhook';
import { callCopilot } from './copilot';

export interface ProcessEventResult {
  taskId: number;
  responseText: string;
  model: string;
  userMessage: string;
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
    return { taskId, responseText, model, userMessage: strippedBody };
  } catch (error) {
    updateTaskStatus(taskId, 'failed');
    throw error;
  }
}
