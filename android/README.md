# Red Alert 2 Android shell

This module wraps the existing TypeScript/Three.js engine in an Android
`WebView`. The game simulation, renderer, and generic Ares compatibility layer
remain in `redalert2/`; this project supplies the Android lifecycle, fullscreen,
power-state, renderer recovery, and offline resource-serving layer.

This is one Android product. The in-game Mods screen is the user-facing
content switcher. Selecting a built-in game or an imported mod from
**Menu → Mods** writes the active route, persists it, and performs a full
engine reload; there is no separate startup content/profile picker.

| Build | Package |
|---|---|---|
| debug | `com.ammaar.ra2android.debug` |
| release | `com.ammaar.ra2android` |

## Local build

Normal Android builds are engine-only APKs. They do not package retail game
files, even when `gameres-export/` exists in the checkout. Import a complete
copy of your own legally-owned RA2/Yuri's Revenge base from the app's
game-resource picker after installation. Mental Omega is imported separately
from **Menu → Mods** as a YR-based mod.

Build and install the debug app:

```sh
./scripts/build-android.sh --device
```

The first launch uses Red Alert 2 only as the neutral bootstrap. Switching
content is done from **Menu → Mods** and reloads the shared engine. The last
selected entry is used on the next launch until it is replaced or its base/mod
files are removed. The list includes built-in Red Alert 2 and Yuri's Revenge
entries plus imported mods. A YR-based mod remains separate from the YR base:
import the legally-owned Yuri's Revenge files as the base game, then import
the mod from the Mods screen. Connect a device with USB debugging enabled
before using `--device`; the script installs and launches the unified package.

Large mod-folder imports run under a temporary low-priority Android
notification and show copy progress in the app. The notification remains
visible through the native copy and the final WebView storage copy, and the
mod is not selectable until that second phase commits successfully.

The script stages `redalert2/dist/` into `app/src/main/assets/WebDist/`. It
removes any previously staged `GameRes/` directory for the default engine-only
build, so old local assets cannot leak into a normal APK. The local
`gameres-export/` directory is used only when explicitly requested for QA:

```sh
./scripts/build-android.sh --with-gameres
```

That opt-in requires `gameres-export/`. Retail-derived files remain ignored and
are never committed or distributed by default. `--no-gameres` remains accepted
as a legacy alias for the default engine-only behavior.

The packaged URL is HTTPS on Android's reserved app-assets origin. The custom
WebView client adds the cross-origin isolation headers needed by the web build
and keeps `/gameres/` for imported user content while reserving
`/gameres-bundle/` for optional packaged seed assets. An engine-only APK returns
404 for the latter, so an existing import is not rescanned as a bundled seed.
When Android backgrounds the app, single-player writes a shared action-log
checkpoint; multiplayer is not restored from that local checkpoint.
