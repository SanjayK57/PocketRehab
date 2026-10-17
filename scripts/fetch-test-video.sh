#!/bin/sh
# Downloads the openly licensed real-person test clip used by tests/e2e/real-person.spec.ts
# and converts it to the .y4m format Chromium's fake camera can play.
#   "Jumping jacks and burpees" by Taco fleur, CC BY-SA 4.0, via Wikimedia Commons:
#   https://commons.wikimedia.org/wiki/File:Jumping_jacks_and_burpees.webm
# Requires curl and ffmpeg. The .y4m output is large (~80 MB) and is git-ignored.
set -e
cd "$(dirname "$0")/.."
mkdir -p tests/fixtures/video
curl -fsSL -A "PocketRehab-test-fixture/1.0" -o tests/fixtures/video/jumping-jacks-burpees.webm \
  "https://upload.wikimedia.org/wikipedia/commons/5/57/Jumping_jacks_and_burpees.webm"
ffmpeg -v error -y -t 20 -i tests/fixtures/video/jumping-jacks-burpees.webm -vf "scale=480:360,fps=15" -pix_fmt yuv420p \
  tests/fixtures/video/jumping-jacks-burpees.y4m
echo "Wrote tests/fixtures/video/jumping-jacks-burpees.y4m"
