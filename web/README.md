# Homeroom web

Vite + React 18 + TypeScript + Tailwind 3 frontend. Dark-mode only. Builds to `dist/` (served by the backend with SPA fallback).

```
npm install
npm run dev        # http://localhost:5173, proxies /api /ws /media -> http://localhost:8080
npm run build      # tsc --noEmit + vite build -> dist/
```

Routes: `/` control dashboard, `/scoreboard?game=<id>|auto`, `/grid`, `/ticker`.

## Mock mode
Add `?mock=1` to any URL (e.g. `/grid?mock=1`) for simulated hockey games, a goal ~4 s after load and then every ~15 s, plus an in-memory API for the dashboard. Build with `VITE_MOCK=1` to fall back to mock data if the WebSocket has never connected.
Useful scoreboard ids in mock: `nhl:m1` (live), `nhl:m3` (intermission), `nhl:m4` (pregame), `nhl:m2` (final).

## Layout
- `src/lib/live.ts` shared `/ws` client (`useLive`, `useEvents`), reconnect with backoff; renders exactly what the server sends (delay is server-side).
- `src/lib/api.ts` REST client; `src/lib/mock.ts` fake feed; `src/types.ts` API types.
- `src/kiosk/` goal overlay + break screens; `src/views/` routes; `src/dashboard/` dashboard panels.
- Kiosk views hide the cursor/scrollbars, request a Wake Lock and show a tiny connection dot. Sizing uses `--u` (min of 1vw / 1.78vh) so 1080p, 4K and portrait scale.

## Dashboard layout
Three remembered tabs (localStorage `homeroom.dash_tab`): **Today** (Next 24 h, Calendar), **Alerts** (Stream delay + calibration, Automation, Manual buttons, Triggers & light actions), **Setup** (Status & diagnostics, Home Assistant, Goal horns, Leagues, TV views). The header health dot opens Status. The HA token is write-only in the UI (Replace / Remove).
