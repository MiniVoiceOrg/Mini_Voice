# Host on a VPS

To keep the server up 24/7, run the server alone on a Linux machine — no
graphical interface and no repository clone. Everything is done by the **Monky
CLI**, shipped ready to use in every release.

Requires **Node.js 22 or newer** (required by mediasoup; CI also uses 22).

## Step by step

```bash
# 1. Install the CLI from the release
#    The ready-to-paste command, already on the latest version, is on the
#    download page: https://monkyorg.github.io/Monky/en/download
npm install -g --allow-scripts=mediasoup https://github.com/MonkyOrg/Monky/releases/download/vX.Y.Z/monky-cli-X.Y.Z.tgz

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
| `40000-49151` | UDP | WebRTC media in SFU mode (mediasoup) | Only with SFU mode enabled |
| `3478` | TCP and UDP | TURN relay, if you enable it | Only with the relay on |
| `49152-65535` | UDP | Media forwarded by the relay | Only with the relay on |

When two members are behind CGNAT they may fail to connect directly. Monky ships
an **optional TURN relay** (off by default) that forwards that pair's media
through the server — see [Media relay (TURN)](/en/turn). Without
it, the way out for very restricted networks is still a VPN.

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
