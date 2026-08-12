#!/usr/bin/env bash
# Build the web engine, stage it into the Android WebView shell, and build an APK.
#
#   ./scripts/build-android.sh                 # unified debug APK
#   ./scripts/build-android.sh --release       # unified release APK
#   ./scripts/build-android.sh --device        # debug APK + adb install
#   ./scripts/build-android.sh --no-web         # reuse redalert2/dist
#   ./scripts/build-android.sh --with-gameres   # QA-only: bundle local game files
#
# Normal builds are engine-only. Users import their own legally-owned game
# files from the Android app; local resource bundling is opt-in for QA.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/redalert2"
ANDROID="$ROOT/android"
ASSETS="$ANDROID/app/src/main/assets"
SKIP_WEB=0
BUNDLE_GAMERES=0
INSTALL=0
BUILD_TYPE=debug

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-web) SKIP_WEB=1 ;;
    --with-gameres) BUNDLE_GAMERES=1 ;;
    --no-gameres) BUNDLE_GAMERES=0 ;; # backwards-compatible engine-only alias
    --device) INSTALL=1 ;;
    --debug) BUILD_TYPE=debug ;;
    --release) BUILD_TYPE=release ;;
    *) echo "error: unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

die() { echo "error: $*" >&2; exit 1; }

APK_NAME="app-${BUILD_TYPE}.apk"
if [[ "$BUILD_TYPE" == "debug" ]]; then
  PACKAGE_NAME=com.ammaar.ra2android.debug
else
  # No release keystore is checked into the repository; Gradle emits the
  # intentionally unsigned artifact for the app owner to sign.
  APK_NAME=app-release-unsigned.apk
  PACKAGE_NAME=com.ammaar.ra2android
fi

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
if [[ $BUNDLE_GAMERES -eq 1 ]]; then
  [[ -d "$ROOT/gameres-export" ]] || die "gameres-export is missing; run scripts/setup.sh before using --with-gameres"
  cp -R "$ROOT/gameres-export" "$ASSETS/GameRes"
fi

# Large imported resource bundles make Android's asset compressor exceed the
# default 2 GiB Gradle heap. Scale the packaging process from the staged
# payload size rather than from a game/profile name; ordinary small builds
# retain the repository defaults.
if [[ $BUNDLE_GAMERES -eq 1 ]]; then
  GAMERES_SIZE_KIB="$(du -sk "$ASSETS/GameRes" | awk '{print $1}')"
  if [[ "$GAMERES_SIZE_KIB" -gt 524288 ]]; then
    export GRADLE_OPTS="${GRADLE_OPTS:-} -Dorg.gradle.jvmargs=-Xmx4g -Dorg.gradle.workers.max=1"
    echo "Large game-resource bundle (${GAMERES_SIZE_KIB} KiB); using a 4 GiB Gradle heap and one asset-compression worker"
  fi
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

(cd "$ANDROID" && "${GRADLE[@]}" ":app:assemble${BUILD_TYPE^}")
APK="$ANDROID/app/build/outputs/apk/${BUILD_TYPE}/$APK_NAME"
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
