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

## Reading the logs

```bash
monky logs                      # follows the logs live (Ctrl+C to quit)
monky logs --lines 500          # starts with the last 500 lines
monky logs --level WARN         # warnings and errors only
monky logs --level ERROR --no-follow   # prints recent errors and exits
```

`--level` filters by minimum level: `INFO` shows everything, `WARN` shows
warnings and errors, `ERROR` shows errors only. Continuation lines (stack
traces, for instance) follow the level of the line above them.

::: tip
`monky logs` reads the logs of the server started with `monky start`, which runs
through PM2. If the server is running inside the Monky app, use the **Server
Monitor** in the app itself (server menu → Server Monitor).
:::

## Administration

```bash
monky members
monky admin add
monky roles create
monky config set
monky --help
```

Full documentation: [Monky CLI](/en/cli).

## Ports used

| Port | Protocol | What for | Needs opening? |
|---|---|---|---|
| `3000` (or chosen) | TCP | Login, chat, channels and signalling | Yes, on the host |
| `41234` | UDP | Local network discovery | Only to find LAN servers |
| High dynamic | UDP | P2P voice, video and screen | Usually works via STUN |

There is no TURN server; on very restricted networks, use a VPN.
