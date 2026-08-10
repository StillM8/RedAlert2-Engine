# Red Alert 2 Android shell

This module wraps the existing TypeScript/Three.js engine in an Android
`WebView`. The game simulation and renderer remain in `redalert2/`; this
project supplies the Android lifecycle, fullscreen, power-state, renderer
recovery, and offline resource-serving layer.

## Local build

1. Run the repository setup script against your legally-owned RA2/Yuri's Revenge install.
2. Build and install the debug app:

```sh
./scripts/build-android.sh --device
```

The script stages `redalert2/dist/` into `app/src/main/assets/WebDist/` and,
when `gameres-export/` exists, stages it into `app/src/main/assets/GameRes/`.
Those directories are ignored because retail-derived files must not be
committed or distributed.

The packaged URL is HTTPS on Android's reserved app-assets origin. The custom
WebView client adds the cross-origin isolation headers needed by the web build
and maps `/gameres/` to packaged assets or a future private app/asset-pack
directory.
