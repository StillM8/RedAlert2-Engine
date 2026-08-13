# Tauri beta shell

The repository now contains a Tauri 2 beta shell at `redalert2/src-tauri/`.
It packages the existing Vite/TypeScript/Three.js client; it does not replace
the simulation engine, add a second renderer, or bundle retail game files.

## Targets

| Target | Command | Host requirement |
| --- | --- | --- |
| Windows | `bun run tauri:build -- --target x86_64-pc-windows-msvc --no-bundle` | Windows, Rust, MSVC C++ Build Tools, WebView2 |
| Linux | `bun run tauri:build` | Rust and WebKitGTK 4.1 development packages |
| macOS | `bun run tauri:build -- --target universal-apple-darwin` | macOS, Rust, Xcode Command Line Tools |

The macOS target is built as a universal bundle. It contains both
`aarch64-apple-darwin` (Apple Silicon) and `x86_64-apple-darwin` (Intel), so
the same `.app` or `.dmg` runs on both Mac architectures. Tauri must build it
on macOS because the Apple SDK, linker, and WebKit frameworks are not
available in WSL/Linux. The repository includes a manually-triggerable GitHub
Actions workflow at `.github/workflows/tauri-macos.yml` for producing the
unsigned universal bundle.

For Windows portable releases, use the MSVC target. The MSVC WebView2 binding
uses `WebView2LoaderStatic.lib`, so the result is one `redalert2-desktop.exe`
instead of the GNU cross-build's EXE plus `WebView2Loader.dll`. This does not
bundle the WebView2 browser runtime itself; the target Windows machine still
needs WebView2 installed. The repository includes a manually-triggerable
workflow at `.github/workflows/tauri-windows.yml` that verifies the single-file
output.

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
`com.stillm8.redalert2`. Update the version in `src-tauri/tauri.conf.json` and
`src-tauri/Cargo.toml` together for the next beta.
