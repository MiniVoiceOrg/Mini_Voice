<div align="center">
  <img src="images/Logo.png" alt="Monky" width="220">
  <h1>Monky 🎙️</h1>
  <p><b>Voice, video, screen sharing and chat with your friends — on your own server, no sign-up and no middlemen.</b></p>

  <p>
    <a href="https://github.com/MonkyOrg/Monky/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/MonkyOrg/Monky?label=download&color=5865f2"></a>
    <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-green"></a>
    <a href="https://github.com/MonkyOrg/Monky/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/MonkyOrg/Monky/actions/workflows/ci.yml/badge.svg"></a>
    <a href="https://github.com/MonkyOrg/Monky/discussions/categories/ideas"><img alt="Ideas" src="https://img.shields.io/badge/ideas-vote%20here-orange"></a>
  </p>

  <p><a href="README.md">Português</a> · <b>English</b></p>
</div>

---

## 📚 Table of contents

- [What Monky is](#-what-monky-is)
- [Installing](#️-installing)
- [Getting started (the quick path)](#-getting-started-the-quick-path)
- [Create your own server](#-create-your-own-server)
- [Join a server](#-join-a-server)
- [Using the app day to day](#-using-the-app-day-to-day)
- [Settings worth adjusting](#️-settings-worth-adjusting)
- [Hosting on a VPS (or Linux/Docker)](#-hosting-on-a-vps-or-linuxdocker)
- [Monky Server (host control panel)](#️-monky-server-host-control-panel)
- [Common problems](#-common-problems)
- [Features at a glance](#-features-at-a-glance)
- [Release verification](#-release-verification)
- [Roadmap & voting](#️-roadmap--voting)
- [How to contribute](#-how-to-contribute)
- [For developers](#-for-developers)
- [License](#-license)

---

## 🤔 What Monky is

Monky is a desktop app (Windows and macOS) for talking to your friends over
voice, turning on your camera, sharing your screen and exchanging messages — a
stripped-down Discord, except **the server is yours**.

How it works in practice:

1. **One person hosts.** They click *Create Server* inside the app itself (or
   run the server on a VPS). There is no account, no email and no cloud in
   between.
2. **Friends join** by entering that server's IP and port.
3. **The conversation is direct.** The server only handles the meeting point
   (login, channels, chat and signalling). Voice, video and screen sharing
   travel **P2P (WebRTC)** from one computer to the other, which keeps latency
   low and leaves the host's bandwidth free.

Everything of yours stays with you: chat history and users live in a SQLite
file (`server.db`) on the host's machine; your nickname, avatar and preferences
are saved on your own PC.

---

## ⬇️ Installing

Download the latest version from the releases page:

**➡️ [github.com/MonkyOrg/Monky/releases/latest](https://github.com/MonkyOrg/Monky/releases/latest)**

| System | File | Note |
|---|---|---|
| Windows 10/11 (x64) | `Monky-<version>-win-x64-setup.exe` | Installer — lets you pick the folder |
| Windows 10/11 (x64) | `Monky-<version>-win-x64-portable.exe` | Installs nothing, just run it |
| macOS (Intel / Apple Silicon) | `Monky-<version>-mac-<arch>.dmg` | Pick `x64` (Intel) or `arm64` (M1/M2/M3+) |

> **Did Windows/macOS show a security warning?** That is expected: the
> executables are not signed with a paid certificate yet. On Windows, click
> *More info › Run anyway*. On macOS, right-click the app › *Open*.

**Updates:** the app tells you when a new version is out, and you can also check
any time under **Settings › About and Updates › Check for updates**.

---

## 🚀 Getting started (the quick path)

When you open the app you land on the connection screen, with two tabs: **Join
Server** and **My Servers**. Before anything else, pick your **nickname** and,
if you want, a **profile picture** (it is saved on your PC and follows you into
every server you join).

Pick your case:

- 👥 **A friend already has a server** → go to [Join a server](#-join-a-server).
- 🏠 **You want to host** → go to [Create your own server](#-create-your-own-server).

---

## 🏠 Create your own server

Under **My Servers › Create Server**, fill in:

| Field | What it does |
|---|---|
| **Your Nickname (Host)** | How you will appear to everyone else |
| **Server Name** | The name your friends will see (e.g. *Friends HQ*) |
| **Local Port** | Defaults to `3000`. Only change it if that port is already in use |
| **Access Password** | Optional. Without one, anyone with your IP can join |
| **Text Channel / Voice Channel** | The starting channels (you can create more later) |

Click **Create and Start Server**. The server starts on your machine, listens on
all of your network interfaces on the chosen port, and you join it
automatically.

**Servers you create are saved** (up to 10). Next time, just open the *My
Servers* tab and click **Start** — nothing to fill in again. **Stop** shuts the
local server down, and the **X** removes it from the list.

> ⚠️ While the host's app is closed (or the server is stopped), nobody can join.
> If the server needs to stay up 24/7, see
> [Hosting on a VPS](#-hosting-on-a-vps-or-linuxdocker).

### Inviting your friends

Once inside the server, click the **server name** (top of the channel list) ›
**Invite Friends**. The app shows the server name, **your public IP** and the
port, and the button copies everything ready to paste into WhatsApp/Discord.

Which IP to send in each situation:

| Situation | IP your friends should use |
|---|---|
| Everyone on the same home network (Wi-Fi or cable) | Your **local IP** (e.g. `192.168.0.10`) — or not even that: their app finds the server on its own |
| Friends on a different internet connection | Your **public IP** + the port forwarded on your router |
| Friends elsewhere, without touching the router | The **VPN** IP (Radmin VPN, Hamachi, ZeroTier, Tailscale…) |

### Opening access over the internet

So that someone outside your network can connect straight to your public IP:

1. **Allow the port through the Windows firewall** (or your system's) for the
   Monky application.
2. **Set up port forwarding** on your router: port `3000` (TCP) pointing at your
   PC's local IP.
3. If your ISP uses CGNAT (common on 4G/5G and some fibre plans), step 2 will
   not work — in that case use a **VPN** such as Radmin VPN or Hamachi and share
   the VPN IP.

### Administering the server

Clicking the server name also gets you to **Server Settings**, where you can
**rename the server**, **change or remove the password** and **allow or block
the soundboard** for everyone. In the *Text Channels* and *Voice Channels*
headers, **+** creates new channels and the bin icon deletes them.

---

## 👥 Join a server

The **Join Server** tab offers three routes:

**1. Servers on the network (same LAN).** Click **Scan**: for about 5 seconds
the app listens for Monky servers on your network and lists each one with its
name, IP and version. Click **Join** and you are in — no IP to type.

**2. Saved servers.** Every server you join is saved. The dot next to the name
shows whether it is **online** (green) or offline, and the list shows who is
connected right now. Click **Use** to fill in the fields, or the **X** to remove
it from the list.

**3. By hand.** Fill in:

- **Your Nickname** — must be unique within that server;
- **Server IP / Host** — whatever the host gave you;
- **Port** — usually `3000`;
- **Server Password** — only if the host set one.

Click **Join Server**.

> **Connection error?** See [Common problems](#-common-problems).

---

## 🎧 Using the app day to day

### Voice

- Click a **voice channel** in the left-hand list to join the call.
- Whoever is talking gets a **green ring** around their avatar (automatic voice
  detection — there is no push-to-talk, you speak and the app notices).
- On the bottom bar: **microphone** (mute/unmute), **headphones** (deafen — you
  stop hearing everyone and get muted yourself) and **disconnect**.
- The voice panel shows the call's **average ping** and a button to leave just
  the call while staying in the server.
- **Right-click** any participant to adjust their **individual volume** (0%
  mutes them only for you, 100% is back to normal).

### Camera and screen sharing

On the media bar, above your profile:

- 📷 **Camera** — turns the webcam on and off.
- 🖥️ **Share Screen** — opens the picker so you can choose **a whole screen or a
  specific window**. Screen audio is transmitted to the other participants too.
- 🎵 **Soundboard** — plays your sound effects into the call (see below).

Whoever is broadcasting shows a **LIVE** badge in the member list. Click a
participant's card to spotlight them (click again to go back to the grid) or use
the fullscreen button over the video.

### Chat

Every **text channel** keeps its history on the server, with avatars,
timestamps and basic message formatting. There is an anti-flood limit of 10
messages every 5 seconds.

### Soundboard

1. Under **Settings › Soundboard**, pick a **folder on your PC** containing
   `.mp3`, `.wav` or `.ogg` files.
2. In the call, click the soundboard button and play a sound — everyone hears
   it.
3. Sound **volume** and the **mute soundboard for me only** option live in the
   same settings.

The host can disable the soundboard for the whole server under *Server
Settings*.

---

## ⚙️ Settings worth adjusting

Open them from the gear icon (on the connection screen or the bottom bar).

- **Profile** — nickname and picture.
- **Devices** — pick your microphone, speaker/headphones and camera, with a
  **camera preview** and a button to refresh the list when you plug in a new
  headset.
- **Voice sensitivity (VAD)** — speak and watch the meter: leave the marker just
  above the level you see while silent. Low values pick up whispers; high values
  ignore background noise.
- **Noise suppression (RNNoise)** — removes mechanical keyboards, clicks and
  room noise using a neural network. Leave it on if your room is noisy.
- **Quality and performance profile** — affects **only what you transmit**:

  | Profile | Audio | Camera | Screen | When to use |
  |---|---|---|---|---|
  | **Economy** | 24 kbps | 360p | 480p | Slow or unstable internet |
  | **Normal** (default) | 32 kbps | 480p | 720p | General use |
  | **High Quality** | 48 kbps | 720p | 1080p | Fast internet and a PC to spare |
  | **Gaming** | 28 kbps | reduced | smooth (60 FPS) | Gaming: prioritises voice and a fluid screen |

- **Updates** — current version and a manual check.
- **Community** — shortcuts to suggest ideas, vote and report bugs.

---

## 🖧 Hosting on a VPS (or Linux/Docker)

If you want the server up 24/7, run the server alone (no graphical interface) on
a Linux machine. Requires **Node.js 20 or newer** (the project's CI uses 22).

Install the **Monky CLI** straight from a release — no cloning, no building:

```bash
npm install -g https://github.com/MonkyOrg/Monky/releases/download/v2.3.0/monky-cli-2.3.0.tgz
```

> Replace `v2.3.0` with the version you want; the list is on the
> [releases page](https://github.com/MonkyOrg/Monky/releases).

<details>
<summary>Prefer to install from source?</summary>

```bash
git clone https://github.com/MonkyOrg/Monky.git
cd Monky
npm install
npm run build
npm install -g ./apps/server
```

</details>

### Initial setup with the CLI

All VPS server administration is done through the **Monky CLI**. After
installing, use the `monky` command from anywhere.

The CLI is **interactive** — just run the command and it asks the necessary
questions:

```bash
# Configures everything: owner, server name, port, password...
monky bootstrap
```

The bootstrap asks step by step: identity code, password, nickname, server
name, port and server password. At the end, it offers to start the server
automatically.

### Starting / stopping the server

```bash
monky start      # start as daemon (PM2, auto-restart)
monky stop       # stop the server
monky restart    # restart
monky status     # show state (PID, memory, uptime)
monky logs       # real-time logs
```

After that, your friends join normally using the **VPS IP** and the port.

### Administration

Use the CLI to manage members, roles and settings. All commands are
interactive — if you don't pass arguments, it asks:

```bash
monky members          # list members
monky admin add        # shows member list to pick from
monky roles create     # create role interactively
monky config set       # configuration menu
monky --help           # all options
```

➡️ Full CLI documentation: [docs/CLI.en.md](docs/CLI.en.md)

### Ports used

| Port | Protocol | What for | Needs opening? |
|---|---|---|---|
| `3000` (or whichever you pick) | TCP | Login, chat, channels and signalling | **Yes**, on the host |
| `41234` | UDP | Automatic discovery of servers on the local network | Only to find servers on the LAN |
| High dynamic ports | UDP | Voice, video and screen (WebRTC, straight between the PCs) | Usually works already; ordinary home connections sort it out via STUN |

> P2P media uses public STUN servers to traverse NAT. There is no TURN server:
> on very restricted networks (CGNAT on both ends, corporate networks), the
> simplest way out is for everyone to join a VPN.

---

## 🖥️ Monky Server (host control panel)

If you'd rather administer the server without a terminal, use **Monky Server**,
a desktop app dedicated to whoever hosts. It does the same as the CLI, but with
a graphical interface.

Download the installer from the
[releases page](https://github.com/MonkyOrg/Monky/releases) — the files start
with `Monky-Server-`:

| System | File |
|---|---|
| Windows | `Monky-Server-<version>-win-x64-setup.exe` (or the portable build) |
| macOS | `Monky-Server-<version>-mac-<arch>.dmg` |

It has four screens:

- **Dashboard** — server state, disk usage and start/stop buttons.
- **Members** — registered members, roles and permissions.
- **Settings** — server name, port, user limit and data directory.
- **Logs** — real-time server output.

> Monky Server is for whoever **hosts**. To talk to your friends, use the
> regular Monky app.

---

## 🧯 Common problems

| Symptom | What usually fixes it |
|---|---|
| **"I can't connect to my friend's server"** | Double-check the IP and port; ask them to confirm the server is **started**; check the firewall and port forwarding on their side; if it is CGNAT, use a VPN |
| **"Nickname already in use"** | Nicknames are unique per server — pick another |
| **I joined, but nobody hears me** | Check the microphone under *Settings › Devices*, see whether the VAD meter reacts when you speak, lower the **voice sensitivity**, and confirm the mic is not muted on the bottom bar |
| **Everyone sounds choppy** | Switch to the **Economy** profile, ask whoever is broadcasting to do the same, and prefer cable over Wi-Fi |
| **The shared screen has no sound** | Share a **whole screen** instead of a window, and check the volume of the source app |
| **Nothing shows up under "Servers on the network"** | Discovery only works on the same local network; click **Scan** again and check whether the firewall blocks UDP `41234` |
| **One participant is silent only for me** | Right-click their name → set individual volume back to 100% |

---

## ✨ Features at a glance

- 🔊 **P2P voice (WebRTC mesh)** with low latency, no audio routed through the server.
- 🟢 **Speech detection (VAD)** with adjustable sensitivity and a live meter.
- 🤖 **AI noise suppression (RNNoise)**.
- 📷 **Camera** with adaptive resolution and bitrate.
- 🖥️ **Screen or window sharing**, with audio.
- 💬 **Chat** with persistent history, avatars and anti-flood protection.
- 🎵 **Soundboard** from a folder on your PC, with host-side control.
- 📡 **Automatic server discovery** on the local network.
- 🎛️ **Quality profiles** (Economy, Normal, High Quality and Gaming).
- 🛡️ **Self-hosted server** with SQLite, `scrypt` password hashing and strict
  validation of avatar uploads.

---

## 🔐 Release verification

Every release is signed with [Sigstore Cosign](https://docs.sigstore.dev/)
(keyless, through GitHub Actions OIDC). To verify a download's authenticity:

```bash
# 1. Download the file, checksums-sha256.txt, .sig and .crt from the release

# 2. Verify integrity (SHA256)
sha256sum -c checksums-sha256.txt

# 3. Verify the cryptographic signature (requires cosign)
cosign verify-blob \
  --signature checksums-sha256.txt.sig \
  --certificate checksums-sha256.txt.crt \
  --certificate-identity-regexp "https://github.com/MonkyOrg/Monky" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  checksums-sha256.txt
```

This proves the artifact was produced by the project's official pipeline and has
not been tampered with.

---

## 🗳️ Roadmap & voting

What goes into the next versions is decided by the community — and you **do not
need to know how to code** to take part.

- 💡 **[Suggest an idea](https://github.com/MonkyOrg/Monky/discussions/new?category=ideas)** — one proposal per discussion
- ⬆️ **[See and vote on ideas](https://github.com/MonkyOrg/Monky/discussions/categories/ideas)** — before suggesting, check whether someone already asked for the same thing
- 📋 **[Open issues](https://github.com/MonkyOrg/Monky/issues)** — what is already planned and what is in progress
- 🐛 **[Report a bug](https://github.com/MonkyOrg/Monky/discussions/new?category=bug-reports)** — bugs start in Discussions and become issues once confirmed, no voting

In the first week of every month, the three most-voted ideas (with at least 5
votes) become issues and enter the development flow. The status goes back to the
original discussion (`planejado`, `em-andamento`, `entregue` or
`fora-de-escopo`, always with the reason).

The same shortcuts are inside the app, under **Settings › Community**.

---

## 🤝 How to contribute

Every bit helps, and most of it **does not require writing code**.

### Without coding

| What to do | Where |
|---|---|
| Suggest a feature | [Discussions › Ideas](https://github.com/MonkyOrg/Monky/discussions/new?category=ideas) — one proposal per discussion |
| Vote on what comes first | [Open ideas](https://github.com/MonkyOrg/Monky/discussions/categories/ideas) — the votes decide the next cycle |
| Report a bug | [Discussions › Bug Reports](https://github.com/MonkyOrg/Monky/discussions/new?category=bug-reports) — with steps to reproduce |
| Test a beta build | **Settings › About and Updates › Receive beta versions** |
| Improve the documentation | A PR straight to this `README.en.md`, to `README.md` or to `CONTRIBUTING.md` |

Helping with testing is especially useful: the project runs on Windows and
macOS, across very different networks (LAN, VPN, public IP, CGNAT), and most
problems show up precisely in that variety.

### With code

1. **Pick an issue.** The [open issues](https://github.com/MonkyOrg/Monky/issues)
   show what is already planned; comment on the one you want so nobody works on
   it twice. If it is something new, open an issue first — it saves you from
   building something that will not be accepted.
2. **Fork the repo** and create your branch **from an up-to-date `main`**:
   ```bash
   git checkout main && git pull
   git checkout -b feat/my-change
   ```
3. **Run the project** — the commands are under
   [For developers](#-for-developers).
4. **Open the PR against `main`.** CI compiles and packages on Windows and
   macOS; **a PR only lands with both checks green**.
5. **Describe how to test it** in the PR description: what changed and the steps
   for someone to validate it. That is what makes review move fast.

`main` is protected and every merge goes through a squashed PR.

📖 **The full process — code standards, project structure, what Monky is and is
not — lives in [CONTRIBUTING.en.md](CONTRIBUTING.en.md).**

---

## 💻 For developers

Requirements: **Node.js 20 or newer** (CI uses 22) and npm. On Windows, the
native screen-audio module needs **Python 3.11** and the **Visual Studio Build
Tools (MSVC)**.

```bash
npm install          # installs every workspace
npm run build        # builds shared + server + client + server-gui
npm start            # opens the Electron app
npm test             # runs the tests across all workspaces
npm run package      # produces the executable/ZIP in release/
npm run dist:server-gui  # builds the Monky Server installer into release-server/
npm run pack:cli     # builds the CLI tarball into release/
```

Repository layout:

```text
Monky/
├── packages/
│   └── shared/                 # Protocol, models, constants and validators
├── apps/
│   ├── server/                 # Node.js + WebSocket + SQLite server (Clean Architecture)
│   ├── client/                 # Electron app (main + preload + renderer)
│   └── server-gui/             # Host-side Electron app (Monky Server)
├── package.json                # NPM workspaces
└── tsconfig.base.json          # Base TypeScript configuration
```

Want to send a change? See [How to contribute](#-how-to-contribute).

---

## 📄 License

[MIT](LICENSE) — use it, modify it and host it freely.
