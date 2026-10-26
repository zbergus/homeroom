#!/bin/sh
# Runs as root only when the deployment asks for it (compose sets `user: "0:0"`): Docker creates missing
# bind-mount directories as root:0, and the app runs as the image's unprivileged `node` user, so a fresh
# install would die on its first write to /data or /media. Taking ownership here is the one thing that needs
# a capability; it happens once per start, then this script drops to the app user for good, which clears the
# capability sets, so the server itself never runs with any privilege (docs/DEPLOYMENT.md).
set -eu

if [ "$(id -u)" != "0" ]; then
  # Already unprivileged (plain `docker run`, local `docker compose up`): nothing to fix, behave like CMD.
  exec "$@"
fi

app_uid="${APP_UID:-$(id -u node)}"
app_gid="${APP_GID:-$(id -g node)}"

for dir in "${DATA_DIR:-/data}" "${MEDIA_DIR:-/media}"; do
  [ -d "$dir" ] || continue
  if ! chown -R "$app_uid:$app_gid" "$dir"; then
    echo "homeroom: cannot hand $dir to uid $app_uid: mount it writable, or set APP_UID/APP_GID to its owner" >&2
    exit 1
  fi
done

if ! command -v setpriv > /dev/null; then
  echo "homeroom: setpriv (util-linux) is missing from the image, cannot drop privileges" >&2
  exit 1
fi

exec setpriv --reuid="$app_uid" --regid="$app_gid" --clear-groups "$@"
