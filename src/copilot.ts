import type { AssistantMessageEvent, GetAuthStatusResponse } from '@github/copilot-sdk';

export interface CopilotSessionLike {
  sendAndWait(options: { prompt: string }, timeout?: number): Promise<AssistantMessageEvent | undefined>;
  destroy(): Promise<void>;
}

export interface CopilotClientLike {
  start(): Promise<void>;
  stop(): Promise<unknown>;
  createSession(config?: { model?: string }): Promise<CopilotSessionLike>;
  getAuthStatus?(): Promise<GetAuthStatusResponse>;
}

export class CopilotError extends Error {
  public readonly cause: unknown;

  public constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'CopilotError';
    this.cause = cause;
  }
}

type CopilotSdkModule = typeof import('@github/copilot-sdk');
const dynamicImport = new Function(
  'modulePath',
  'return import(modulePath);'
) as (modulePath: string) => Promise<CopilotSdkModule>;
const SQLITE_WARNING_SUPPRESSION_FLAG = '--no-warnings=ExperimentalWarning';
const DEFAULT_COPILOT_TIMEOUT_MS = 60_000;

const withSuppressedExperimentalWarnings = (nodeOptions: string | undefined): string => {
  const normalizedNodeOptions = (nodeOptions ?? '').trim();
  if (normalizedNodeOptions.includes(SQLITE_WARNING_SUPPRESSION_FLAG)) {
    return normalizedNodeOptions;
  }

  return [normalizedNodeOptions, SQLITE_WARNING_SUPPRESSION_FLAG].filter(Boolean).join(' ');
};

const resolveCopilotTimeoutMs = (): number => {
  const timeoutFromEnv = Number.parseInt(process.env.COPILOT_REQUEST_TIMEOUT_MS ?? '', 10);
  if (Number.isFinite(timeoutFromEnv) && timeoutFromEnv > 0) {
    return timeoutFromEnv;
  }

  return DEFAULT_COPILOT_TIMEOUT_MS;
};

const assertCopilotAuthentication = async (client: CopilotClientLike): Promise<void> => {
  if (!client.getAuthStatus) {
    return;
  }

  const authStatus = await client.getAuthStatus();
  if (!authStatus.isAuthenticated) {
    throw new CopilotError(
      'Copilot client is not authenticated. Check COPILOT_GITHUB_TOKEN or run gh auth login.'
    );
  }
};

const defaultCopilotClientFactory = async (): Promise<CopilotClientLike> => {
  const { CopilotClient } = await dynamicImport('@github/copilot-sdk');
  return new CopilotClient({
    githubToken: process.env.COPILOT_GITHUB_TOKEN,
    useLoggedInUser: !process.env.COPILOT_GITHUB_TOKEN,
    env: {
      ...process.env,
      NODE_OPTIONS: withSuppressedExperimentalWarnings(process.env.NODE_OPTIONS)
    }
  });
};

let copilotClientFactory: () => Promise<CopilotClientLike> = defaultCopilotClientFactory;

export function setCopilotClientFactory(factory: () => Promise<CopilotClientLike>): void {
  copilotClientFactory = factory;
}

export function resetCopilotClientFactory(): void {
  copilotClientFactory = defaultCopilotClientFactory;
}

export async function callCopilot(prompt: string, model?: string): Promise<string> {
  const client = await copilotClientFactory();
  let session: CopilotSessionLike | undefined;

  try {
    await client.start();
    await assertCopilotAuthentication(client);
    session = await client.createSession(model ? { model } : undefined);
    const response = await session.sendAndWait({ prompt }, resolveCopilotTimeoutMs());
    return response?.data.content ?? '';
  } catch (error) {
    if (error instanceof CopilotError) {
      throw error;
    }

    if (error instanceof Error && error.message.includes('Timeout after')) {
      throw new CopilotError(
        'Copilot request timed out while waiting for a response. Check Copilot authentication and model availability.',
        error
      );
    }

    throw new CopilotError('Copilot request failed', error);
  } finally {
    if (session) {
      try {
        await session.destroy();
      } catch {
        // best-effort cleanup
      }
    }

    try {
      await client.stop();
    } catch {
      // best-effort cleanup
    }
  }
}

export async function validateCopilotToken(): Promise<boolean> {
  const client = await copilotClientFactory();

  try {
    await client.start();
    if (!client.getAuthStatus) {
      return true;
    }

    const authStatus = await client.getAuthStatus();
    return authStatus.isAuthenticated;
  } catch {
    return false;
  } finally {
    try {
      await client.stop();
    } catch {
      // best-effort cleanup
    }
  }
}
