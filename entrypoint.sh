#!/bin/sh
set -eu

required_vars="COPILOT_GITHUB_TOKEN GH_TOKEN WEBHOOK_SECRET GITHUB_APP_ID GITHUB_APP_PRIVATE_KEY_PATH GITHUB_APP_INSTALLATION_ID GITHUB_APP_CLIENT_ID BOT_HANDLE AGENT_MODEL HOME_PATH"

for var in $required_vars; do
  eval "value=\${$var:-}"
  if [ -z "$value" ]; then
    echo "Missing required environment variable: $var" >&2
    exit 1
  fi
done

git config --global user.email "${BOT_HANDLE}@agent.com"
git config --global user.name "${BOT_HANDLE}"

mkdir -p "${HOME_PATH}/.history" "${HOME_PATH}/data"

exec node dist/index.js
