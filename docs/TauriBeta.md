# Tauri beta shell

The repository now contains a Tauri 2 beta shell at `redalert2/src-tauri/`.
It packages the existing Vite/TypeScript/Three.js client; it does not replace
the simulation engine, add a second renderer, or bundle retail game files.

## Targets

| Target | Command | Host requirement |
| --- | --- | --- |
| Windows | `bun run tauri:build` | Rust, MSVC C++ Build Tools, WebView2 |
| Linux | `bun run tauri:build` | Rust and WebKitGTK 4.1 development packages |
| macOS | `bun run tauri:build` | Rust and Xcode Command Line Tools |
| Android | `bun run tauri:android:init`, then `bun run tauri:android:build` | Rust Android targets, Android Studio/SDK/NDK |
| iOS | `bun run tauri:ios:init`, then `bun run tauri:ios:build` | macOS, Xcode, iOS Rust targets, CocoaPods |

Run the desktop beta locally with:

```sh
bun run tauri:dev
```

The beta uses the existing user-owned resource import flow. No RA2, Yuri's
Revenge, or Mental Omega files are included in the application bundle.

## Mobile status

The Tauri project is configured for Tauri Android/iOS initialization, while the
existing Kotlin Android and Swift/WKWebView iOS shells remain the current
certified mobile paths. Keeping them in place avoids replacing their tested
offline resource, lifecycle, and device-specific handling before the equivalent
Tauri mobile bridge is verified.

The next mobile-beta checkpoint is to connect Tauri's native file dialog/filesystem
APIs to the shared game-resource importer and then validate lifecycle recovery,
offline imports, touch input, and device builds on real hardware.

## Release identity

The Tauri bundle is currently `0.1.0-beta.1` with identifier
`com.stillm8.redalert2`. Update the version in `src-tauri/tauri.conf.json` and
`src-tauri/Cargo.toml` together for the next beta.
