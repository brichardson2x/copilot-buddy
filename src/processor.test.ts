import { insertTask, updateEventStatus, updateTaskStatus } from './db';
import { appendHistory, readHistory } from './history';
import { buildPrompt, parseModelOverride, resolveModel } from './prompt';
import { callCopilot } from './copilot';
import { processEvent } from './processor';

jest.mock('./db', () => ({
  insertTask: jest.fn(),
  updateTaskStatus: jest.fn(),
  updateEventStatus: jest.fn()
}));

jest.mock('./history', () => ({
  readHistory: jest.fn(),
  appendHistory: jest.fn()
}));

jest.mock('./prompt', () => ({
  parseModelOverride: jest.fn(),
  resolveModel: jest.fn(),
  buildPrompt: jest.fn()
}));

jest.mock('./copilot', () => ({
  callCopilot: jest.fn()
}));

const mockedInsertTask = insertTask as jest.MockedFunction<typeof insertTask>;
const mockedUpdateTaskStatus = updateTaskStatus as jest.MockedFunction<typeof updateTaskStatus>;
const mockedUpdateEventStatus = updateEventStatus as jest.MockedFunction<typeof updateEventStatus>;
const mockedReadHistory = readHistory as jest.MockedFunction<typeof readHistory>;
const mockedAppendHistory = appendHistory as jest.MockedFunction<typeof appendHistory>;
const mockedParseModelOverride = parseModelOverride as jest.MockedFunction<typeof parseModelOverride>;
const mockedResolveModel = resolveModel as jest.MockedFunction<typeof resolveModel>;
const mockedBuildPrompt = buildPrompt as jest.MockedFunction<typeof buildPrompt>;
const mockedCallCopilot = callCopilot as jest.MockedFunction<typeof callCopilot>;

const input = {
  eventId: 'evt-1',
  eventRowId: 1,
  context: {
    owner: 'acme',
    repo: 'project',
    sender: 'octocat',
    threadType: 'issue' as const,
    threadNumber: 42,
    threadKey: 'acme-project-issue-42',
    commentBody: 'hello',
    eventType: 'issue_comment' as const,
    action: 'created'
  }
};

describe('processEvent', () => {
  beforeEach(() => {
    mockedInsertTask.mockReturnValue(10);
    mockedParseModelOverride.mockReturnValue({
      modelOverride: 'gpt-5',
      strippedBody: 'clean body'
    });
    mockedResolveModel.mockReturnValue('gpt-5');
    mockedReadHistory.mockResolvedValue('history block');
    mockedBuildPrompt.mockReturnValue('built prompt');
    mockedCallCopilot.mockResolvedValue('assistant reply');
    mockedAppendHistory.mockResolvedValue(undefined);
  });

  it('runs the success pipeline in exact order', async () => {
    const order: string[] = [];

    mockedParseModelOverride.mockImplementation((body) => {
      order.push('parse override');
      return { modelOverride: 'gpt-5', strippedBody: body };
    });
    mockedResolveModel.mockImplementation((override) => {
      order.push('resolve model');
      return override;
    });
    mockedInsertTask.mockImplementation(() => {
      order.push('insert task queued');
      return 10;
    });
    mockedUpdateTaskStatus.mockImplementation((_id, status) => {
      order.push(`task ${status}`);
    });
    mockedReadHistory.mockImplementation(async () => {
      order.push('read history');
      return 'history block';
    });
    mockedBuildPrompt.mockImplementation(() => {
      order.push('build prompt');
      return 'built prompt';
    });
    mockedCallCopilot.mockImplementation(async () => {
      order.push('call copilot');
      return 'assistant reply';
    });
    mockedAppendHistory.mockImplementation(async () => {
      order.push('append history');
    });
    mockedUpdateEventStatus.mockImplementation((_eventId, status) => {
      order.push(`event ${status}`);
    });

    const result = await processEvent(input);

    expect(result).toEqual({ responseText: 'assistant reply', model: 'gpt-5' });
    expect(order).toEqual([
      'parse override',
      'resolve model',
      'insert task queued',
      'task running',
      'read history',
      'build prompt',
      'call copilot',
      'append history',
      'task done',
      'event done'
    ]);
  });

  it('marks task and event as failed when pipeline throws', async () => {
    mockedCallCopilot.mockRejectedValue(new Error('copilot boom'));

    await expect(processEvent(input)).rejects.toThrow('copilot boom');

    expect(mockedUpdateTaskStatus).toHaveBeenCalledWith(10, 'running');
    expect(mockedUpdateTaskStatus).toHaveBeenCalledWith(10, 'failed');
    expect(mockedUpdateEventStatus).toHaveBeenCalledWith('evt-1', 'error', 'copilot boom');
    expect(mockedAppendHistory).not.toHaveBeenCalled();
    expect(mockedUpdateTaskStatus).not.toHaveBeenCalledWith(10, 'done');
    expect(mockedUpdateEventStatus).not.toHaveBeenCalledWith('evt-1', 'done');
  });
});
