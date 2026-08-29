# Troubleshooting

| Symptom | What usually fixes it |
|---|---|
| macOS says the app "is damaged and can't be opened" | It's the Gatekeeper quarantine (app not notarized yet). Run in Terminal: `xattr -dr com.apple.quarantine /Applications/Monky.app`. See [Installation](/en/instalacao#security-warnings) |
| I can't connect to my friend's server | Double-check IP and port; ask them to confirm the server is started; check firewall and port forwarding; on CGNAT, use a VPN |
| Nickname already in use | Nicknames are unique per server — pick another |
| I joined, but nobody hears me | Check microphone under Settings › Devices, watch the VAD meter, lower sensitivity and confirm the mic is not muted |
| Everyone sounds choppy | Use the Economy profile, ask broadcasters to do the same and prefer cable over Wi-Fi |
| Shared screen has no sound | Share a whole screen and check the source app volume |
| Nothing under Servers on the Network | Discovery only works on the same LAN; click Scan again and check UDP `41234` in the firewall |
| One participant is silent only for me | Right-click them and set individual volume back to 100% |
| I can only fail to talk to **one** specific person (everyone else works) | A red `link_off` icon shows next to them. You are both likely behind CGNAT with no direct route. The host can enable the [TURN relay](/en/cli#media-relay-turn); otherwise both of you need a VPN |
| Avast (or another antivirus) flags the installer/updater | False positive — see [Antivirus: Avast and similar](#antivirus-avast-and-similar) |
| On macOS, screen sharing keeps asking for permission even though it is already allowed | The permission is stuck on the previous version — see [macOS: screen permission stops working after an update](#macos-screen-permission-stops-working-after-an-update) |

## Antivirus: Avast and similar

Monky is **not code-signed yet**. Without that signature, reputation-based
antivirus products — Avast in particular — flag the installer, the app and the
updater as suspicious. It is a **false positive**: the code is open source and
releases are built automatically by GitHub Actions straight from this
repository.

### Monky folders to allow

Add these three folders to your antivirus exclusions:

| Folder | What it holds |
|---|---|
| `%LOCALAPPDATA%\Programs\Monky` | The installed application |
| `%LOCALAPPDATA%\@monkyclient-updater` | Update download cache |
| `%APPDATA%\@monky` | Your local data (identity, preferences) |

In Avast: **Menu › Settings › General › Exceptions › Add exception**.

::: tip
Paste the path with the variables (`%LOCALAPPDATA%`) straight into the field —
Windows expands them for you. `%APPDATA%` maps to `AppData\Roaming`.
:::

### The "Old uninstaller" warning during updates

While updating, Avast may flag a file named `old-uninstaller.exe` under
`%LOCALAPPDATA%\Temp\...`. This is expected: the installer **cannot delete an
uninstaller that is currently running**, so it copies the previous uninstaller
into the Windows temp folder and runs the copy from there. That behaviour comes
from NSIS/electron-builder and the path is hardcoded in the tooling — **it
cannot be pointed at a Monky folder**.

The recommended approach is to allow **only that specific detection** when it
shows up, instead of allowing the whole folder.

::: danger Warning
`%LOCALAPPDATA%\Temp` is **not a Monky folder**. It is the temporary folder
shared by all of Windows and every program on the machine. Excluding it entirely
weakens your antivirus protection against any other software, not just Monky.

We do not recommend that exclusion and it is **not the project's
responsibility**: if you choose to do it, you do so **at your own risk**.
:::

## macOS: screen permission stops working after an update

You already allowed Monky under **System Settings › Privacy & Security › Screen
Recording**, the toggle is still on, yet the app insists the permission is
missing when you try to share your screen. Turning the toggle off and on again
does not help.

The reason: macOS **does not store that permission by app name**, it stores it
against the binary's **code signature**. Since Monky is not signed with an Apple
Developer ID certificate yet, the system ends up identifying the app by the
contents of the binary itself — which change with every version. After an update
macOS sees an app with a new identity, and the permission granted to the
previous version no longer applies to it. Because the name and the path stay
identical, the old entry remains listed and checked — hence the impression that
everything is already allowed.

### How to share your screen again

Since version `3.0.0-beta007` Monky detects this state on its own. When you click
**Share Screen**, if macOS is denying the capture you get a warning with a
**Re-request permission** button: it clears the stale authorization and restarts
the app, and macOS asks again on the next attempt. Just grant it.

If you prefer doing it by hand (or you are on an older version):

1. Quit Monky completely (including the menu bar icon).
2. In **Terminal**, run:

   ```bash
   tccutil reset ScreenCapture com.monky.app
   ```

3. Open Monky and try sharing your screen.
4. When macOS asks for the permission, grant it again.

If the command does not help, remove the entry by hand: **System Settings ›
Privacy & Security › Screen Recording**, select Monky, click **−** to remove it,
then repeat step 3 so it gets added again.

::: tip Definitive fix
The real solution is signing the app with an **Apple Developer ID** certificate,
which keeps the same identity across versions and makes the permission survive
updates. That depends on a paid Apple Developer Program account; the project is
already wired to use one as soon as it is available.
:::
