# Shared TypeScript RTS engine

This directory contains the shared real-time strategy engine and the Tauri
desktop shell. Android and iOS package the same web build inside their native
WebView-based shells.

The project started from the iOS/iPad rewrite at
[`ammaarreshi/RedAlert2-Mac-iOS-iPad`](https://github.com/ammaarreshi/RedAlert2-Mac-iOS-iPad),
which itself carries the Chrono Divide/RA2WEB TypeScript engine lineage. The
current repository is an independent cross-platform project.

## Stack

- TypeScript, React, and Vite
- Three.js/WebGL rendering
- Bun for dependency management and scripts
- Tauri 2 for the Windows, Linux, and macOS desktop shell
- Native Kotlin and Swift shells in the sibling `android/` and `ios/` directories

## Install and run

```sh
bun install
bun run dev
```

The browser development server uses `http://127.0.0.1:4000`.

Type-check and build the web engine:

```sh
bun run typecheck:entry
bun run build
```

Run the Tauri desktop shell:

```sh
bun run tauri:dev
```

Target-specific desktop commands and prerequisites are documented in the
[repository README](../README.md) and [`../docs/TauriBeta.md`](../docs/TauriBeta.md).

## Engine scope

Red Alert 2, Yuri's Revenge, and compatible mod content use one shared engine.
The user selects content from **Menu → Mods**; the selected route is persisted
and the engine is reinitialized when the selection changes.

The Ares layer under `src/extensions/ares/` is generic and data-driven. It is
being implemented incrementally across rules, runtime behavior, presentation,
save/load, AI, and multiplayer. Mental Omega compatibility is **work in
progress**, not a completed feature claim. The engine must continue to support
ordinary RA2/YR paths without hardcoded Mental Omega-only behavior.

No game archives are stored in this directory or distributed by the build.
Users import their own content through the platform shell or browser import
flow.

## Layout

```text
src/engine/             Rendering, audio, VFS, and low-level engine services
src/game/               Rules, objects, maps, triggers, AI, and simulation
src/extensions/ares/    Generic Ares compatibility parsers and adapters
src/gui/                Main menu, Mods menu, lobby, HUD, and game UI
src/network/            Multiplayer and lockstep infrastructure
src/tools/              Asset, mechanics, and scene tester entry points
scripts/                Browser regression and development tooling
src-tauri/              Tauri desktop shell
```

Focused regression scripts are available through `bun run debug:*`. Run the
script that covers the system being changed in addition to the type-check and
production build.
