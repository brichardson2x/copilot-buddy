import { execSync } from 'node:child_process';
import { validateCopilotToken } from './copilot';
import { validateTokens } from './startup';

jest.mock('node:child_process', () => ({
  execSync: jest.fn()
}));

jest.mock('./copilot', () => ({
  validateCopilotToken: jest.fn()
}));

const mockedExecSync = execSync as unknown as jest.Mock;
const mockedValidateCopilotToken = validateCopilotToken as jest.MockedFunction<
  typeof validateCopilotToken
>;

describe('validateTokens', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.TEST_MODE;
    delete process.env.GH_TOKEN;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('bypasses validation when TEST_MODE is true', async () => {
    process.env.TEST_MODE = 'true';
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await validateTokens();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(mockedExecSync).not.toHaveBeenCalled();
    expect(mockedValidateCopilotToken).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('throws and logs on GitHub CLI auth failure', async () => {
    const authError = new Error('gh auth failed');
    mockedExecSync.mockImplementation(() => {
      throw authError;
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(validateTokens()).rejects.toThrow('gh auth failed');

    expect(errorSpy).toHaveBeenCalledWith(
      'FATAL: GH_TOKEN is invalid or expired — gh auth status failed'
    );
    expect(mockedValidateCopilotToken).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('throws and logs on Copilot validation failure', async () => {
    mockedExecSync.mockReturnValue(Buffer.from('ok'));
    mockedValidateCopilotToken.mockResolvedValue(false);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(validateTokens()).rejects.toThrow('Copilot token validation failed');

    expect(errorSpy).toHaveBeenCalledWith(
      'FATAL: COPILOT_GITHUB_TOKEN is invalid or expired — Copilot auth check failed'
    );
    errorSpy.mockRestore();
  });

  it('validates github cli then copilot token successfully', async () => {
    process.env.GH_TOKEN = 'test-gh-token';
    mockedExecSync.mockReturnValue(Buffer.from('ok'));
    mockedValidateCopilotToken.mockResolvedValue(true);

    await expect(validateTokens()).resolves.toBeUndefined();

    expect(mockedExecSync).toHaveBeenCalledWith(
      'gh auth status',
      expect.objectContaining({
        stdio: 'pipe',
        env: expect.objectContaining({ GH_TOKEN: 'test-gh-token' })
      })
    );
    expect(mockedValidateCopilotToken).toHaveBeenCalledTimes(1);
  });
});
