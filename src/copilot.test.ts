import {
  callCopilot,
  resetCopilotClientFactory,
  setCopilotClientFactory
} from './copilot';

describe('callCopilot', () => {
  afterEach(() => {
    resetCopilotClientFactory();
    delete process.env.COPILOT_REQUEST_TIMEOUT_MS;
  });

  it('fails fast when Copilot auth status is unauthenticated', async () => {
    const destroy = jest.fn().mockResolvedValue(undefined);
    const sendAndWait = jest.fn().mockResolvedValue({ data: { content: 'hello' } });
    const createSession = jest.fn().mockResolvedValue({ sendAndWait, destroy });
    const stop = jest.fn().mockResolvedValue(undefined);
    const start = jest.fn().mockResolvedValue(undefined);
    const getAuthStatus = jest.fn().mockResolvedValue({ isAuthenticated: false });

    setCopilotClientFactory(async () => ({ start, stop, createSession, getAuthStatus }));

    await expect(callCopilot('hi', 'gpt-5-mini')).rejects.toMatchObject({
      message: 'Copilot client is not authenticated. Check COPILOT_GITHUB_TOKEN or run gh auth login.'
    });
    expect(createSession).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
  });

  it('wraps sendAndWait timeout with actionable error', async () => {
    const timeoutError = new Error('Timeout after 60000ms waiting for session.idle');
    const destroy = jest.fn().mockResolvedValue(undefined);
    const sendAndWait = jest.fn().mockRejectedValue(timeoutError);
    const createSession = jest.fn().mockResolvedValue({ sendAndWait, destroy });
    const stop = jest.fn().mockResolvedValue(undefined);
    const start = jest.fn().mockResolvedValue(undefined);
    const getAuthStatus = jest.fn().mockResolvedValue({ isAuthenticated: true });

    setCopilotClientFactory(async () => ({ start, stop, createSession, getAuthStatus }));

    await expect(callCopilot('hi')).rejects.toMatchObject({
      message:
        'Copilot request timed out while waiting for a response. Check Copilot authentication and model availability.'
    });
    expect(sendAndWait).toHaveBeenCalledWith({ prompt: 'hi' }, 60000);
  });
});
