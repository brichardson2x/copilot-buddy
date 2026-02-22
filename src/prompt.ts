import type { ParsedWebhookContext } from './webhook';

const MODEL_LINE_PREFIX_REGEX = /^MODEL:\s*/i;
const EMPTY_MODEL_LINE_REGEX = /^MODEL:\s*$/i;
const MODEL_NAME_REGEX = /^[A-Za-z0-9._-]+$/;

export interface ParsedModelOverride {
  modelOverride: string | undefined;
  strippedBody: string;
}

export interface BuildPromptInput {
  context: Pick<
    ParsedWebhookContext,
    'owner' | 'repo' | 'threadType' | 'threadNumber' | 'sender' | 'eventType'
  >;
  history: string;
  message: string;
  reviewer?: string;
  timestamp?: string;
}

export function parseModelOverride(body: string): ParsedModelOverride {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const strippedLines: string[] = [];
  let modelOverride: string | undefined;

  for (const line of lines) {
    if (line.match(EMPTY_MODEL_LINE_REGEX)) {
      continue;
    }

    const modelLinePrefix = line.match(MODEL_LINE_PREFIX_REGEX);
    if (modelLinePrefix) {
      const modelLineContent = line.slice(modelLinePrefix[0].length).trim();
      if (!modelLineContent) {
        continue;
      }

      const [modelCandidate, ...remainderTokens] = modelLineContent.split(/\s+/);
      if (modelCandidate && MODEL_NAME_REGEX.test(modelCandidate)) {
        modelOverride = modelCandidate;
        const trailingText = remainderTokens.join(' ').trim();
        if (trailingText) {
          strippedLines.push(trailingText);
        }
        continue;
      }
    }

    strippedLines.push(line);
  }

  const strippedBody = strippedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  return {
    modelOverride,
    strippedBody
  };
}

export function resolveModel(override: string | undefined): string | undefined {
  return override ?? process.env.AGENT_MODEL;
}

export function buildPrompt(input: BuildPromptInput): string {
  const sections: string[] = [];
  const systemPrompt = process.env.AGENT_SYSTEM_PROMPT?.trim();

  if (systemPrompt) {
    sections.push(systemPrompt);
  }

  const timestamp = input.timestamp ?? new Date().toISOString();
  const reviewer = input.reviewer ?? process.env.REVIEWER_USERNAME ?? 'N/A';

  sections.push(
    [
      `Repository: ${input.context.owner}/${input.context.repo}`,
      `Repository Remote (SSH): git@github.com:${input.context.owner}/${input.context.repo}.git`,
      `Repository Remote (HTTPS): https://github.com/${input.context.owner}/${input.context.repo}.git`,
      `Preferred Local Repo Path: ${(process.env.HOME_PATH ?? '/home/agent').trim()}/${input.context.repo}`,
      `Thread: ${input.context.threadType} #${input.context.threadNumber}`,
      `Event: ${input.context.eventType}`,
      `Sender: @${input.context.sender}`,
      `Reviewer: @${reviewer}`,
      `Timestamp: ${timestamp}`
    ].join('\n')
  );

  sections.push(input.history.trim() ? input.history : 'No prior history.');
  sections.push(input.message);

  return sections.join('\n\n');
}
