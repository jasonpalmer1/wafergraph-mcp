#!/usr/bin/env bash
# Re-sync the vendored taxonomy.json snapshot from the wafergraph site repo.
#
# Only taxonomy.json is vendored (see src/data.ts for why: wafergraph.com
# bundles it into JS at build time and never emits it as a static asset, so
# it isn't live-fetchable the way companies.json/deals.json are). Run this
# after wafergraph's taxonomy changes (new segment/subsegment, renamed
# blurb, etc.), then update TAXONOMY_SNAPSHOT_DATE in src/data.ts to the
# source file's new mtime and redeploy.
set -euo pipefail

SOURCE_REPO="${WAFERGRAPH_REPO:-$HOME/projects/wafergraph}"
SOURCE_FILE="$SOURCE_REPO/data/taxonomy.json"
DEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/data"
DEST_FILE="$DEST_DIR/taxonomy.snapshot.json"

if [ ! -f "$SOURCE_FILE" ]; then
  echo "error: $SOURCE_FILE not found (set WAFERGRAPH_REPO if the site repo lives elsewhere)" >&2
  exit 1
fi

cp "$SOURCE_FILE" "$DEST_FILE"
MTIME="$(stat -f "%Sm" -t "%Y-%m-%d" "$SOURCE_FILE" 2>/dev/null || date -r "$SOURCE_FILE" +%Y-%m-%d)"

echo "Copied $SOURCE_FILE -> $DEST_FILE"
echo "Source file last modified: $MTIME"
echo "Next: update TAXONOMY_SNAPSHOT_DATE in src/data.ts to \"$MTIME\", then 'npm run deploy'."
