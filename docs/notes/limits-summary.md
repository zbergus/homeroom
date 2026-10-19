# Known-limits work: summary of what changed (2026-10-19)

A. Delay buffer persistence. `pending_events` + `shown_games` tables (store.ts). `DelayBuffer.push` returns the release time; every push in
   `engine.ts` goes through `pushOut`, which writes events that are still inside the delay window and deletes them on release. `Engine.restore()`
   (called in `createApp` after listeners are attached, before the poller starts) re-queues each event for its ORIGINAL release time; overdue by
   <= `HOMEROOM_RESTORE_GRACE_S` (default 10 s) goes out immediately, staler is dropped with a `console.warn`. `shown` is restored from the last
   released snapshot (written at most every 5 s per game, ignored if older than 10 min); raw state is re-seeded silently by the first poll and reaches
   viewers after the normal delay. Not restored: the 20 s `goal_overturned` confirm timer, a goal still being built (scorer lookup, < 5 s) at crash time.
B. Provider health. `engine/health.ts` (`ProviderHealth`), wrapped around provider calls in `poller.ts` (and enrichment calls via
   `Engine.providerReport`). `/api/status` gains `providers[]`, `server_time`, and warnings (failing > 60 s, or no data > 5 min, only for providers a live game depends on).
D. Horn volume. `outputs/horn_volume.ts`, settings `horn_volume` (0..1 | null) and `horn_players` (`media_player.*`).
E. Admin token: the browser flow already worked; 401s now explain themselves (web/src/lib/api.ts). New app-level test covers every mutating route.
F. Headless HA test: `scripts/ha_integration_test/` (see its README).
