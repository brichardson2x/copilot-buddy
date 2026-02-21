import { insertTask, updateTaskStatus } from './db';
import { readHistory } from './history';
import { buildPrompt, parseModelOverride, resolveModel } from './prompt';
import { callCopilot } from './copilot';
import { processEvent } from './processor';

jest.mock('./db', () => ({
  insertTask: jest.fn(),
  updateTaskStatus: jest.fn()
}));

jest.mock('./history', () => ({
  readHistory: jest.fn()
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
const mockedReadHistory = readHistory as jest.MockedFunction<typeof readHistory>;
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
    const result = await processEvent(input);

    expect(result).toEqual({ taskId: 10, responseText: 'assistant reply', model: 'gpt-5', userMessage: 'hello' });
    expect(order).toEqual([
      'parse override',
      'resolve model',
      'insert task queued',
      'task running',
      'read history',
      'build prompt',
      'call copilot'
    ]);
  });

  it('uses stripped model override body from webhook comment', async () => {
    const overrideInput = {
      ...input,
      context: {
        ...input.context,
        commentBody: 'MODEL: gpt-5\nplease summarize this'
      }
    };
    mockedParseModelOverride.mockReturnValue({
      modelOverride: 'gpt-5',
      strippedBody: 'please summarize this'
    });

    await processEvent(overrideInput);

    expect(mockedParseModelOverride).toHaveBeenCalledWith('MODEL: gpt-5\nplease summarize this');
    expect(mockedBuildPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'please summarize this' })
    );
  });

  it('marks task as failed when pipeline throws', async () => {
    mockedCallCopilot.mockRejectedValue(new Error('copilot boom'));

    await expect(processEvent(input)).rejects.toThrow('copilot boom');

    expect(mockedUpdateTaskStatus).toHaveBeenCalledWith(10, 'running');
    expect(mockedUpdateTaskStatus).toHaveBeenCalledWith(10, 'failed');
    expect(mockedUpdateTaskStatus).not.toHaveBeenCalledWith(10, 'done');
  });
});
