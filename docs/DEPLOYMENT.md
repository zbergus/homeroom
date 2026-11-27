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

The image runs as the `node` user (uid/gid 1000) with a read-only root filesystem and writes only to two mounts,
`/mnt/apps/homeroom/data` and `/mnt/apps/homeroom/media` by default (`HOMEROOM_DATA_DIR` / `HOMEROOM_MEDIA_DIR` change them).
You don't need to create them: Docker creates missing directories as root, and on every start the image's entrypoint hands
them to uid 1000 before the server runs. That is the reason the compose file starts the container as root (`user: "0:0"`)
with `cap_add: [CHOWN, SETUID, SETGID]`; the entrypoint drops to uid 1000 straight away, so the server itself runs
unprivileged. `data` holds the SQLite database and settings; `media` holds the goal horns
(`media/horns/<league>/<ABBR>.mp3`, also uploadable in the UI).

### 3. Environment

Copy `deploy/.env.example`, fill it in and paste it into the Arcane project. Only one value is required; the Arcane compose
refuses to start without it:

| Variable | What |
|---|---|
| `PUBLIC_BASE_URL` | The LAN address speakers, Home Assistant and the TVs use to reach this service, e.g. `http://192.168.1.10:8080`. No trailing slash. It is also seeded as a dashboard setting — a value saved there overrides a later `.env` change. |

Strongly recommended, and optional:

| Variable | What |
|---|---|
| `ADMIN_TOKEN` | Guards every mutating API call, `GET /api/hook/*` and the WebSocket upgrade. Generate one (`openssl rand -hex 32`) and enter the same value in the dashboard's **Settings → Security → Admin token** field. |
| `HOMEROOM_PUBLISH_ADDR` | Bind to one interface instead of all interfaces. |
| `HOMEROOM_ALLOWED_ORIGINS`, `LOG_LEVEL`, `TZ`, `HOMEROOM_DATA_DIR`, `HOMEROOM_MEDIA_DIR`, `HOMEROOM_TAG` | See the comments in `deploy/.env.example`. |

Home Assistant uses **direct REST** (`/api/services/*`, `/api/events/homeroom_*`). There is no Pusher bridge, no patched HA
integration and no linking API key. In the dashboard enter HA's URL and a long-lived token under **Settings → Home
Assistant**; changing the URL clears the stored token. Leave **Fire REST events** off until your HA automations are ready
for goal notifications.

Homeroom is for your LAN. The compose file publishes on all interfaces by default; set `HOMEROOM_PUBLISH_ADDR` to the NAS
LAN address to bind just that one. If you put it behind Caddy, forward the WebSocket upgrade on `/ws` as well — otherwise
every TV view stays stuck at "connecting" with only a small dot. Do not expose it to the internet.

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
- Through the reverse proxy, the kiosk connection dot is green (WS forwarding works).
- Add the HA URL and long-lived token, leave **Fire REST events** off, then **Test connection** and **Sync devices**.
- Star 1–2 teams so games are watched automatically.
- Install at least `nhl/default.mp3` (upload in **Settings → Goal horns**, or from a repo checkout run
  `node scripts/fetch-horns.mjs --dry-run` then the command without `--dry-run`).
- Set the stream delay in the Games tab (or use camera calibration) before firing a test goal. Manual test buttons bypass
  the automation gates, so keep **Fire REST events** off until you intend to notify people.

## Backups

Back up `HOMEROOM_DATA_DIR` (SQLite, WAL files included; stop the container or use `sqlite3 .backup` for a consistent copy) and
`HOMEROOM_MEDIA_DIR` (your horns).

## Notes

- Dependabot (`.github/dependabot.yml`) opens weekly PRs for npm, the Dockerfile base image and the GitHub Actions versions;
  CI runs on each.
- The image is `linux/amd64`. To run it on a Pi, add `linux/arm64` to `platforms` in the `publish` job (and a
  `docker/setup-qemu-action` step before the build).
