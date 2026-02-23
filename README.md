# copilot-buddy

Run Copilot on your own servers and interact with your GitHub repos without using up GitHub compute or dealing with the limitations of an ephemeral Copilot instance.

Copilot Buddy is a self-hosted GitHub webhook service that brings Copilot AI into your issue and PR workflows on infrastructure you control:

- **Webhook listener** — validates and processes GitHub issue/PR comment events
- **Mention-triggered** — Copilot only responds when your bot handle is mentioned, keeping noise low
- **Persistent context** — conversation history stored in SQLite so every reply is fully context-aware
- **Reliable task queue** — events are queued and tracked (queued → running → complete/failed) so nothing gets dropped under load
- **Model-flexible** — override the Copilot model per-comment for different tasks

## Setup

1. Install dependencies:
   ```bash
   npm ci
   ```
2. Copy and configure environment variables:
   ```bash
   cp .env.example .env
   ```
3. Build:
   ```bash
   npm run build
   ```

### Required environment variables

Set these in `.env` (see `.env.example`):

- `COPILOT_GITHUB_TOKEN`: token used by Copilot SDK.
- `GH_TOKEN`: GitHub CLI token.
- `WEBHOOK_SECRET`: webhook signature secret.
- `GITHUB_APP_ID`: GitHub App ID.
- `GITHUB_APP_PRIVATE_KEY_PATH`: path to the GitHub App private key **.pem** file.
- `GITHUB_APP_INSTALLATION_ID`: GitHub App installation ID.
- `GITHUB_APP_CLIENT_ID`: GitHub App client ID.
- `BOT_HANDLE`: bot username (without `@`).
- `AGENT_MODEL`: default model name.
- `HOME_PATH`: runtime home directory used as default working directory.
- `SSH_PRIVATE_KEY_PATH`: host path to SSH private key (for git clone/push in container), e.g. `~/.ssh/id_rsa`.

### Docker/runtime notes

- Container startup configures git to use SSH when `SSH_PRIVATE_KEY_PATH` is provided.
- HTTPS GitHub remotes are rewritten to SSH form to avoid username/password prompts in container workflows.
- Runtime cwd is `HOME_PATH`, and service data is stored under `HOME_PATH/data`.
- Ensure your GitHub App private key `.pem` file is present at `GITHUB_APP_PRIVATE_KEY_PATH` and mounted/readable by the container.

## Usage

- Local dev:
  ```bash
  npm run dev
  ```
- Production-style startup (validates `GH_TOKEN` and Copilot auth first):
  ```bash
  node dist/index.js
  ```
- Test-mode startup bypass (for deterministic local/tests only):
  ```bash
  TEST_MODE=true node dist/index.js
  ```

## CI and `act`

- Main validation flow:
  ```bash
  npm run lint && npm run typecheck && npm run test && npm run build && npm run integration-test
  ```
- Docker validation:
  ```bash
  docker build -t copilot-buddy:test .
  ```
- Run GitHub Actions workflow locally with `act`:
  ```bash
  act -W .github/workflows/ci.yml
  ```

## Architecture (concise)

- `src/server.ts`: Express app wiring and webhook endpoint.
- `src/webhook.ts`: webhook validation, event parsing, and queue handoff.
- `src/processor.ts`: prompt generation and Copilot request orchestration.
- `src/copilot.ts`: Copilot SDK integration and token validation helper.
- `src/startup.ts`: startup auth validation (`gh auth status` + Copilot auth check).
- `src/db.ts` + `src/history.ts`: SQLite-backed event/task/thread and transcript persistence.

test123
