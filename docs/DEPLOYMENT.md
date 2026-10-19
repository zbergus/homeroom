# Deployment (GHCR + Arcane)

## Model

1. **CI** (`.github/workflows/ci.yml`) runs on every push and pull request: server typecheck (source and tests), lint, tests and
   `npm audit`; web typecheck, build and `npm audit`.
2. **On `master` and `v*` tags**, once both jobs pass, CI builds the image and publishes `ghcr.io/zbergus/homeroom`:
   - `latest` (follows `master`)
   - `sha-<7 chars>` (every master build)
   - `1.2.3` and `1.2` (tags `v1.2.3`)

   Pull requests never publish.
3. **In Arcane** you paste `deploy/docker-compose.yml` and a `.env` and deploy. Nothing is built on the NAS and no other project
   file is needed.

## One-time setup

### 1. Let Arcane pull the private package

The repo is private, so the GHCR package is too.

1. Create a GitHub personal access token (classic) with only the `read:packages` scope.
2. In Arcane's container-registry settings add `ghcr.io` with username `zbergus` and that token.
3. Confirm Arcane can pull `ghcr.io/zbergus/homeroom` (the first deploy does exactly that).

The first image appears after the first run of the `publish` job on `master`: check the repo's **Actions** tab and
**Packages**.

### 2. Host directories

The image runs as the `node` user (uid/gid 1000) with a read-only root filesystem and writes only to two mounts:

```bash
mkdir -p /mnt/apps/homeroom/data /mnt/apps/homeroom/media
chown -R 1000:1000 /mnt/apps/homeroom
```

Change the paths with `HOMEROOM_DATA_DIR` / `HOMEROOM_MEDIA_DIR` if your apps pool lives elsewhere. `data` holds the SQLite
database and settings; `media` holds the goal horns (`media/horns/<league>/<ABBR>.mp3`, also uploadable in the UI).

### 3. Environment

Copy `deploy/.env.example`, fill it in and paste it into the Arcane project. Two values are required and the compose file
refuses to start without them:

| Variable | What |
|---|---|
| `PUBLIC_BASE_URL` | The LAN address speakers, Home Assistant and the TVs use to reach this service, e.g. `http://192.168.1.10:8080` |
| `PUSHER_APP_SECRET` | A long random value (`openssl rand -hex 32`) |

Set these two as well; both are optional, and the dashboard warns while they are empty:

| Variable | What |
|---|---|
| `ADMIN_TOKEN` | Guards every mutating API call and `GET /api/hook/*`. Enter it in the dashboard's "Admin token" field. |
| `HOMEROOM_API_KEY` | Only this key may link a Home Assistant install. Use the same value in the integration. |

`PUSHER_APP_KEY` must match the patched Home Assistant integration (`ha/patch_integration.py --key ...`, see
[`HOME_ASSISTANT.md`](HOME_ASSISTANT.md)).

Homeroom is for your LAN. The compose file publishes it on all interfaces by default; set `HOMEROOM_PUBLISH_ADDR` to the NAS
LAN address to bind just that one. Do not expose it to the internet.

## Deploy and update

1. Set `HOMEROOM_TAG` in the Arcane `.env`. Prefer a pinned tag (`sha-1a2b3c4` or `1.2.3`): `latest` follows `master`, so a
   redeploy would silently change what runs.
2. Paste `deploy/docker-compose.yml` into the Arcane project (once, or when it changes in the repo).
3. Deploy.

To update, change `HOMEROOM_TAG` to the new tag and redeploy. To roll back, set it to the previous tag. So far the schema has only gained tables (`CREATE TABLE IF NOT EXISTS`), so
an older image reads a newer database, but back up `data` before any update that notes a schema change.

## Releasing

Merge to `master`: CI publishes `latest` and `sha-<commit>`. For a versioned release:

```bash
git tag v1.0.0 && git push origin v1.0.0     # publishes 1.0.0 and 1.0
```

## Verify after a deploy

- The container shows healthy (the image has a built-in healthcheck on `/healthz`).
- `http://<NAS>:8080/` shows the dashboard and **Status & diagnostics** lists no unexpected warnings.
- `curl http://<NAS>:8080/healthz` returns `{"ok":true,...}`.
- Link Home Assistant and fire a test goal from the dashboard.

## Backups

Back up `HOMEROOM_DATA_DIR` (SQLite, WAL files included; stop the container or use `sqlite3 .backup` for a consistent copy) and
`HOMEROOM_MEDIA_DIR` (your horns).

## Notes

- Dependabot (`.github/dependabot.yml`) opens weekly PRs for npm, the Dockerfile base image and the GitHub Actions versions;
  CI runs on each.
- The image is `linux/amd64`. To run it on a Pi, add `linux/arm64` to `platforms` in the `publish` job (and a
  `docker/setup-qemu-action` step before the build).
