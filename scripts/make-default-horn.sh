#!/usr/bin/env bash
# Generate a synthetic two-tone horn as media/horns/<league>/default.mp3 (needs ffmpeg).
# No ffmpeg? Upload any MP3 as "default" in the Horns tab instead, or:
#   docker run --rm -v "$PWD/media:/media" linuxserver/ffmpeg ... (same filter as below)
set -euo pipefail
cd "$(dirname "$0")/.."
command -v ffmpeg >/dev/null || { echo "ffmpeg not found; upload a default horn in the UI instead" >&2; exit 1; }
for league in nhl nfl nba mlb mls epl laliga bundesliga ucl; do
  mkdir -p "media/horns/$league"
  [ -f "media/horns/$league/default.mp3" ] && continue
  ffmpeg -loglevel error -y \
    -f lavfi -i "sine=frequency=220:duration=1.6" -f lavfi -i "sine=frequency=277:duration=1.6" \
    -filter_complex "[0][1]amix=inputs=2,tremolo=f=6:d=0.25,afade=t=out:st=1.2:d=0.4,volume=2" \
    -ar 44100 -b:a 128k "media/horns/$league/default.mp3"
  echo "wrote media/horns/$league/default.mp3"
done
