#!/usr/bin/env bash
# Build the web engine, stage it into the Android WebView shell, and build an APK.
#
#   ./scripts/build-android.sh                 # Red Alert 2 debug APK
#   ./scripts/build-android.sh --variant yr    # Yuri's Revenge debug APK
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
VARIANT=ra2

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-web) SKIP_WEB=1 ;;
    --no-gameres) SKIP_GAMERES=1 ;;
    --device) INSTALL=1 ;;
    --variant)
      [[ $# -ge 2 ]] || { echo "error: --variant requires ra2 or yr" >&2; exit 2; }
      VARIANT="$2"
      shift
      ;;
    *) echo "error: unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

die() { echo "error: $*" >&2; exit 1; }

case "$VARIANT" in
  ra2)
    GRADLE_VARIANT=ra2Debug
    APK_NAME=app-ra2-debug.apk
    PACKAGE_NAME=com.ammaar.ra2android.debug
    ;;
  yr)
    GRADLE_VARIANT=yrDebug
    APK_NAME=app-yr-debug.apk
    PACKAGE_NAME=com.ammaar.yurirevengeandroid.debug
    ;;
  *) die "unsupported Android variant '$VARIANT' (expected ra2 or yr)" ;;
esac

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

(cd "$ANDROID" && "${GRADLE[@]}" ":app:assemble${GRADLE_VARIANT^}")
APK="$ANDROID/app/build/outputs/apk/${GRADLE_VARIANT}/$APK_NAME"
if [[ ! -f "$APK" ]]; then
  APK="$(find "$ANDROID/app/build/outputs/apk" -type f -name "$APK_NAME" -print -quit)"
fi
[[ -f "$APK" ]] || die "Gradle finished but $APK_NAME was not found"
echo "APK: $APK"
echo "Package: $PACKAGE_NAME"

if [[ $INSTALL -eq 1 ]]; then
  command -v adb >/dev/null 2>&1 || die "adb is required for --device"
  adb install -r "$APK"
  adb shell am force-stop "$PACKAGE_NAME" || true
  adb shell monkey -p "$PACKAGE_NAME" 1 >/dev/null
fi
