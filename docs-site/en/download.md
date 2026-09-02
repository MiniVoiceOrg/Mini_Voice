---
title: Download
---

# Download

The buttons below point straight at the files from the latest release — no need to hunt for anything on GitHub.

<DownloadPanel lang="en" />

## Which file to pick

| System | File | Note |
|---|---|---|
| Windows 10/11 (x64) | `Monky-<version>-win-x64-setup.exe` | Installer — lets you pick the folder |
| Windows 10/11 (x64) | `Monky-<version>-win-x64-portable.exe` | Installs nothing, just run it |
| macOS (Intel / Apple Silicon) | `Monky-<version>-mac-<arch>.dmg` | Pick `x64` (Intel) or `arm64` (M1/M2/M3+) |

## After downloading

Windows and macOS may show a warning the first time you open Monky, because the executables are not signed with a paid certificate yet. It is not a sign of a corrupted file.

- **Windows**: click _More info › Run anyway_.
- **macOS**: right-click the app and choose _Open_.

### macOS: "The application is damaged and can't be opened"

On macOS (especially on Apple Silicon), Gatekeeper may block the app with the message **"is damaged and can't be opened"**. The file is **not** corrupted — it's just the security quarantine, because the app is not notarized by Apple yet.

After moving **Monky.app** to the *Applications* folder, open Terminal and run:

```bash
xattr -dr com.apple.quarantine /Applications/Monky.app
```

Then open the app normally. If it still complains, force a local (ad-hoc) re-sign:

```bash
sudo xattr -cr /Applications/Monky.app
codesign --force --deep --sign - /Applications/Monky.app
```

## Updates

The app tells you when a new version is out. You can also check under **Settings › About and Updates › Check for updates**.

On Windows the update applies itself: Monky downloads it, installs it and reopens.

On macOS the system will not replace an app that is running, so Monky downloads the `.dmg`, opens the install window and then **closes itself**. Drag Monky into your *Applications* folder, confirm the replacement and open the app again.

To confirm the file you downloaded is the one we published, see [Verify Releases](/en/verificar-releases) — every release ships SHA-256 checksums and a Cosign signature.

## About the beta channel

Betas ship ahead of the stable release so you can try what is coming next. They go through the same build and signing pipeline, but may carry problems that have not surfaced yet. If you just want to use Monky, stay on stable.

You can receive betas through the app itself, without downloading anything by hand, under **Settings › About and Updates**.

## About the CLI

The CLI is for hosting a server without a graphical interface, such as on a VPS. The full command reference is in [Monky CLI](/en/cli), and the hosting guide is in [Host on a VPS](/en/hospedar-em-vps).
