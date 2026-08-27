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

## 🤔 What Monky is

Monky is a desktop app (Windows and macOS) for voice, video, screen sharing and chat with your friends — a stripped-down Discord, except **the server is yours**.

How it works in practice:

1. **One person hosts** from the app or on a VPS, with no account, email or cloud in between.
2. **Friends join** by entering the server IP and port.
3. **The conversation is direct:** voice, video and screen sharing travel P2P via WebRTC; the server handles login, channels, chat and signalling.

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

- [Monky Docs](https://monkyorg.github.io/Monky/en/) — manual for using and hosting.
- [Getting Started](https://monkyorg.github.io/Monky/en/primeiros-passos)
- [Create Your Server](https://monkyorg.github.io/Monky/en/criar-seu-servidor)
- [Join a Server](https://monkyorg.github.io/Monky/en/entrar-em-um-servidor)
- [Using the App](https://monkyorg.github.io/Monky/en/usando-o-app)
- [Host on a VPS](https://monkyorg.github.io/Monky/en/hospedar-em-vps)

## 🧩 The 3 products

- **Monky** — client app for talking to friends.
- **[Monky Server](https://monkyorg.github.io/Monky/en/monky-server)** — graphical panel for hosts.
- **[Monky CLI](docs/CLI.en.md)** — command-line administration, ideal for VPS.

## 🗳️ Roadmap & voting

The community decides the next versions: [suggest ideas](https://github.com/MonkyOrg/Monky/discussions/new?category=ideas), [vote on open ideas](https://github.com/MonkyOrg/Monky/discussions/categories/ideas) or follow [issues](https://github.com/MonkyOrg/Monky/issues).

## 🤝 How to contribute

Bugs start in [Discussions › Bug Reports](https://github.com/MonkyOrg/Monky/discussions/new?category=bug-reports). Code and documentation changes are welcome through PRs; read [CONTRIBUTING.en.md](CONTRIBUTING.en.md).

## 💻 For developers

Requirements: Node.js 20+ (CI uses 22) and npm. On Windows, the native screen-audio module needs Python 3.11 and Visual Studio Build Tools (MSVC).

```bash
npm install
npm run build
npm start
npm test
```

Architecture and full commands live in [CONTRIBUTING.en.md](CONTRIBUTING.en.md), [docs/CLI.en.md](docs/CLI.en.md) and [docs/especificacao-tecnica.md](docs/especificacao-tecnica.md).

## 📄 License

[MIT](LICENSE) — use it, modify it and host it freely.
