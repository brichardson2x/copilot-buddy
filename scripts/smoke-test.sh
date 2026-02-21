#!/usr/bin/env bash
set -euo pipefail

: "${WEBHOOK_SECRET:?WEBHOOK_SECRET is required}"

WEBHOOK_URL="${WEBHOOK_URL:-http://127.0.0.1:3000/webhook}"
PAYLOAD_FILE="test/fixtures/issue_comment.json"
DELIVERY_ID="00000000-0000-4000-8000-000000000001"

if [ ! -f "$PAYLOAD_FILE" ]; then
  echo "Smoke test failed: payload file not found at $PAYLOAD_FILE" >&2
  exit 1
fi

DIGEST="$(openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" "$PAYLOAD_FILE" | awk '{print $NF}')"
SIGNATURE="sha256=$DIGEST"

STATUS_CODE="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$WEBHOOK_URL" \
  -H 'Content-Type: application/json' \
  -H 'X-GitHub-Event: issue_comment' \
  -H "X-GitHub-Delivery: $DELIVERY_ID" \
  -H "X-Hub-Signature-256: $SIGNATURE" \
  --data-binary "@$PAYLOAD_FILE")"

if [ "$STATUS_CODE" != "202" ]; then
  echo "Smoke test failed: expected HTTP 202, got $STATUS_CODE" >&2
  exit 1
fi

echo "Smoke test passed: received HTTP 202"
