# Goal horn sources (research notes)

Homeroom ships **no audio**. `horns.manifest.json` lists third-party URLs that were each verified with a real request
(HTTP 200, `audio/mpeg`, MP3 frame sync, 20 KB to 8 MB, estimated duration). Verified on 2026-10-19.
`media/horns/*/*.mp3` is git-ignored; nothing here is redistributed by this repo.

## Import everything

```bash
node scripts/fetch-horns.mjs --dry-run      # verify only (1 request/s per host, reads first 16 KB of each file)
node scripts/fetch-horns.mjs                # download into media/horns/<league>/<ABBR>.mp3 (never overwrites; --force to replace)
node scripts/fetch-horns.mjs --league nhl   # one league
node --test scripts/                        # self-check of the validation helper
```

## Length, fade and loudness

The Home Assistant integration plays the horn **first and speaks the TTS announcement only after the horn finishes**, so a 55 s horn delays the announcement by 55 s. Settings (Dashboard → Setup → "Horn length and loudness", or `PUT /api/settings`):

| Setting | Default | Meaning |
|---|---|---|
| `horn_max_s` | `30` | Longest horn that plays, 2 to 120 s. `null` (empty field) = no limit. Longer clips are cut to this. |
| `horn_fade_ms` | `1500` | Fade-out at the cut, 0 to 5000 ms (ffmpeg only). |
| `horn_normalize` | `false` | Bring horns to about -16 LUFS so a loud rip does not blast the room (ffmpeg only, single-pass `loudnorm`). |
| `horn_scope` | `favorites` | Whose goals play a horn: `home` (home team only), `favorites` ("my teams": your favourite when one is in the game, else both), `all` (both teams). |

How it works: `/media/horns/<league>/<ABBR>.mp3` is served through `server/src/audio/horns.ts`. The **original file is never modified.** A clip that already fits (and `horn_normalize` off) is served byte for byte. Otherwise a processed copy is built once, cached in `$DATA_DIR/cache/horns/` (keyed by file path, mtime, size and the settings, so a changed setting or replaced file just makes a new copy and the stale one is deleted), and served with `Range`/206 and conditional-GET support. Copies are pre-built in the background at startup, after a horn upload and after a horn setting changes, so the first goal does not wait for the encoder. Any failure (ffmpeg missing, crash, timeout, unreadable file) logs once and serves the original bytes. ffmpeg is run with an argument array (no shell).

- **With ffmpeg** (the Docker image): trim + fade + optional loudness, re-encoded to 128 kbps / 44.1 kHz MP3.
- **Without ffmpeg** (plain `npm run dev` on a Mac): "cut only". A built-in MP3 reader cuts on a frame boundary (drops ID3 and Xing/Info headers); no fade, no loudness, the horn just stops. The dashboard says which mode you are in (`GET /api/status` → `audio`).
- `GET /api/horns` reports each horn's `duration_s`, `processed` and `trimmed`; the dashboard shows "will be trimmed to Ns". Status warnings flag horns longer than the limit, and a disabled limit with horns over 45 s.
- Image size: the Docker image installs ffmpeg (`apt-get install --no-install-recommends ffmpeg`), which grew it from about 264 MB to about 661 MB (it pulls in the Debian codec/filter library set). It still runs as the non-root `node` user. If that matters, drop the `RUN apt-get ...` line from the Dockerfile and Homeroom falls back to cut-only.

Measured in the container (a real 55 s horn, `horn_max_s=10`, 1500 ms fade): the served file is 10.03 s, valid MP3 (ffmpeg decodes with `-xerror`), 128 kbps / 44.1 kHz; mean level of the middle 0.5 s is -9.8 dB and of the last 0.5 s is -27.9 dB (faded). With `horn_normalize`, 3 s clips measured -19.5 and -18.9 LUFS before and -16.1 LUFS after. Nobody listened to it: an agent cannot, so give a horn one real listen from the dashboard (Preview plays the served, trimmed file).

## Coverage

| League | Verified | Teams | Notes |
|---|---|---|---|
| NHL | 32 + default | 32 | all ESPN abbreviations (incl. `LA`, `NJ`, `SJ`, `TB`, `UTAH`) |
| NFL, MLB, NBA, MLS, EPL, LaLiga, Bundesliga, UCL, WNBA, NCAA | 0 | n/a | no usable source found (see below) |

