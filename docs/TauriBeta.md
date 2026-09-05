# Tauri beta shell

The repository now contains a Tauri 2 beta shell at `redalert2/src-tauri/`.
It packages the existing Vite/TypeScript/Three.js client; it does not replace
the simulation engine, add a second renderer, or bundle retail game files.

## Targets

| Target | Command | Host requirement |
| --- | --- | --- |
| Windows | `bun run tauri:build -- --target x86_64-pc-windows-msvc --no-bundle` | Windows, Rust, MSVC C++ Build Tools, WebView2 |
| Linux | `bun run tauri:build` | Rust and WebKitGTK 4.1 development packages |
| macOS Apple Silicon | `bun run tauri:build -- --target aarch64-apple-darwin` | Apple Silicon macOS, Rust, Xcode Command Line Tools |
| macOS Intel | `bun run tauri:build -- --target x86_64-apple-darwin` | Intel macOS, Rust, Xcode Command Line Tools |

Tauri must build on macOS because the Apple SDK, linker, and WebKit frameworks
are not available in WSL/Linux. The release workflow builds and validates
separate Apple Silicon and Intel bundles, DMGs, and `.app.zip` archives. See
`docs/ReleaseCI.md` for the release contract and signing paths. A universal
local bundle remains possible, but it is not the artifact contract used by
release CI.

For Windows portable releases, use the MSVC target. The MSVC WebView2 binding
uses `WebView2LoaderStatic.lib`, so the result is one `redalert2-desktop.exe`
instead of the GNU cross-build's EXE plus `WebView2Loader.dll`. This does not
bundle the WebView2 browser runtime itself; the target Windows machine still
needs WebView2 installed. Release CI verifies both the portable executable and
the NSIS installer. See `docs/ReleaseCI.md` for the complete artifact list.

Run the desktop beta locally with:

```sh
bun run tauri:dev
```

The beta uses the existing user-owned resource import flow. No RA2, Yuri's
Revenge, or Mental Omega files are included in the application bundle.
After importing content, select it from **Menu → Mods**. The selected entry is
persisted and the engine reloads from that entry on the next launch; the
desktop shell does not expose a separate runtime/profile boot selector.

The desktop Mods screen provides separate **Import ZIP...** and **Import
Folder...** actions. ZIP archives are extracted by the Tauri shell before the
shared TypeScript content importer copies the files into private app storage;
an already-extracted mod folder is copied directly. The application still
ships without RA2, Yuri's Revenge, Mental Omega, or any other game archives.

## Mobile implementations

Tauri is intentionally desktop-only. Android continues to use the existing
Kotlin/WebView shell, and iOS continues to use the existing Swift/WKWebView
shell. Their tested offline resource, lifecycle, touch, and device-specific
handling is not being replaced by Tauri.

## Release identity

The Tauri bundle is currently `0.1.0-beta.1` with identifier
`io.stillm8.rtsengine.desktop` and product name **Open RTS Engine**. Update the
version in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` together for
the next beta. The identifier is intentionally independent from the names of
the games and mods whose content the engine can import.
