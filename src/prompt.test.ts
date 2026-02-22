import { buildPrompt, parseModelOverride, resolveModel } from './prompt';

describe('prompt helpers', () => {
  afterEach(() => {
    delete process.env.AGENT_MODEL;
    delete process.env.AGENT_SYSTEM_PROMPT;
    delete process.env.REVIEWER_USERNAME;
  });

  it('parses model override and strips override line', () => {
    const parsed = parseModelOverride('Hello\nMODEL: gpt-5\nWorld');

    expect(parsed).toEqual({
      modelOverride: 'gpt-5',
      strippedBody: 'Hello\nWorld'
    });
  });

  it('returns undefined model when override value is empty after trim', () => {
    const parsed = parseModelOverride('MODEL:    \nrun this');

    expect(parsed.modelOverride).toBeUndefined();
    expect(parsed.strippedBody).toBe('run this');
  });

  it('parses model token and keeps trailing text in body', () => {
    const parsed = parseModelOverride('Hello\nMODEL: gpt-5-mini please summarize\nWorld');

    expect(parsed).toEqual({
      modelOverride: 'gpt-5-mini',
      strippedBody: 'Hello\nplease summarize\nWorld'
    });
  });

  it('resolves override first and then AGENT_MODEL fallback', () => {
    process.env.AGENT_MODEL = 'gpt-fallback';

    expect(resolveModel('gpt-override')).toBe('gpt-override');
    expect(resolveModel(undefined)).toBe('gpt-fallback');
  });

  it('builds prompt sections in required order', () => {
    process.env.AGENT_SYSTEM_PROMPT = 'System line';

    const prompt = buildPrompt({
      context: {
        owner: 'acme',
        repo: 'project',
        threadType: 'issue',
        threadNumber: 42,
        sender: 'octocat'
      },
      reviewer: 'reviewer1',
      timestamp: '2026-02-21T14:30:00Z',
      history: '',
      message: 'Current body'
    });

    expect(prompt).toBe(
      [
        'System line',
        'Repository: acme/project\nThread: issue #42\nSender: @octocat\nReviewer: @reviewer1\nTimestamp: 2026-02-21T14:30:00Z',
        'No prior history.',
        'Current body'
      ].join('\n\n')
    );
  });
});
