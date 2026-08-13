#!/usr/bin/env bash
#
# One-shot setup: point this at your own Red Alert 2 (+ Yuri's Revenge)
# install and it does the rest — dependency install, retail-file
# verification, asset import/conversion. Nothing is downloaded; every game
# asset comes from YOUR copy of the game and stays on your machine.
#
#   ./scripts/setup.sh "/path/to/steamapps/common/Command & Conquer Red Alert 2"
#
# With no argument, common Steam locations are searched automatically.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
die()  { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- prereqs
bold "Checking prerequisites..."
command -v bun >/dev/null 2>&1 || die "bun is required. Install: curl -fsSL https://bun.sh/install | bash"
echo "  bun $(bun --version)"
if command -v ffmpeg >/dev/null 2>&1; then
  echo "  ffmpeg OK (music conversion enabled)"
else
  echo "  ffmpeg not found (optional music conversion will be skipped)"
fi

# ------------------------------------------------------------ find retail
RETAIL="${1:-${RA2_RETAIL_DIR:-}}"
if [ -z "$RETAIL" ]; then
  bold "No path given — searching common Steam locations..."
  CANDIDATES=(
    "$HOME/Library/Application Support/Steam/steamapps/common/Command & Conquer Red Alert 2"
    "$HOME/Library/Application Support/Steam/steamapps/common/Command and Conquer Red Alert 2"
    "$HOME/.steam/steam/steamapps/common/Command & Conquer Red Alert 2"
    "/Applications/CnCNet/RedAlert2"
  )
  for c in "${CANDIDATES[@]}"; do
    if [ -e "$c/ra2.mix" ] || [ -e "$c/RA2.MIX" ]; then RETAIL="$c"; break; fi
  done
  [ -n "$RETAIL" ] || die "couldn't auto-detect an install. Pass the path: ./scripts/setup.sh \"/path/to/Red Alert 2\""
fi
[ -d "$RETAIL" ] || die "not a directory: $RETAIL"

has_file() { # case-insensitive existence check
  local dir="$1" name="$2"
  [ -e "$dir/$name" ] || [ -e "$dir/$(echo "$name" | tr '[:lower:]' '[:upper:]')" ] || [ -e "$dir/$(echo "$name" | tr '[:upper:]' '[:lower:]')" ]
}

bold "Verifying retail files in: $RETAIL"
for f in ra2.mix language.mix multi.mix; do
  has_file "$RETAIL" "$f" || die "missing $f — is this really an RA2 install directory?"
  echo "  $f OK"
done
YR=1
for f in ra2md.mix langmd.mix; do
  if ! has_file "$RETAIL" "$f"; then YR=0; fi
done
if [ "$YR" = "1" ]; then
  echo "  ra2md.mix / langmd.mix OK — Yuri's Revenge content available"
else
  echo "  (Yuri's Revenge files not found — the port runs best with YR; RA2-classic still works)"
fi

# -------------------------------------------------------------- deps
bold "Installing web dependencies..."
(cd redalert2 && bun install)

# -------------------------------------------------------------- import
bold "Importing game assets from your install (this takes a few minutes)..."
RA2_RETAIL_DIR="$RETAIL" bun scripts/prepare-gameres.ts

# -------------------------------------------------------------- done
bold "Done! Next steps:"
cat <<'EOF'

  Desktop dev server (no Xcode needed):
    cd redalert2 && RA2_HTTP=1 bun run dev
    open http://localhost:4000/?shell=1

  iOS simulator build (needs Xcode + xcodegen: brew install xcodegen):
    ./scripts/build-ios.sh

  iPhone/iPad device build (needs an Apple developer team id):
    RA2_TEAM_ID=<your-team-id> ./scripts/build-ios.sh --device

Everything imported lives in gameres-export/ (gitignored). Re-run this
script any time; it rebuilds the asset tree from your install.
EOF
