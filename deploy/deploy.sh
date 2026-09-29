#!/bin/sh
# Forced command for the CI deploy key (see README). Its only input is a commit SHA: the stack files are read
# from that commit's image, so the key can only move the host between images CI has already published.
# Installed by hand, and configured by IMAGE and APP_DIR in the key's authorized_keys entry, so CI cannot change
# what its own key may run.
set -eu
export PATH=/usr/local/bin:/usr/bin:/bin

: "${IMAGE:?set IMAGE, e.g. ghcr.io/<owner>/<repo>, in the forced command}"
: "${APP_DIR:?set APP_DIR, the directory holding .env, releases/ and data/, in the forced command}"
keep_releases=5

tag=$(printf '%s' "${SSH_ORIGINAL_COMMAND:-}" | grep -xE '[0-9a-f]{40}') || {
  echo "expected a 40-character commit SHA as the command, got: ${SSH_ORIGINAL_COMMAND:-<none>}" >&2
  exit 2
}

cd "$APP_DIR"
mkdir -p releases data/postgres data/garage

compose() {
  release_tag=$1
  shift
  APP_IMAGE=$IMAGE APP_TAG=$release_tag docker compose -f "releases/$release_tag/compose.yaml" "$@"
}

docker pull --quiet "$IMAGE:$tag"
rm -rf "releases/$tag"
mkdir "releases/$tag"
container=$(docker create "$IMAGE:$tag")
docker cp "$container:/stack/." "releases/$tag/"
docker rm "$container" >/dev/null
ln -s ../../.env "releases/$tag/.env"
compose "$tag" config --quiet

prev_tag=$(basename "$(readlink current 2>/dev/null || true)")

compose "$tag" up -d --wait tailscale postgres garage
compose "$tag" run --rm migrate

if compose "$tag" up -d --wait --remove-orphans server worker; then
  ln -sfn "releases/$tag" current
  ls -1t releases | tail -n "+$((keep_releases + 1))" | while read -r old; do rm -rf "releases/$old"; done
  source_url=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.source"}}' "$IMAGE:$tag")
  if [ -n "$source_url" ]; then
    docker image prune -af --filter "label=org.opencontainers.image.source=$source_url" >/dev/null
  fi
  echo "deployed $tag"
  exit 0
fi

echo "server or worker failed its health check" >&2
if [ -n "$prev_tag" ] && [ -d "releases/$prev_tag" ]; then
  compose "$prev_tag" up -d --wait --remove-orphans
  echo "rolled back to $prev_tag" >&2
fi
exit 1
