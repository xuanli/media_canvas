#!/usr/bin/env bash
# Run gen_media locally.
#   ./run_local.sh        → free offline mode (mock images, in-memory saves, $0)
#   ./run_local.sh real   → real fal models (~$0.04/image), in-memory saves
set -euo pipefail
cd "$(dirname "$0")"

MODE="${1:-mock}"
export STORAGE_MOCK=1   # local saves stay in-memory; Vercel Blob is production-only

if [ "$MODE" = "real" ]; then
  [ -f .env.local ] || { echo "error: .env.local with FAL_KEY required for real mode"; exit 1; }
  echo "▶ real mode: fal models live (~\$0.04/image), saves in-memory"
else
  export FAL_MOCK=1
  echo "▶ mock mode: free placeholder images, saves in-memory (./run_local.sh real for live models)"
fi

exec pnpm dev
