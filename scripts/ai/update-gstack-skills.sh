#!/usr/bin/env bash
set -euo pipefail

GSTACK_UPSTREAM="${GSTACK_UPSTREAM:-$HOME/gstack}"
PROJECT_SKILLS="$(git rev-parse --show-toplevel)/.agents/skills/gstack"

if [ ! -d "$GSTACK_UPSTREAM" ]; then
  echo "gstack not found at $GSTACK_UPSTREAM"
  echo "Clone it first: git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git $GSTACK_UPSTREAM"
  exit 1
fi

echo "Pulling latest gstack..."
cd "$GSTACK_UPSTREAM"
git pull --ff-only 2>/dev/null || git fetch origin && git reset --hard origin/main

if command -v bun &>/dev/null; then
  echo "Regenerating skill docs (--host codex for .agents/skills compat)..."
  bun install --frozen-lockfile 2>/dev/null || bun install
  bun run gen:skill-docs --host codex 2>/dev/null || echo "gen:skill-docs not available, copying raw skills"
fi

echo "Syncing skills to $PROJECT_SKILLS..."
mkdir -p "$PROJECT_SKILLS"
rsync -a --delete --exclude='node_modules' --exclude='.git' "$GSTACK_UPSTREAM/" "$PROJECT_SKILLS/"

echo "Done. Skills updated at $PROJECT_SKILLS"
echo "Commit with: git add .agents/skills && git commit -m 'chore: update gstack skills'"
