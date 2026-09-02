<div align="center">
  <img src="images/Logo.png" alt="Monky" width="220">
  <h1>Monky 🎙️</h1>
  <p><b>Voice, video, screen sharing and chat with your friends — on your own server, no sign-up and no middlemen.</b></p>

  <p>
    <a href="https://github.com/MonkyOrg/Monky/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/MonkyOrg/Monky?label=download&color=5865f2"></a>
    <a href="https://monkyorg.github.io/Monky/en/"><img alt="Documentation" src="https://img.shields.io/badge/docs-monkyorg.github.io-blue"></a>
    <a href="https://buymeacoffee.com/monkyorg"><img alt="Buy Me A Coffee" src="https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Support-yellow.svg"></a>
    <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-green"></a>
    <a href="https://github.com/MonkyOrg/Monky/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/MonkyOrg/Monky/actions/workflows/ci.yml/badge.svg"></a>
    <a href="https://github.com/MonkyOrg/Monky/discussions/categories/ideas"><img alt="Ideas" src="https://img.shields.io/badge/ideas-vote%20here-orange"></a>
  </p>

  <p><a href="README.md">Português</a> · <b>English</b></p>
</div>

---

## 🤔 What Monky is

Monky is a desktop app (Windows and macOS) for voice, video, screen sharing and chat with your friends — a stripped-down Discord, except **the server is yours**.

How it works in practice:

1. **One person hosts** from the app or on a VPS, with no account, email or cloud in between.
2. **Friends join** by entering the server IP and port.
3. **The conversation is direct or centralized:** by default, voice, video and screen sharing travel P2P via WebRTC (direct mesh); for larger groups or demanding 1080p 60fps streams, the host can enable **SFU mode** (Selective Forwarding Unit with `mediasoup`). When two members are behind CGNAT and cannot connect in P2P mode, a Linux host can enable an [optional TURN relay](https://monkyorg.github.io/Monky/en/cli#media-relay-turn).

Everything of yours stays with you: history and users in the host's SQLite (`server.db`); nickname, avatar and preferences on your PC.

## ⬇️ Install

Download the latest version from [github.com/MonkyOrg/Monky/releases/latest](https://github.com/MonkyOrg/Monky/releases/latest).

| System | File | Note |
|---|---|---|
| Windows 10/11 (x64) | `Monky-<version>-win-x64-setup.exe` | Installer — lets you pick the folder |
| Windows 10/11 (x64) | `Monky-<version>-win-x64-portable.exe` | Installs nothing, just run it |
| macOS (Intel / Apple Silicon) | `Monky-<version>-mac-<arch>.dmg` | Pick `x64` (Intel) or `arm64` (M1/M2/M3+) |

If Windows/macOS shows a security warning, see [Installation](https://monkyorg.github.io/Monky/en/instalacao). For checksums and signatures, see [Verify Releases](https://monkyorg.github.io/Monky/en/verificar-releases).

## 📚 Documentation

Full usage and hosting manual at **[monkyorg.github.io/Monky/en](https://monkyorg.github.io/Monky/en/)** — installation, getting started, creating a server, hosting on a VPS and troubleshooting. ([Português](https://monkyorg.github.io/Monky/))

## 🧩 The 2 products

- **Monky** — client app for talking to friends. It also hosts the server, with a **Server Monitor** for live metrics and logs.
- **[Monky CLI](https://monkyorg.github.io/Monky/en/cli)** — command-line administration, ideal for VPS. Install it from the release, run `monky create` and you are done; a single machine can host as many servers as you want.

## 🏗️ How it works inside

Monky separates **what the server controls** from **what travels between people**:

```mermaid
flowchart TB
    subgraph MP["Media plane — P2P, never touches the server"]
        direction LR
        A2["Ana"] <-->|"voice · video · screen"| B2["Bruno"]
        B2 <-->|"voice · video · screen"| C2["Carla"]
        A2 <-->|"voice · video · screen"| C2
    end

    S[("Monky server<br/>WebSocket + SQLite")]
    A["Ana"] <-->|"login, channels, chat, signaling"| S
    B["Bruno"] <--> S
    C["Carla"] <--> S

    S -.->|"introduces the peers<br/>to each other"| MP
```

The server handles login, channels, chat, roles and signaling — then steps aside.
Voice, video and screen go **straight from one person to another** over WebRTC, in
a mesh. Two consequences: the server's bandwidth barely matters (a cheap VPS is
enough) and **not even the host can listen in on the conversation**.

The full detail — protocol, public-key authentication, database, permissions,
media plane, quality profiles and known limits — lives in
**[Architecture](https://monkyorg.github.io/Monky/en/arquitetura)**.

## 🗳️ Roadmap & Voting

The community decides the next versions: [suggest ideas](https://github.com/MonkyOrg/Monky/discussions/new?category=ideas), [vote on open ideas](https://github.com/MonkyOrg/Monky/discussions/categories/ideas) or follow [issues](https://github.com/MonkyOrg/Monky/issues).

## 🤝 How to contribute

Bugs start in [Discussions › Bug Reports](https://github.com/MonkyOrg/Monky/discussions/new?category=bug-reports). Code and documentation changes are welcome through PRs; read [CONTRIBUTING.en.md](CONTRIBUTING.en.md).

## 💻 For developers

Requirements: Node.js 22+ (the version CI uses) and npm. On Windows, the native screen-audio module needs Python 3.11 and Visual Studio Build Tools (MSVC).

```bash
npm install
npm run build
npm start
npm test
```

Architecture details live in [Architecture](https://monkyorg.github.io/Monky/en/arquitetura), the contribution flow in [CONTRIBUTING.en.md](CONTRIBUTING.en.md) and the server commands in the [Monky CLI manual](https://monkyorg.github.io/Monky/en/cli). The project's original specification — with MVP and roadmap — is kept in [docs/especificacao-tecnica.md](docs/especificacao-tecnica.md).

## ☕ Support the Project

If you love Monky and want to support ongoing development, buy us a coffee! Every contribution helps keep the project active and thriving:

👉 **[buymeacoffee.com/monkyorg](https://buymeacoffee.com/monkyorg)**

## 📄 License

[MIT](LICENSE) — use it, modify it and host it freely.
