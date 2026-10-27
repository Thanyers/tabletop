#!/usr/bin/env bash
# Runs `wrangler deploy --config <config>` and retries once after a pause.
# Cloudflare's container and assets steps fail transiently (image preparation timeouts,
# API code 10013, "re-run the same wrangler deploy command to finish"), and the same
# command finishes the job on the next try. Deploying the same build twice is safe.
# Usage: wrangler-deploy-retry.sh <wrangler-config.json> [attempts=2] [pause-seconds=60] [wrangler args...]
# Anything after the three positional slots is passed to `wrangler deploy` unchanged (e.g. --var).
set -uo pipefail

config="${1:?wrangler config path required}"
attempts="${2:-2}"
pause="${3:-60}"
shift $(( $# < 3 ? $# : 3 ))

for attempt in $(seq 1 "$attempts"); do
  echo "wrangler deploy --config $config (attempt $attempt of $attempts)"
  if npx wrangler deploy --config "$config" "$@"; then
    [ "$attempt" -gt 1 ] && echo "::notice::wrangler deploy succeeded on attempt $attempt after a transient failure"
    exit 0
  fi
  if [ "$attempt" -lt "$attempts" ]; then
    echo "::warning::wrangler deploy failed on attempt $attempt; retrying in ${pause}s"
    sleep "$pause"
  fi
done
echo "::error::wrangler deploy failed after $attempts attempts"
exit 1
