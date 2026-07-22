#!/usr/bin/env bash
# Run gen_media locally.
#   ./run_local.sh        → free offline mode (mock images, in-memory saves, $0)
#   ./run_local.sh real   → real fal models (~$0.04/image), in-memory saves
set -euo pipefail
cd "$(dirname "$0")"

MODE="${1:-mock}"

if [ "$MODE" = "real" ]; then
  [ -f .env.local ] || { echo "error: .env.local with FAL_KEY required for real mode"; exit 1; }
  if grep -q "^BLOB_READ_WRITE_TOKEN=" .env.local; then
    # real storage: canvases persist to the SAME Vercel Blob store production uses
    echo "▶ real mode: fal models live (~\$0.04/image), canvases saved to Vercel Blob (shared with prod)"
  else
    export STORAGE_MOCK=1
    echo "▶ real mode: fal models live, but no BLOB_READ_WRITE_TOKEN — saves in-memory"
  fi
else
  export FAL_MOCK=1
  export STORAGE_MOCK=1   # mock mode stays fully offline
  echo "▶ mock mode: free placeholder images, saves in-memory (./run_local.sh real for live models)"
fi

exec pnpm dev
