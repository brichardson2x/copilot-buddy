import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendHistory, getHistoryPath, HISTORY_CHAR_LIMIT, readHistory } from './history';

const context = {
  owner: 'acme',
  repo: 'project',
  threadType: 'issue' as const,
  threadNumber: 99,
  sender: 'octocat'
};

describe('history manager', () => {
  let homePath: string;

  beforeEach(() => {
    homePath = mkdtempSync(join(tmpdir(), 'copilot-buddy-history-'));
    process.env.HOME_PATH = homePath;
  });

  afterEach(async () => {
    await rm(homePath, { recursive: true, force: true });
    delete process.env.HOME_PATH;
  });

  it('returns empty string when history file is missing', async () => {
    await expect(readHistory(context)).resolves.toBe('');
  });

  it('writes markdown history entries with timestamps and role labels', async () => {
    await appendHistory(context, [
      {
        role: 'User',
        sender: 'octocat',
        message: 'Hello',
        timestamp: '2026-02-21T14:30:00Z'
      },
      {
        role: 'Agent',
        message: 'Hi there',
        timestamp: '2026-02-21T14:30:01Z'
      }
    ]);

    const historyPath = getHistoryPath(context);
    expect(historyPath).toBe(join(homePath, '.history', 'acme-project-issue-99.md'));

    const content = await readHistory(context);
    expect(content).toContain('### [2026-02-21T14:30:00Z] User (@octocat)');
    expect(content).toContain('### [2026-02-21T14:30:01Z] Agent');
    expect(content).toContain('---');
  });

  it('truncates to keep latest content around 80k chars', async () => {
    const largeMessage = `${'x'.repeat(HISTORY_CHAR_LIMIT)}-tail`;

    await appendHistory(context, [
      {
        role: 'Agent',
        message: largeMessage,
        timestamp: '2026-02-21T14:30:02Z'
      }
    ]);

    const content = await readHistory(context);
    expect(content.length).toBeLessThanOrEqual(HISTORY_CHAR_LIMIT);
    expect(content.endsWith('---\n\n')).toBe(true);
    expect(content.includes('-tail')).toBe(true);
  });
});
