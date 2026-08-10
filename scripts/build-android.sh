#!/usr/bin/env bash
# Build the web engine, stage it into the Android WebView shell, and build an APK.
#
#   ./scripts/build-android.sh                 # debug APK
#   ./scripts/build-android.sh --device        # debug APK + adb install
#   ./scripts/build-android.sh --no-web         # reuse redalert2/dist
#   ./scripts/build-android.sh --no-gameres     # compile shell without game files
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/redalert2"
ANDROID="$ROOT/android"
ASSETS="$ANDROID/app/src/main/assets"
SKIP_WEB=0
SKIP_GAMERES=0
INSTALL=0

for arg in "$@"; do
  case "$arg" in
    --no-web) SKIP_WEB=1 ;;
    --no-gameres) SKIP_GAMERES=1 ;;
    --device) INSTALL=1 ;;
    *) echo "error: unknown argument: $arg" >&2; exit 2 ;;
  esac
done

die() { echo "error: $*" >&2; exit 1; }

if [[ $SKIP_WEB -eq 0 ]]; then
  if command -v bun >/dev/null 2>&1; then
    (cd "$WEB" && bun --bun vite build)
  elif command -v npm >/dev/null 2>&1; then
    (cd "$WEB" && npm ci && npm run build)
  else
    die "bun or npm is required to build the web engine"
  fi
fi

[[ -f "$WEB/dist/index.html" ]] || die "$WEB/dist/index.html is missing; build the web engine first"

rm -rf "$ASSETS/WebDist"
mkdir -p "$ASSETS"
cp -R "$WEB/dist" "$ASSETS/WebDist"

rm -rf "$ASSETS/GameRes"
if [[ $SKIP_GAMERES -eq 0 ]]; then
  [[ -d "$ROOT/gameres-export" ]] || die "gameres-export is missing; run scripts/setup.sh or use --no-gameres"
  cp -R "$ROOT/gameres-export" "$ASSETS/GameRes"
else
  mkdir -p "$ASSETS/GameRes"
fi

if [[ -n "${GRADLE_BIN:-}" ]]; then
  GRADLE=("$GRADLE_BIN")
elif [[ -x "$ANDROID/gradlew" ]]; then
  GRADLE=("$ANDROID/gradlew")
elif command -v gradle >/dev/null 2>&1; then
  GRADLE=(gradle)
else
  die "Gradle is required; install it or set GRADLE_BIN"
fi

(cd "$ANDROID" && "${GRADLE[@]}" :app:assembleDebug)
APK="$ANDROID/app/build/outputs/apk/debug/app-debug.apk"
echo "APK: $APK"

if [[ $INSTALL -eq 1 ]]; then
  command -v adb >/dev/null 2>&1 || die "adb is required for --device"
  adb install -r "$APK"
  adb shell am force-stop com.ammaar.ra2android.debug || true
  adb shell monkey -p com.ammaar.ra2android.debug 1 >/dev/null
fi
