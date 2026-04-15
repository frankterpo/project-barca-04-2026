#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
DOCS_AI="$PROJECT_ROOT/docs/ai"
GSTACK_DIR="$HOME/.gstack"
SLUG=$(basename "$PROJECT_ROOT")

mkdir -p "$DOCS_AI/snapshots"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
SNAPSHOT_DIR="$DOCS_AI/snapshots/$TIMESTAMP"
mkdir -p "$SNAPSHOT_DIR"

echo "Snapshotting AI artefacts to $SNAPSHOT_DIR..."

if [ -f "$GSTACK_DIR/projects/$SLUG/learnings.jsonl" ]; then
  cp "$GSTACK_DIR/projects/$SLUG/learnings.jsonl" "$SNAPSHOT_DIR/learnings.jsonl"
  echo "  Copied learnings.jsonl"
fi

for pattern in "PLAN-*.md" "PRD-*.md" "DESIGN-*.md" "ARCHITECTURE-*.md"; do
  for f in $PROJECT_ROOT/$pattern $PROJECT_ROOT/docs/$pattern $PROJECT_ROOT/docs/ai/$pattern; do
    if [ -f "$f" ]; then
      cp "$f" "$SNAPSHOT_DIR/"
      echo "  Copied $(basename "$f")"
    fi
  done
done

if [ -f "$PROJECT_ROOT/CHANGELOG.md" ]; then
  cp "$PROJECT_ROOT/CHANGELOG.md" "$SNAPSHOT_DIR/"
  echo "  Copied CHANGELOG.md"
fi

cat > "$SNAPSHOT_DIR/README.md" << EOF
# Snapshot $TIMESTAMP

Captured: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
Branch: $(git branch --show-current 2>/dev/null || echo "unknown")
Commit: $(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

## Contents
$(ls -1 "$SNAPSHOT_DIR" | grep -v README.md | sed 's/^/- /')
EOF

echo "Snapshot saved to $SNAPSHOT_DIR"
echo "Commit with: git add docs/ai/snapshots && git commit -m 'docs: ai artefact snapshot $TIMESTAMP'"
