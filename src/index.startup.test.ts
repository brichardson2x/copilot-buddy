import { createApp as createServerApp } from './server';
import { validateTokens } from './startup';
import { startCli } from './index';

jest.mock('./startup', () => ({
  validateTokens: jest.fn()
}));

jest.mock('./server', () => ({
  createApp: jest.fn()
}));

jest.mock('./github', () => ({
  postComment: jest.fn()
}));

jest.mock('./processor', () => ({
  processEvent: jest.fn()
}));

const mockedValidateTokens = validateTokens as jest.MockedFunction<typeof validateTokens>;
const mockedCreateServerApp = createServerApp as jest.MockedFunction<typeof createServerApp>;

describe('startCli', () => {
  const originalEnv = process.env;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.exitCode = undefined;
  });

  afterAll(() => {
    process.env = originalEnv;
    process.exitCode = originalExitCode;
  });

  it('does not listen and sets exitCode when token validation fails', async () => {
    mockedValidateTokens.mockRejectedValue(new Error('startup failed'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await startCli();

    expect(errorSpy).toHaveBeenCalledWith('FATAL: Startup token validation failed. Exiting.');
    expect(process.exitCode).toBe(1);
    expect(mockedCreateServerApp).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('validates tokens before listening on success', async () => {
    process.env.PORT = '4123';
    mockedValidateTokens.mockResolvedValue();
    const listen = jest.fn((_port: number, callback?: () => void) => {
      callback?.();
      return {} as never;
    });
    mockedCreateServerApp.mockReturnValue({
      listen
    } as unknown as ReturnType<typeof createServerApp>);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    await startCli();

    expect(listen).toHaveBeenCalledWith(4123, expect.any(Function));
    expect(mockedValidateTokens.mock.invocationCallOrder[0]).toBeLessThan(
      listen.mock.invocationCallOrder[0]
    );
    logSpy.mockRestore();
  });
});
