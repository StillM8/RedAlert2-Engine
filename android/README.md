# Red Alert 2 Android shell

This module wraps the existing TypeScript/Three.js engine in an Android
`WebView`. The game simulation, renderer, and generic Ares compatibility layer
remain in `redalert2/`; this project supplies the Android lifecycle, fullscreen,
power-state, renderer recovery, and offline resource-serving layer.

The Gradle flavors provide the native baseline profile, while the in-game Mods
screen is the user-facing content switcher. Selecting a built-in game or an
imported mod from **Menu → Mods** writes an explicit route and performs a full
engine reload; there is no separate startup content-picker UI.

| Flavor | Profile | Debug package |
|---|---|---|
| `ra2` | Red Alert 2 | `com.ammaar.ra2android.debug` |
| `yr` | Yuri's Revenge | `com.ammaar.yurirevengeandroid.debug` |
| `mo` | Mental Omega + Ares-compatible runtime | `com.ammaar.mentalomegaandroid.debug` |

## Local build

Normal Android builds are engine-only APKs. They do not package retail game
files, even when `gameres-export/` exists in the checkout. Import a complete
copy of your own legally-owned RA2, Yuri's Revenge, or Mental Omega game folder
from the app's game-resource picker after installation.

Build and install the debug app:

```sh
./scripts/build-android.sh --variant ra2 --device
```

The `ra2`, `yr`, and `mo` flavors remain available. They provide the initial
base profile only; switching content is done from **Menu → Mods** and reloads
the shared engine. The list includes built-in Red Alert 2 and Yuri's Revenge
entries plus imported mods. A YR-based mod remains separate from the YR base:
import the legally-owned Yuri's Revenge files as the base game, then import
the mod from the Mods screen. Connect a device with USB debugging enabled
before using `--device`; the script installs and launches the selected package.

The script stages `redalert2/dist/` into `app/src/main/assets/WebDist/`. It
removes any previously staged `GameRes/` directory for the default engine-only
build, so old local assets cannot leak into a normal APK. The local
`gameres-export/` directory is used only when explicitly requested for QA:

```sh
./scripts/build-android.sh --variant mo --with-gameres
```

That opt-in requires `gameres-export/`; for the `mo` flavor it must contain
`expandmo##.mix`. Retail-derived files remain ignored and are never committed
or distributed by default. `--no-gameres` remains accepted as a legacy alias
for the default engine-only behavior.

The packaged URL is HTTPS on Android's reserved app-assets origin. The custom
WebView client adds the cross-origin isolation headers needed by the web build
and maps `/gameres/` to packaged assets or a future private app/asset-pack
directory. When Android backgrounds the app, single-player writes a shared
action-log checkpoint; multiplayer is not restored from that local checkpoint.
