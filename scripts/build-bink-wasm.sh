#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CRATE="$ROOT/wasm/bink-decoder"
OUT="$ROOT/redalert2/public/bink"
TARGET="wasm32-unknown-unknown"

if ! rustup target list --installed | grep -qx "$TARGET"; then
  rustup target add "$TARGET"
fi

cargo build --manifest-path "$CRATE/Cargo.toml" --target "$TARGET" --release
mkdir -p "$OUT"
cp "$CRATE/target/$TARGET/release/ra2_bink_decoder.wasm" "$OUT/bink_decoder.wasm"
printf 'Wrote %s (%s bytes)\n' "$OUT/bink_decoder.wasm" "$(wc -c < "$OUT/bink_decoder.wasm" | tr -d '[:space:]')"