## Sources used

- **A: `BrandonMiller18/nhl_companion-pi` (GitHub, `sounds/*.mp3`, last push 2024-10).** 3-second clips of each team's horn, 30 teams
  plus a generic `goal.mp3`. Ideal length for a Home Assistant speaker. No licence file; it is a hobby Raspberry Pi project
  that bundles team audio, so treat it as "personal use only, may disappear". Teams are keyed by that repo's names
  (`cal`, `lak`, `njd`, `sjs`, `tbl`); mapped here to ESPN abbreviations. Its `cgy`/`win` files are 85/106 s rips and were
  deliberately not used (`cal`/`wpg` are the 3 s clips). `ari.mp3` (Coyotes) exists but ESPN no longer lists ARI.
  Clips were checked for non-silent audio; I could not listen to them, so team correctness rests on the repo's file names
  (confidence medium). Spot-check a few after importing (Dashboard, Horns, play).
- **B: `robin-calamatta/gooooal` (GitHub, `media/goalhorns/*.mp3`, 2025-26 season).** Full horn-plus-song rips (YouTube style,
  41 to 106 s each) for all 32 teams. Used only for SEA and UTAH, which A lacks. Long files would hold the Cast speaker for
  about a minute; the default `horn_max_s` of 30 s trims them on playback (see above), or trim them yourself (below). No licence file.

## Per-team table

| League | Abbr | Team | Source | Confidence | Duration | Notes |
|---|---|---|---|---|---|---|
| nhl | ANA | Anaheim Ducks | A (`ana.mp3`) | medium | 3.0 s | short clip |
| nhl | BOS | Boston Bruins | A (`bos.mp3`) | medium | 3.0 s | short clip |
| nhl | BUF | Buffalo Sabres | A (`buf.mp3`) | medium | 3.0 s | short clip |
| nhl | CGY | Calgary Flames | A (`cal.mp3`) | medium | 3.0 s | short clip |
| nhl | CAR | Carolina Hurricanes | A (`car.mp3`) | medium | 3.0 s | short clip |
| nhl | CHI | Chicago Blackhawks | A (`chi.mp3`) | medium | 3.0 s | short clip |
| nhl | COL | Colorado Avalanche | A (`col.mp3`) | medium | 3.0 s | short clip |
| nhl | CBJ | Columbus Blue Jackets | A (`cbj.mp3`) | medium | 3.0 s | short clip |
| nhl | DAL | Dallas Stars | A (`dal.mp3`) | medium | 3.0 s | short clip |
| nhl | DET | Detroit Red Wings | A (`det.mp3`) | medium | 3.0 s | short clip |
| nhl | EDM | Edmonton Oilers | A (`edm.mp3`) | medium | 3.0 s | short clip |
| nhl | FLA | Florida Panthers | A (`fla.mp3`) | medium | 3.0 s | short clip |
| nhl | LA | Los Angeles Kings | A (`lak.mp3`) | medium | 3.0 s | short clip |
| nhl | MIN | Minnesota Wild | A (`min.mp3`) | medium | 3.0 s | short clip |
| nhl | MTL | Montreal Canadiens | A (`mtl.mp3`) | medium | 3.0 s | short clip |
| nhl | NSH | Nashville Predators | A (`nsh.mp3`) | medium | 3.0 s | short clip |
| nhl | NJ | New Jersey Devils | A (`njd.mp3`) | medium | 3.2 s | short clip |
| nhl | NYI | New York Islanders | A (`nyi.mp3`) | medium | 3.0 s | short clip |
| nhl | NYR | New York Rangers | A (`nyr.mp3`) | medium | 3.0 s | short clip |
| nhl | OTT | Ottawa Senators | A (`ott.mp3`) | medium | 2.7 s | short clip |
| nhl | PHI | Philadelphia Flyers | A (`phi.mp3`) | medium | 3.0 s | short clip |
| nhl | PIT | Pittsburgh Penguins | A (`pit.mp3`) | medium | 3.0 s | short clip |
| nhl | SJ | San Jose Sharks | A (`sjs.mp3`) | medium | 3.0 s | short clip |
| nhl | STL | St. Louis Blues | A (`stl.mp3`) | medium | 55 s | **long** (full horn+song rip) |
| nhl | TB | Tampa Bay Lightning | A (`tbl.mp3`) | medium | 3.0 s | short clip |
| nhl | TOR | Toronto Maple Leafs | A (`tor.mp3`) | medium | 3.0 s | short clip |
| nhl | VAN | Vancouver Canucks | A (`van.mp3`) | medium | 3.0 s | short clip |
| nhl | VGK | Vegas Golden Knights | A (`vgk.mp3`) | medium | 5.6 s | longer clip |
| nhl | WSH | Washington Capitals | A (`wsh.mp3`) | medium | 3.0 s | short clip |
| nhl | WPG | Winnipeg Jets | A (`wpg.mp3`) | medium | 3.0 s | short clip |
| nhl | SEA | Seattle Kraken | B (2025 rip) | medium | 50 s | **long** |
| nhl | UTAH | Utah Mammoth | B (2026 "official" rip) | medium | 48 s | **long** |
| nhl | default | generic goal horn | A (`goal.mp3`) | low | 4.1 s | origin unknown; swap for a CC0 horn if you prefer |

