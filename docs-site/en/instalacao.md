# Installation

Download the build for your system from the [download page](/en/download) — the buttons point straight at the right file from the latest release.

| System | File | Note |
|---|---|---|
| Windows 10/11 (x64) | `Monky-<version>-win-x64-setup.exe` | Installer — lets you pick the folder |
| Windows 10/11 (x64) | `Monky-<version>-win-x64-portable.exe` | Installs nothing, just run it |
| macOS (Intel / Apple Silicon) | `Monky-<version>-mac-<arch>.dmg` | Pick `x64` (Intel) or `arm64` (M1/M2/M3+) |

## Security warnings

Windows and macOS may show a warning because the executables are not signed with a paid certificate yet.

- **Windows**: click *More info › Run anyway*.
- **macOS**: right-click the app and choose *Open*.

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

To verify release checksums and signatures, see [Verify Releases](/en/verificar-releases).
