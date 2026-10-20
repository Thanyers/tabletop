#!/usr/bin/env bash
# CD001: apply pending D1 migrations for one environment.
# Records a D1 Time Travel bookmark first so the database can be restored to the
# moment before the migration:  npx wrangler d1 time-travel restore <db> --bookmark <id>
# Refuses to migrate when no bookmark can be taken.
set -euo pipefail
config="$1"
label="$2"
db="$(npx tsx server/release-deploy.ts db-name "$config")"

pending="$(npx wrangler d1 migrations list DB --remote --config "$config" 2>&1)" || { echo "$pending"; exit 1; }
if grep -q "No migrations to apply" <<<"$pending"; then
  echo "$label: no pending D1 migrations."
  echo "- $label: no pending D1 migrations" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
  exit 0
fi
echo "$pending"

info="$(npx wrangler d1 time-travel info "$db" --json --config "$config")"
bookmark="$(node -e "const v=JSON.parse(process.argv[1]); if(!v.bookmark) process.exit(1); process.stdout.write(v.bookmark)" "$info")" \
  || { echo "::error::$label: could not record a D1 Time Travel bookmark; not migrating."; exit 1; }
echo "$label: restore point before migration: $bookmark"
{
  echo "- $label: D1 \`$db\` restore point before migration: \`$bookmark\`"
  echo "  restore with \`npx wrangler d1 time-travel restore $db --bookmark $bookmark\`"
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"

CI=true npx wrangler d1 migrations apply DB --remote --config "$config"
