# Cross-platform release CI

The release workflow is `.github/workflows/release.yml`. It validates the
frontend once, builds the platform packages from that validated output, checks
their format and architecture, and publishes checksums when a release is
requested. It never includes Red Alert 2, Yuri's Revenge, Mental Omega, or
other user-owned game/mod files.

## Build and publish modes

Run the workflow manually with `workflow_dispatch` to validate a source ref.
Leave **Publish/update a GitHub Release** disabled for a validation build. A
tag named `engine-v<version>` or `ra2-v<version>` publishes automatically when
it matches `redalert2/src-tauri/tauri.conf.json`; prerelease versions are
marked as prereleases.

Validation builds use development signing where a platform requires a signed
artifact: the Android APK uses the repository's existing debug fallback and
macOS uses ad-hoc signing. Windows artifacts are unsigned in this mode. A
published/tagged release must have all production signing secrets configured;
the workflow fails before packaging if a required set is incomplete.

Secrets are read only by GitHub Actions and are never committed to the
repository:

| Platform | Required production secrets |
| --- | --- |
| Android | `ANDROID_RELEASE_KEYSTORE_BASE64`, `ANDROID_RELEASE_KEYSTORE_PASSWORD`, `ANDROID_RELEASE_KEY_ALIAS`, `ANDROID_RELEASE_KEY_PASSWORD` |
| Windows | `WINDOWS_SIGNING_CERTIFICATE_BASE64`, `WINDOWS_SIGNING_CERTIFICATE_PASSWORD` |
| macOS | `MACOS_SIGNING_CERTIFICATE_BASE64`, `MACOS_SIGNING_CERTIFICATE_PASSWORD`, `MACOS_SIGNING_IDENTITY` |

The macOS certificate must be a Developer ID Application certificate in a
PKCS#12 export. The Windows certificate must be usable by `signtool.exe` for
Authenticode signing. Notarization is not claimed by this workflow; it is a
separate distribution step if macOS notarization is required later.

## Release artifacts

The checksum job requires exactly these eleven binary/package files and then
publishes one additional checksum manifest:

- Android APK
- Windows x64 portable EXE
- Windows x64 NSIS installer EXE
- Linux x64 AppImage
- Linux x64 DEB
- Linux x64 RPM
- Linux x64 portable `.tar.gz`
- macOS Apple Silicon ARM64 DMG and `.app.zip`
- macOS Intel x86_64 DMG and `.app.zip`
- `SHA256SUMS.txt`

The macOS jobs build one architecture per runner, so each DMG and app archive
has an explicit architecture in its filename. The desktop bundles contain the
engine and web client only; users import their own game and mod files through
the application.
