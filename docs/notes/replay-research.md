# Replay research: can finished games be replayed "as if live"?

Researched 2026-10-19 with real requests (`curl --compressed`, 0.4-0.6 s between calls). Verdict: **yes**. ESPN keeps timestamped play-by-play for every sport we use, and the NHL feed has the exact situation/penalty data that ESPN lacks. Everything below is what `server/src/sim` is built on (see `docs/SIMULATION.md`).

## What history exists

| Source | Depth | What carries time |
|---|---|---|
| ESPN `scoreboard?dates=YYYYMMDD` | Works for any past day (checked 2010, 2020, 2024, 2025, last 2 weeks). Final state only. | status/score at the end |
| ESPN `summary?event=ID` | Same depth. `wallclockAvailable: true`. | see per sport below |
| NHL `score/YYYY-MM-DD` | Past days work (checked 2024-12 and the last 14 days). Final `goals[]` with scorer, assists, strength, `timeInPeriod`. | period + game clock only |
| NHL `gamecenter/ID/play-by-play` | Past games work (checked 2024 and 2026). Every event with `period`, `timeInPeriod`, `situationCode`, penalties (type, duration, who), goals, shootout. | **no wall clock** |

ESPN `plays[]` / `keyEvents[]` / NFL `drives[].plays[]` (2026 games, plus spot checks of 2020/2024 games: 97-100% of plays have it):

| Sport | Where | `wallclock` | clock | running score | other |
|---|---|---|---|---|---|
| NHL | `plays[]` (~280-380) | yes, ISO `...Z`, 1 s | **elapsed** in period ("8:18") | `homeScore/awayScore` per play | `period.number`, `scoringPlay`, `strength`, "Period Start/End", "End of Game", shootout rows |
| NBA | `plays[]` (~500) | yes | remaining | yes | `period`, `scoringPlay`, `pointsAttempted` |
| NFL | **no top-level `plays`**: `drives.previous[].plays[]` (~180) + `scoringPlays[]` | yes | remaining (`clock.value` on some) | yes | `start/end` down & distance |
| MLB | `plays[]` (~550, per pitch) | yes | none | yes | `period.type` Top/Bottom, `outs` |
| Soccer | **no `plays`**: `keyEvents[]` (kickoff, goals, cards, subs, delays, halftime, 2nd half, end) | yes | `clock.value` seconds, `displayValue` minute | no | scoreboard `details[]` has the same events with `clock.value` (seconds) but no wall clock |

## Can a scoreboard poll at time T be reconstructed?

Yes, at play granularity:

- **status** pre/in/post: before the first play / between first and last / after the last. Intermissions = the gap between the last play of period N and the first of N+1 (hockey ~19 min, NBA/NFL halftime ~15 min; the real broadcast gaps are in the data).
- **score**: the running score of the last play at or before T. **period**: same.
- **clock**: not exact. Plays are 5-30 s apart; between them we run the clock down (up for soccer) and hold it when the next play's clock says it stopped. Hockey plays use *elapsed*, scoreboard shows *remaining*: convert with the period length.
- **linescores**: per-period deltas from the running scores. **Soccer**: goals/cards visible at T = scoreboard `details[]` whose key event (matched by `clock.value` + team) has `wallclock <= T`; clock from kickoff / "Start 2nd Half" wall times.
- **NHL feed at T**: the NHL play-by-play has no wall clock, but each of its events has an ESPN twin with the same (period, elapsed time). We map NHL `(period, timeInPeriod)` to wall time by interpolating between ESPN marks of that period. Goals match to the second; penalties/situation codes (power plays) appear when the NHL says so. Shootout attempts are paired in order with ESPN's shootout scoring plays.

## What is NOT reconstructable (known limits)

- **Boxscore at T**: ESPN only keeps the final one. The sim scales count-like stats by elapsed fraction (percentages untouched). Plausible, not true.
- **Clock between plays**: interpolated; `running` is inferred. The real scoreboard's pre-play latency is not modelled.
- **Provider lag and flaps**: real ESPN trails the NHL feed by seconds and sometimes flaps; replay has both feeds in perfect agreement (use the phantom-goal scenario for a score correction).
- **Team schedule/stats/game logs** are the recorded (final-day) ones, so "last 8 games" includes nothing after the recording and "players to watch" totals include that night's points. NFL/NBA/MLB team stats are not recorded (huge; only hockey insight reads them).
- **Pre-game data** (odds, probable goalies) is absent. The sim reports `odds.details = "SIM REPLAY"` so a pre-game screen is visibly marked.
- **Leaders** on the scoreboard event are final-day.
- **MLB**: no clock, no pitch-level state in the fixture (pitch rows dropped for size); ESPN has outs/bases/count but we do not serve a live `situation`. NFL likewise has no scoreboard `situation` (down/distance), which is exactly the backlog item that needs a live game.
- **Overturned goals and score corrections**: only if ESPN's play log shows them; none of the recorded games do. The sim injects a scripted one (`--phantom`).
- **Data glitches seen**: ESPN's NBA log has a play whose score regresses (106-93 then 103-93, MIA @ ORL Q3) and wall clocks that run backwards by seconds. The sim keeps game order, clamps wall time to non-decreasing and keeps scores monotonic.
- **Hockey shootout in ESPN**: plays carry the SO tally (1-0), not the game score; the sim holds the game score until "Shootout End" then applies the recorded final. NHL SO goal events carry the pre-shootout score (e.g. 3-3) with `timeInPeriod` "00:00".

## Test subjects (all finished, last two weeks; recorded in `server/test/fixtures/replay/`)

| Fixture dir | Game | Why |
|---|---|---|
| `nhl-401892525` | SJ @ DET, Oct 17 (NHL `2026020127`) | regulation + OT + shootout, 7 goals, 12 penalties, power-play goals, 3 intermissions |
| `nhl-401892524` | BUF @ MTL, Oct 17 (NHL `2026020126`) | overtime winner |
| `nhl-401892505` | DAL @ COL, Oct 14 (NHL `2026020107`) | shootout with 3 scoring attempts, short-handed goal |
| `nfl-401872999` | CHI @ ATL, Oct 18 | drives, halftime |
| `nba-401898406` | MIA @ ORL, Oct 16 | 500 plays, halftime, score glitch above |
| `mlb-401930515` | TB @ CLE, Oct 18 | innings, no clock |
| `epl-401879263` | SUN @ BOU, Oct 18 | 2 goals, **1 red + 5 yellow cards**, 7 minutes of stoppage |

Other finished games on the same days can be recorded with `scripts/record-game.mjs` (NHL list: `api-web.nhle.com/v1/score/YYYY-MM-DD`; ESPN ids from `scoreboard?dates=`). Many 2026-10-15 to 10-17 NHL games went to OT or SO.

## Production observations made while building the sim (not fixed here)

See the report that accompanied this change; summarised in `docs/SIMULATION.md#findings`.
