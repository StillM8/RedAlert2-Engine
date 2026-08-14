# Red Alert 2 Engine

Cross-platform TypeScript engine and native shells for Red Alert 2, Yuri's
Revenge, and compatible community content.

This repository contains the engine, platform integrations, import pipeline,
and development tools. It does **not** contain Red Alert 2, Yuri's Revenge,
Mental Omega, or any other game archives. Players must provide their own
legally obtained game files through the platform's import flow.

## Project direction

The product is one shared engine with platform shells:

- **Windows, Linux, and macOS:** Tauri 2 desktop shell
- **Android:** Kotlin/WebView shell
- **iOS and iPadOS:** Swift/WKWebView shell

The selected content is managed in **Menu → Mods**. Selecting a game or mod
updates the persisted content route and reinitializes the shared engine. There
are no separate application builds for Red Alert 2, Yuri's Revenge, or each
mod.

## Engine lineage

The current engine work started from the iOS/iPad rewrite at
[`ammaarreshi/RedAlert2-Mac-iOS-iPad`](https://github.com/ammaarreshi/RedAlert2-Mac-iOS-iPad).
That project wrapped the Chrono Divide/RA2WEB TypeScript engine in a native
Swift shell. This repository has since grown into an independent,
cross-platform engine project rather than a branch intended to merge back into
that starting repository.

The broader lineage includes the original Chrono Divide/RA2WEB work and the
open engine tree that was used as an early reference:

- [Chrono Divide / RA2WEB](https://www.ra2web.com/)
- [`huangkaoya/redalert2`](https://github.com/huangkaoya/redalert2)
- [`Supalosa/supalosa-chronodivide-bot`](https://github.com/Supalosa/supalosa-chronodivide-bot)

The lineage is preserved for attribution and engineering context. The current
repository is the independent home for the shared engine and its platform
shells.

## Compatibility status

Compatibility is being built incrementally and is not claimed to be complete.

| Target | Status |
| --- | --- |
| Red Alert 2 | Shared engine and user-imported content path are active development targets |
| Yuri's Revenge | Shared engine support is active development; import it as the base for YR content |
| Ares | Generic, data-driven TypeScript compatibility layer under `redalert2/src/extensions/ares/`; work continues across parsing, runtime behavior, rendering, audio, save/load, AI, and multiplayer |
| Mental Omega | **Compatibility work in progress.** The project is working toward Mental Omega support through the required Yuri's Revenge and Ares behavior; full compatibility is not claimed |
| Other mods | Supported as the required engine and Ares capabilities are implemented and tested |

Ares is part of the shared engine as a compatibility layer. It is not a
separate DLL, a separate application, or a Mental Omega-only patch. The goal is
for code to respond to declared rules and capabilities rather than to hardcode
one mod's name.

## Quick start: browser engine

### Requirements

- [Bun](https://bun.sh/) 1.3 or newer
- A modern browser with WebGL and Web Audio support
- Your own Red Alert 2 and/or Yuri's Revenge installation for gameplay

Install dependencies and run the web client:

```sh
cd redalert2
bun install
bun run dev
```

The development server runs at `http://127.0.0.1:4000`.

Build and type-check the engine:

```sh
bun run typecheck:entry
bun run build
```

For a local asset-backed setup, run the importer from the repository root:

```sh
./scripts/setup.sh "/path/to/your/Red Alert 2 installation"
```

The importer reads the files you supply and writes local, gitignored
development output under `gameres-export/` and generated web resources. It
does not download or commit game archives.

## Desktop builds: Windows, Linux, and macOS

The desktop app uses the same TypeScript engine as the browser, Android, and
iOS shells. Install the platform prerequisites first, then run these commands
from `redalert2/`:

```sh
bun install
bun run tauri:beta:check
bun run tauri:dev
```

`tauri:beta:check` runs the engine type-check and production web build.

### Windows

Build the MSVC desktop target from Windows with Rust, MSVC C++ Build Tools,
and WebView2 installed:

```sh
cd redalert2
bun run tauri:build -- --target x86_64-pc-windows-msvc --no-bundle
```

The target machine needs the WebView2 runtime. The `--no-bundle` build emits
the portable executable instead of an installer bundle.

### Linux

Build on a Linux host with Rust and the WebKitGTK 4.1 development packages:

```sh
cd redalert2
bun run tauri:build
```

Distribution package formats depend on the installed Tauri/Linux packaging
dependencies.

### macOS

Build on macOS with Rust and Xcode Command Line Tools:

```sh
cd redalert2
bun run tauri:build -- --target universal-apple-darwin
```

The universal target contains Apple Silicon and Intel macOS binaries. The
Apple SDK and WebKit frameworks mean this target must be built on macOS; it is
not a Linux/WSL cross-build.

The desktop shell supports both extracted folders and ZIP imports. It still
ships without game files; users import their own content and select it from
**Menu → Mods**.

More desktop notes are in [`docs/TauriBeta.md`](docs/TauriBeta.md).

## Mobile builds

The native shells are documented separately:

- [Android build and import guide](android/README.md)
- [iOS and iPadOS build and import guide](ios/README.md)

Both normal mobile builds package the engine only. Local game resources can
be staged for QA, but they are never part of the normal distributed build.

## Repository layout

```text
redalert2/       Shared TypeScript/React/Vite/Three.js engine and Tauri shell
android/         Kotlin/WebView Android shell
ios/             Swift/WKWebView iOS and iPadOS shell
scripts/         Import, build, and regression tooling
docs/            Compatibility and engineering notes
gameres-export/  Local imported resources; gitignored and not distributed
```

Important commands and locations:

| Path or command | Purpose |
| --- | --- |
| `redalert2/src/engine/` | Rendering, audio, resource loading, and low-level engine services |
| `redalert2/src/game/` | Rules, objects, maps, triggers, AI, and gameplay systems |
| `redalert2/src/extensions/ares/` | Generic Ares-compatible parsing, adapters, handlers, and tests |
| `redalert2/src/gui/` | Main menu, Mods menu, lobby, HUD, and in-game UI |
| `scripts/setup.sh` | Local dependency setup and user-owned resource import |
| `scripts/build-android.sh` | Web build, Android staging, Gradle APK, optional device install |
| `scripts/build-ios.sh` | Web build, iOS staging, XcodeGen, and Xcode build |
| `bun run debug:*` | Focused browser regression flows under `redalert2/` |

## Verification

Before submitting engine changes:

```sh
cd redalert2
bun run typecheck:entry
bun run build
```

When changing a specific system, run its focused regression flow as well. For
example:

```sh
bun run debug:options
bun run debug:skirmish
bun run debug:game-res-init
bun run debug:superweapon
```

A successful compile does not imply complete retail, Ares, or Mental Omega
compatibility. Gameplay, imported-resource, and platform-shell paths still
need targeted verification.

## Assets, licensing, and attribution

Do not commit or distribute proprietary Red Alert 2, Yuri's Revenge, or mod
archives. Import content from a copy the user is entitled to use.

Read [`LICENSE`](LICENSE) and [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)
before redistributing code. Components inherited from upstream projects and
third-party dependencies may have additional attribution or license terms.
Red Alert 2, Yuri's Revenge, Mental Omega, and related trademarks belong to
their respective owners.

## Acknowledgements

- [`ammaarreshi/RedAlert2-Mac-iOS-iPad`](https://github.com/ammaarreshi/RedAlert2-Mac-iOS-iPad)
- [Chrono Divide / RA2WEB](https://www.ra2web.com/)
- [`huangkaoya/redalert2`](https://github.com/huangkaoya/redalert2)
- [`Supalosa/supalosa-chronodivide-bot`](https://github.com/Supalosa/supalosa-chronodivide-bot)
- The React, Three.js, TypeScript, Bun, Tauri, Kotlin, Swift, and open-source game-development communities