All entries: personal-use only, no licence grant (team audio is copyrighted by the clubs/league).

## Alternates (not in the manifest, same-repo, verified present but long)

`BrandonMiller18/nhl_companion-pi` (A) is preferred. If a clip in A is wrong or missing, `robin-calamatta/gooooal` has all 32
teams as 41-106 s files (distinct audio, 2025-26 horns + goal songs) and `ptball/nhl_team_live_goal_tracker`
(`src/Goal_Horn_Files/2020/*.mp3`, 31 teams, 1-2.4 MB, roughly 1-2 min, 2020 horns, no ARI/SEA/UTAH). Put the URL in the manifest.

## No source found / not used

- **NFL, MLB, NBA, MLS, EPL, LaLiga, Bundesliga, UCL (all teams):** searched GitHub, Internet Archive and the web; no
  reliable per-team audio pack exists. Touchdown and home-run "songs" are mostly licensed commercial music, not horns; the
  only hits were single custom clips (e.g. an Internet Archive "UCF Knights Custom Touchdown Horn", college) and MLB's
  walk-up song app (licensed, not downloadable). Use the dashboard upload or your own files (`default.mp3` covers the rest).
- **Soundboard / fan sites:** `wejustscored.com` (old goal-horn site) is now taken over and redirects to an unrelated domain; not used.
  Hockey Horns Live and Goal Horn Hub are paid apps with their own bundled audio; not extracted.
- **myinstants-style sites:** not used (ad-heavy, user-uploaded, unclear rights, and no stable official file URLs).
- **Freesound:** requires an account/API key for downloads; not used.
- **Internet Archive:** has one-off uploads (e.g. `washingtoncapitalsgoalhorn`, `tampabaylightninggoalhorn`,
  `newyorkislandersnycblive`) but no all-teams collection; A already covers these teams.

## Legal fallback for `default.mp3` (CC0, needs conversion)

Wikimedia Commons has CC0 horns, but only as WAV/OGG: `File:Car_Horn.wav` (3.5 s), `File:AirChime_K5LA.ogg` (21 s),
`File:Nathan_M5.ogg` (18 s). Homeroom accepts MP3 only (ffmpeg, where present, is used only to trim/fade/normalise playback, not to import), so convert yourself:

```bash
ffmpeg -i Car_Horn.wav -codec:a libmp3lame -q:a 4 media/horns/nhl/default.mp3
```

Other formats, same idea (`.ogg`, `.m4a`, `.wav`, or a ZIP: unzip first). Trim a long rip to its first 12 s with a fade:

```bash
ffmpeg -i long.mp3 -t 12 -af afade=t=out:st=10:d=2 -codec:a libmp3lame -q:a 4 media/horns/nhl/SEA.mp3
```

`fetch-horns.mjs` rejects non-MP3 bytes with a hint ("looks like WAV/OGG/ZIP"), and HTML error pages saved as `.mp3`.
It also accepts local paths in the manifest, so you can point at your converted files.
