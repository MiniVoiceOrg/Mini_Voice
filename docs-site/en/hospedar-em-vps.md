# Host on a VPS

To keep the server up 24/7, run the server alone on a Linux machine — no
graphical interface and no repository clone. Everything is done by the **Monky
CLI**, shipped ready to use in every release.

Requires **Node.js 20 or newer** (CI uses 22).

## Step by step

```bash
# 1. Install the CLI from the release
#    The ready-to-paste command, already on the latest version, is on the
#    download page: https://monkyorg.github.io/Monky/en/download
npm install -g https://github.com/MonkyOrg/Monky/releases/download/<version>/monky-cli-<version>.tgz

# 2. Create the server (interactive)
monky create

# 3. Check that it is up
monky status
```

`monky create` asks where to store the data, asks for the owner identity code
and offers to start the server at the end. On a VPS, prefer a path outside your
home directory, such as `/srv/monky`.

The server runs as a PM2 daemon and comes back on its own after a reboot. The
full command reference lives in [Monky CLI](/en/cli).

## Ports used

| Port | Protocol | What for | Needs opening? |
|---|---|---|---|
| `3000` (or the chosen one) | TCP | Login, chat, channels and signalling | Yes, in the VPS firewall |
| `41234` | UDP | Local network discovery | No, on a VPS |
| High dynamic | UDP | P2P voice, video and screen | Usually works through STUN |

There is no TURN server; on very restricted networks, use a VPN.

## Maintenance

```bash
monky logs --level WARN           # what needs attention
monky config set port 3010        # changes the port and offers to restart
monky update --check              # is there a new version?
monky config set autoUpdate true  # updates itself daily at 4am
```

::: tip More than one server on the same VPS
Just run `monky create` again with another folder and another port. The CLI
starts asking which server each command refers to — or you point at it directly
with `--data`. See [Multiple servers](/en/cli#multiple-servers).
:::
