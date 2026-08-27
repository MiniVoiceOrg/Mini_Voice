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
| Avast (or another antivirus) flags the installer/updater | False positive — see [Antivirus: Avast and similar](#antivirus-avast-and-similar) |

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
