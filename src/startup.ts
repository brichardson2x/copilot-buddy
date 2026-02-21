import { execSync } from 'node:child_process';
import { validateCopilotToken } from './copilot';

export async function validateTokens(): Promise<void> {
  if (process.env.TEST_MODE === 'true') {
    return;
  }

  try {
    execSync('gh auth status', {
      stdio: 'pipe',
      env: { ...process.env, GH_TOKEN: process.env.GH_TOKEN ?? '' }
    });
  } catch (error) {
    console.error('FATAL: GH_TOKEN is invalid or expired — gh auth status failed');
    throw error;
  }

  try {
    const isCopilotAuthenticated = await validateCopilotToken();
    if (!isCopilotAuthenticated) {
      throw new Error('Copilot token validation failed');
    }
  } catch (error) {
    console.error('FATAL: COPILOT_GITHUB_TOKEN is invalid or expired — Copilot auth check failed');
    throw error;
  }
}
