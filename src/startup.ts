import { execSync } from 'node:child_process';
import { validateCopilotToken } from './copilot';

export async function validateTokens(): Promise<void> {
  if (process.env.TEST_MODE === 'true') {
    console.error('FATAL: TEST_MODE enabled; skipping token validation.');
    return;
  }

  try {
    execSync('gh auth status', {
      stdio: 'pipe',
      env: { ...process.env, GH_TOKEN: process.env.GH_TOKEN ?? '' }
    });
  } catch (error) {
    console.error('FATAL: GitHub CLI authentication failed. Set GH_TOKEN and run gh auth status.');
    throw error;
  }

  try {
    const isCopilotAuthenticated = await validateCopilotToken();
    if (!isCopilotAuthenticated) {
      throw new Error('Copilot token validation failed');
    }
  } catch (error) {
    console.error(
      'FATAL: Copilot token validation failed. Ensure COPILOT_GITHUB_TOKEN is valid.'
    );
    throw error;
  }
}
