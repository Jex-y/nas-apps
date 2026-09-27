#!/bin/sh
# Forced command for the CI deploy key (see README). Reads the commit SHA from SSH_ORIGINAL_COMMAND and
# compose.yaml from stdin. Installed by hand so CI cannot rewrite what its own key is allowed to run.
set -eu
export PATH=/usr/local/bin:/usr/bin:/bin

app_dir=/volume1/Ed/app
cd "$app_dir"

tag=$(printf '%s' "${SSH_ORIGINAL_COMMAND:-}" | grep -xE '[0-9a-f]{40}') || {
  echo "expected a 40-character commit SHA as the command, got: ${SSH_ORIGINAL_COMMAND:-<none>}" >&2
  exit 2
}

cat > compose.next.yaml
APP_TAG=$tag docker compose -f compose.next.yaml config --quiet

prev_tag=$(cat .deployed-tag 2>/dev/null || true)
if [ -f compose.yaml ]; then
  cp compose.yaml compose.prev.yaml
fi
mv compose.next.yaml compose.yaml

export APP_TAG="$tag"
docker compose pull server
docker compose up -d --wait postgres
docker compose run --rm migrate

if docker compose up -d --wait --remove-orphans server; then
  echo "$tag" > .deployed-tag
  docker image prune -af --filter "label=org.opencontainers.image.source=https://github.com/Jex-y/nas-apps" >/dev/null
  echo "deployed $tag"
  exit 0
fi

echo "server failed its health check" >&2
if [ -n "$prev_tag" ] && [ -f compose.prev.yaml ]; then
  mv compose.prev.yaml compose.yaml
  APP_TAG=$prev_tag docker compose up -d --wait server
  echo "rolled back to $prev_tag" >&2
fi
exit 1
