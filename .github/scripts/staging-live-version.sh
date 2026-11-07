#!/usr/bin/env bash
# Prints the Worker Version that serves 100% of traffic for <wrangler-config>, or nothing.
# CD007 records it before and after a staging deploy so a failed browser suite can roll back to
# exactly the version that was live before. Never fails: an unreadable status prints nothing, and
# the rollback job then skips instead of guessing.
# Usage: staging-live-version.sh <wrangler-config.json>
set -uo pipefail
config="${1:?wrangler config path required}"
npx wrangler deployments status --config "$config" --json 2>/dev/null \
  | jq -r '(if type == "array" then .[-1] else . end)
      | [(.versions // [])[] | select(.percentage == 100)] | .[0].version_id // empty' 2>/dev/null \
  || true
