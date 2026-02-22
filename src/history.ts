import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ParsedWebhookContext } from './webhook';

export const HISTORY_CHAR_LIMIT = 80_000;

export interface HistoryThreadContext
  extends Pick<ParsedWebhookContext, 'owner' | 'repo' | 'threadType' | 'threadNumber' | 'sender'> {}

export type HistoryRole = 'User' | 'Agent';

export interface HistoryEntry {
  role: HistoryRole;
  message: string;
  sender?: string;
  timestamp?: string;
}

const isMissingFileError = (error: unknown): boolean => {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
};

const getHomePath = (): string => process.env.HOME_PATH ?? process.cwd();

export function getHistoryPath(context: HistoryThreadContext): string {
  return join(
    getHomePath(),
    '.history',
    `${context.owner}-${context.repo}-${context.threadType}-${context.threadNumber}.md`
  );
}

export async function readHistory(context: HistoryThreadContext): Promise<string> {
  const historyPath = getHistoryPath(context);

  try {
    return await readFile(historyPath, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) {
      return '';
    }

    throw error;
  }
}

const formatHistoryEntry = (entry: HistoryEntry): string => {
  const timestamp = entry.timestamp ?? new Date().toISOString();
  const roleLabel =
    entry.role === 'User' ? `User${entry.sender ? ` (@${entry.sender})` : ''}` : 'Agent';

  return `### [${timestamp}] ${roleLabel}\n\n${entry.message}\n\n---\n\n`;
};

export async function appendHistory(
  context: HistoryThreadContext,
  entries: HistoryEntry[]
): Promise<void> {
  const historyPath = getHistoryPath(context);
  await mkdir(dirname(historyPath), { recursive: true });

  const existingHistory = await readHistory(context);
  const appendedHistory = entries.map((entry) => formatHistoryEntry(entry)).join('');

  const combinedHistory = `${existingHistory}${appendedHistory}`;
  const truncatedHistory =
    combinedHistory.length > HISTORY_CHAR_LIMIT
      ? combinedHistory.slice(-HISTORY_CHAR_LIMIT)
      : combinedHistory;

  await writeFile(historyPath, truncatedHistory, 'utf8');
}
