import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Octokit } from '@octokit/rest';

type InstallationTokenCache = {
  token: string;
  expiresAt: number;
};

type RequiredEnvVar = 'GITHUB_APP_ID' | 'GITHUB_APP_PRIVATE_KEY_PATH' | 'GITHUB_APP_INSTALLATION_ID';

const requireEnv = (name: RequiredEnvVar): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

export class GitHubAuthClient {
  private readonly appId = requireEnv('GITHUB_APP_ID');
  private readonly privateKeyPath = requireEnv('GITHUB_APP_PRIVATE_KEY_PATH');
  private readonly installationId = Number.parseInt(requireEnv('GITHUB_APP_INSTALLATION_ID'), 10);
  private tokenCache?: InstallationTokenCache;

  public constructor() {
    if (Number.isNaN(this.installationId)) {
      throw new Error('GITHUB_APP_INSTALLATION_ID must be a valid integer.');
    }
  }

  private async createAppJwt(): Promise<string> {
    const privateKey = await readFile(this.privateKeyPath, 'utf8');
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: this.appId })
    ).toString('base64url');
    const unsignedToken = `${header}.${payload}`;
    const signature = createSign('RSA-SHA256').update(unsignedToken).end().sign(privateKey, 'base64url');
    return `${unsignedToken}.${signature}`;
  }

  private async getInstallationToken(): Promise<string> {
    const refreshThreshold = Date.now() + 60_000;
    if (this.tokenCache && this.tokenCache.expiresAt > refreshThreshold) {
      return this.tokenCache.token;
    }

    const appJwt = await this.createAppJwt();
    const appClient = new Octokit({ auth: appJwt });
    const response = await appClient.request('POST /app/installations/{installation_id}/access_tokens', {
      installation_id: this.installationId
    });

    this.tokenCache = {
      token: response.data.token,
      expiresAt: new Date(response.data.expires_at).getTime()
    };

    return this.tokenCache.token;
  }

  private async getInstallationClient(): Promise<Octokit> {
    const token = await this.getInstallationToken();
    return new Octokit({ auth: token });
  }

  public async postComment(owner: string, repo: string, issueNumber: number, body: string): Promise<void> {
    const client = await this.getInstallationClient();
    await client.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body
    });
  }
}

let defaultGitHubAuthClient: GitHubAuthClient | undefined;

const getGitHubAuthClient = (): GitHubAuthClient => {
  defaultGitHubAuthClient ??= new GitHubAuthClient();
  return defaultGitHubAuthClient;
};

export async function postComment(
  owner: string,
  repo: string,
  issueNumber: number,
  body: string
): Promise<void> {
  await getGitHubAuthClient().postComment(owner, repo, issueNumber, body);
}
