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

Run the desktop beta locally with:

```sh
bun run tauri:dev
```

The beta uses the existing user-owned resource import flow. No RA2, Yuri's
Revenge, or Mental Omega files are included in the application bundle.

## Mobile implementations

Tauri is intentionally desktop-only. Android continues to use the existing
Kotlin/WebView shell, and iOS continues to use the existing Swift/WKWebView
shell. Their tested offline resource, lifecycle, touch, and device-specific
handling is not being replaced by Tauri.

## Release identity

The Tauri bundle is currently `0.1.0-beta.1` with identifier
`com.stillm8.redalert2`. Update the version in `src-tauri/tauri.conf.json` and
`src-tauri/Cargo.toml` together for the next beta.
