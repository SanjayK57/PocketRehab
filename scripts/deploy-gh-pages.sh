#!/bin/sh
# Builds PocketRehab for GitHub Pages and publishes dist/ to the gh-pages branch.
# Usage: npm run deploy   (needs push access to the repository)
set -e
cd "$(dirname "$0")/.."
REMOTE_URL="$(git remote get-url origin)"
npm run typecheck
npm test
BASE_PATH=/PocketRehab/ npx vite build
cd dist
touch .nojekyll
rm -rf .git
git init -q -b gh-pages
git add -A
git commit -q -m "Deploy PocketRehab $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git push -q -f "$REMOTE_URL" gh-pages
rm -rf .git
echo "Deployed to the gh-pages branch."
