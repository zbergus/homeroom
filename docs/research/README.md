# Research material

Visual and behavioural references gathered while reverse-engineering what ConnectedRoom does. **Reference only**: nothing here is copied into the product (no logos, copy or assets).

| Files | What | In git? |
|---|---|---|
| `sportsgrid.png`, `break-screens.png` | public marketing pages of the vendor | yes |
| `ref-*.png` | the vendor's own public marketing renders of the four break screens, a real OS scoreboard screenshot, screen-layout config, LED ticker demo | **no** (git-ignored; vendor assets) |
| `app-*.png` | screenshots of the logged-in vendor app (calendar, delay, actions, triggers…); they show account details | **no** (git-ignored) |
| `instagram.png` | public Instagram profile grid | **no** (git-ignored) |
| `verify-*.png`, `real-*.png` | Homeroom's own screens captured during verification (dashboard, goal overlay, grid, ticker, real-data summary/stats) | yes |
| `tv-*.png` | Homeroom TV views rendered from mock data, landscape (`-l`) and portrait (`-p`) | yes |
| `dash-*.png` | Homeroom dashboard tabs (desktop and phone) | yes |

The written findings live in `SPEC.md` §6.0 (public pages), §6.0b (logged-in app), §6.0c (paywalled TV views reconstructed from public renders). If `ref-*` files are missing on a fresh clone, that is expected; the descriptions in the spec are sufficient to understand the target look.
