# Android shell

This directory contains the Kotlin/WebView shell for the shared Red Alert 2
engine. The simulation, renderer, resource importer, Mods menu, and Ares
compatibility layer live in [`../redalert2/`](../redalert2/); Android supplies
the lifecycle, storage, file picker, notifications, fullscreen handling, and
APK packaging.

See the [repository README](../README.md) for project lineage, compatibility
scope, and the Windows/Linux/macOS builds.

## Requirements

- Bun 1.3 or newer
- JDK 17
- Android SDK with API 36 platform/build tools
- Gradle available on `PATH`, or set `GRADLE_BIN` to a Gradle executable
- `adb` for `--device` installation

The repository currently uses the Gradle installation selected by
`GRADLE_BIN`, `android/gradlew` when present, or the `gradle` command on
`PATH`.

## Build from the repository root

Build the normal engine-only debug APK:

```sh
./scripts/build-android.sh
```

Build the unsigned release APK:

```sh
./scripts/build-android.sh --release
```

Build, install, and launch the debug APK on a connected device:

```sh
./scripts/build-android.sh --device
```

The debug and release application IDs are:

| Build | Application ID |
| --- | --- |
| Debug | `com.ammaar.ra2android.debug` |
| Release | `com.ammaar.ra2android` |

Use `--no-web` to reuse an existing `redalert2/dist/` build. The normal build
does not package RA2, Yuri's Revenge, Mental Omega, or any other game files.

`--with-gameres` is an opt-in local QA mode only. It stages the local,
gitignored `gameres-export/` directory into the APK and must never be used for
the normal distributable build:

```sh
./scripts/build-android.sh --with-gameres
```

## Import and select content

On first launch, import your own game files through the in-app resource picker.
After the base files are available, use **Menu → Mods** to select Red Alert 2,
Yuri's Revenge, or an imported mod. The selection persists across launches and
reinitializes the shared engine when changed.

A Yuri's Revenge-based mod uses a separately imported Yuri's Revenge base.
Mental Omega is **not claimed as fully compatible**; support is being built
toward the Ares features that it requires. The app does not bundle Mental
Omega or any other mod archive.

Large folder imports run in the background with native progress notification.
The imported content is stored in the app's private storage and is not written
back into the repository.

## Development notes

The build script:

1. Builds the shared web engine into `redalert2/dist/`.
2. Stages it into `app/src/main/assets/WebDist/`.
3. Removes any stale packaged `GameRes/` directory for normal builds.
4. Runs the Android Gradle build.

The Android shell keeps the WebView and selected content route when the app is
backgrounded. Single-player checkpoints may be used after the operating system
recreates the process; live multiplayer sessions are not reconstructed from a
local checkpoint.
