[🏠 Home](Home) · [Português](../Hospedar-em-VPS)

# Host on a VPS

To keep the server up 24/7, run only the server on a Linux machine. Requires **Node.js 20 or newer** (CI uses 22).

Install the **Monky CLI** from a release:

```bash
npm install -g https://github.com/MonkyOrg/Monky/releases/download/v2.3.0/monky-cli-2.3.0.tgz
```

Replace `v2.3.0` with the version you want.

## Initial setup

The CLI is interactive:

```bash
monky bootstrap
```

It asks for identity code, password, nickname, server name, port and server password. At the end, it offers to start automatically.

## Start and stop

```bash
monky start
monky stop
monky restart
monky status
monky logs
```

## Administration

```bash
monky members
monky admin add
monky roles create
monky config set
monky --help
```

Full documentation: [docs/CLI.en.md](https://github.com/MonkyOrg/Monky/blob/main/docs/CLI.en.md).

## Ports used

| Port | Protocol | What for | Needs opening? |
|---|---|---|---|
| `3000` (or chosen) | TCP | Login, chat, channels and signalling | Yes, on the host |
| `41234` | UDP | Local network discovery | Only to find LAN servers |
| High dynamic | UDP | P2P voice, video and screen | Usually works via STUN |

There is no TURN server; on very restricted networks, use a VPN.

---
<sub>📝 This page is generated from [`wiki/`](https://github.com/MonkyOrg/Monky/tree/main/wiki) in the repository. Edits made directly in the Wiki will be overwritten — please open a Pull Request.</sub>
