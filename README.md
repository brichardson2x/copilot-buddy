# copilot-buddy

GitHub webhook service that routes issue and PR comments to Copilot, posts responses, and tracks thread state in SQLite.

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
