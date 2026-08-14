# iOS and iPadOS shell

This directory contains the Swift/WKWebView shell for the shared Red Alert 2
engine. The TypeScript simulation, renderer, resource importer, Mods menu, and
Ares compatibility layer live in [`../redalert2/`](../redalert2/); the iOS
target supplies the native lifecycle, bundle URL scheme, fullscreen landscape
window, and Apple device integration.

See the [repository README](../README.md) for project lineage, compatibility
scope, and the Windows/Linux/macOS builds.

## Requirements

- macOS with Xcode installed
- Xcode Command Line Tools
- [Bun](https://bun.sh/) 1.3 or newer
- [XcodeGen](https://github.com/yonaskolb/XcodeGen)
- An Apple developer team for a physical-device build
- `ffmpeg` is optional and is used by the local resource setup/import tools

Install the command-line prerequisites with Homebrew if needed:

```sh
brew install xcodegen ffmpeg
```

## Prepare local development resources

From the repository root, run the setup script with your own Red Alert 2
installation:

```sh
./scripts/setup.sh "/path/to/your/Red Alert 2 installation"
```

This installs web dependencies, verifies the files you supplied, and creates
local gitignored development resources. It does not download or commit game
archives.

Normal iOS builds are engine-only and expect users to import their own game
files through the app. The local resource bundle option below is for QA only.

## Build

Build the web engine, generate the Xcode project, and build for the configured
iOS Simulator:

```sh
./scripts/build-ios.sh
```

Reuse an existing web build:

```sh
./scripts/build-ios.sh --no-web
```

For a local QA build that stages `gameres-export/` into the app bundle:

```sh
./scripts/build-ios.sh --bundle-local-gameres
```

Do not use `--bundle-local-gameres` for a distributable build. The normal
application contains the engine only; users supply their own game content.

Build for a connected iPhone or iPad:

```sh
RA2_TEAM_ID=<your-team-id> RA2_LIVENESS_OK=1 ./scripts/build-ios.sh --device
```

`RA2_TEAM_ID` is the Apple developer team identifier used for signing.
Device builds also require the repository's AI-liveness check to have been
run and confirmed. The script stages `redalert2/dist/`, generates
`ios/RA2.xcodeproj` with XcodeGen, and invokes `xcodebuild`.

## Runtime content flow

The app uses one shared engine. After importing the user's base files, content
is selected from **Menu → Mods**. Changing the selection persists the route and
reinitializes the engine; there is no separate native profile picker.

Yuri's Revenge-based mods use a separately imported Yuri's Revenge base.
Mental Omega compatibility is **in progress** through the shared Ares layer;
the project does not claim full Mental Omega compatibility and does not bundle
Mental Omega files.

## Project files

| Path | Purpose |
| --- | --- |
| `Sources/GameViewController.swift` | WKWebView setup and app lifecycle integration |
| `Sources/BundleSchemeHandler.swift` | Serves the staged web engine and optional QA resources |
| `Resources/WebDist/` | Generated web build; gitignored |
| `Resources/GameRes/` | Optional local QA resources; gitignored |
| `project.yml` | XcodeGen project definition |
| `../scripts/build-ios.sh` | Reproducible web staging and Xcode build script |
