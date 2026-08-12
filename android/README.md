# Red Alert 2 Android shell

This module wraps the existing TypeScript/Three.js engine in an Android
`WebView`. The game simulation, renderer, and generic Ares compatibility layer
remain in `redalert2/`; this project supplies the Android lifecycle, fullscreen,
power-state, renderer recovery, and offline resource-serving layer.

The Gradle flavors select the shared engine profile:

| Flavor | Profile | Debug package |
|---|---|---|
| `ra2` | Red Alert 2 | `com.ammaar.ra2android.debug` |
| `yr` | Yuri's Revenge | `com.ammaar.yurirevengeandroid.debug` |
| `mo` | Mental Omega + Ares-compatible runtime | `com.ammaar.mentalomegaandroid.debug` |

## Local build

1. Run the repository setup script against your legally-owned RA2/Yuri's Revenge install.
2. Build and install the debug app:

```sh
./scripts/build-android.sh --variant mo --device
```

The MO build requires a local `gameres-export/` containing the Yuri's Revenge
base archives and `expandmo##.mix` files. The large retail-derived payload is
never committed. Connect a device with USB debugging enabled before using
`--device`; the script installs with `adb` and launches the selected package.

The script stages `redalert2/dist/` into `app/src/main/assets/WebDist/` and,
when `gameres-export/` exists, stages it into `app/src/main/assets/GameRes/`.
Those directories are ignored because retail-derived files must not be
committed or distributed.

The packaged URL is HTTPS on Android's reserved app-assets origin. The custom
WebView client adds the cross-origin isolation headers needed by the web build
and maps `/gameres/` to packaged assets or a future private app/asset-pack
directory. When Android backgrounds the app, single-player writes a shared
action-log checkpoint; multiplayer is not restored from that local checkpoint.
