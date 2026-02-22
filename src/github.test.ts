jest.mock('@octokit/rest', () => ({
  Octokit: class {}
}));

import { resolvePrivateKeyPath } from './github';

describe('resolvePrivateKeyPath', () => {
  it('keeps configured path when it exists', () => {
    const result = resolvePrivateKeyPath('./certs/key.pem', (path) => path === './certs/key.pem');
    expect(result).toBe('./certs/key.pem');
  });

  it('falls back to /certs mount for container runtime', () => {
    const result = resolvePrivateKeyPath('./certs/key.pem', (path) => path === '/certs/key.pem');
    expect(result).toBe('/certs/key.pem');
  });

  it('returns configured path when no fallback path exists', () => {
    const result = resolvePrivateKeyPath('./certs/key.pem', () => false);
    expect(result).toBe('./certs/key.pem');
  });
});
