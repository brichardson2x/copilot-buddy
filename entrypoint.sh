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

if [ -n "${SSH_PRIVATE_KEY_PATH:-}" ] && [ -f "${SSH_PRIVATE_KEY_PATH}" ]; then
  mkdir -p /tmp/agent-ssh
  cp "${SSH_PRIVATE_KEY_PATH}" /tmp/agent-ssh/id_rsa
  chmod 600 /tmp/agent-ssh/id_rsa
  export GIT_SSH_COMMAND="ssh -i /tmp/agent-ssh/id_rsa -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
  git config --global core.sshCommand "${GIT_SSH_COMMAND}"
  git config --global url."git@github.com:".insteadOf "https://github.com/"
else
  echo "Warning: SSH_PRIVATE_KEY_PATH not set or file missing; git push may prompt for HTTPS credentials" >&2
fi

mkdir -p "${HOME_PATH}/.history" "${HOME_PATH}/data"

cd "${HOME_PATH}"

exec node /app/dist/index.js
