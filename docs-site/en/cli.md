# Monky CLI

Command line tool to create and administer Monky servers.

```
monky <command> [subcommand] [options]
```

The CLI is installed globally and does not depend on the directory you are in:
it keeps a registry of this machine's servers in `~/.monky/servers.json` and
uses it to know which server each command applies to.

## Installation

Requires **Node.js 20 or newer**.

```bash
curl -fsSL https://monkyorg.github.io/install.sh | bash
```

To install a beta version:

```bash
curl -fsSL https://monkyorg.github.io/install.sh | bash -s -- --beta
```

<details>
<summary>Manual installation (without the script)</summary>

Download the `.tgz` for the desired version from
[Releases](https://github.com/MonkyOrg/Monky/releases) and install with:

```bash
npm install -g https://github.com/MonkyOrg/Monky/releases/download/vX.Y.Z/monky-cli-X.Y.Z.tgz
```

</details>

To run the server as a daemon (`monky start`) the CLI uses
[PM2](https://pm2.keymetrics.io/). If it is missing, `monky start` installs it
automatically. Every other command only warns about it:

```bash
npm install -g pm2
```

## Quick start

```bash
monky create     # creates the server and offers to start it
monky status     # check that it is up
monky logs       # follow the logs
```

## Multiple servers

A single machine can host as many servers as you want — each with its own data
directory, port and PM2 process.

When there is **one** server, commands act on it directly. When there is **more
than one**, the CLI asks which one you mean:

```
Há 2 servidores Monky nesta máquina.
Qual servidor deseja reiniciar?
❯ Friends — porta 3000 — /srv/monky-friends
  Work — porta 3100 — /srv/monky-work
```

Scripts and cron jobs have no interactive terminal, so pass `--data` explicitly:

```bash
monky --data /srv/monky-friends restart
```

## Global options

| Option | Description |
|---|---|
| `--data <folder>` | Data directory of the target server. Required when there are several servers and the terminal is not interactive. |
| `--help`, `-h` | Show the help. |

## Data directory layout

| Path | Contents |
|---|---|
| `server.db` | SQLite database: members, roles, channels and messages. |
| `monky.json` | Server port. |
| `ecosystem.config.cjs` | PM2 configuration, rewritten on every `start`/`restart`. |
| `attachments/`, `avatars/`, `icons/` | Uploaded files. |
| `auto-update.cjs` | Only created when auto-update is enabled. |

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success. |
| `1` | Failure. The message is printed to `stderr`. |

---

# Command reference

## `monky create`

Creates a new server: prepares the database, sets the owner and saves the port.
It replaces the former `monky bootstrap`, which still works as an alias.

```bash
monky create [options]
```

The command is interactive and asks, in order:

1. **Where to store the data** — suggests `./data`, but any path works. If the
   chosen folder already holds a server, it asks for another one.
2. **Owner identity code** (`MONKY-ID:...`) — export it from the Monky app under
   *Settings → Identity → Export*.
3. **Identity password** — the one you set when exporting.
4. **Owner nickname**
5. **Server name**
6. **Server port** (default: `3000`)
7. **Server password** — leave empty for an open server.

It then prints a summary, asks for confirmation and offers to start the server.

### Options

| Option | Description | Default |
|---|---|---|
| `--identity <code>` | Owner identity code | asked |
| `--name <name>` | Server name | `Servidor dos Amigos` |
| `--port <n>` | Server port | `3000` |
| `--password <password>` | Server password (empty = no password) | asked |

The identity password is never accepted as an option: it is always typed
hidden in the terminal.

### Examples

```bash
# Fully interactive
monky create

# Folder given as an option, everything else asked
monky create --data /srv/monky-friends

# Non-interactive, except for the identity password
monky create --data /srv/monky-friends \
  --identity "MONKY-ID:..." \
  --name "Friends Server" --port 3000 --password "serverPassword"
```

---

## `monky list`

Lists this machine's servers and the state of each one. Also accepted as
`monky ls`.

```bash
monky list
```

```
NOME       STATUS   PORTA  PASTA DE DADOS
Friends    online   3000   /srv/monky-friends
Work       stopped  3100   /srv/monky-work
```

---

## `monky start`

Starts an **existing** server as a PM2 daemon.

```bash
monky start [--port <n>]
```

If the machine has no server, the command fails and points at `monky create` —
it never creates a server on its own.

The `ecosystem.config.cjs` file is rewritten before starting, so the current
port and name take effect from then on.

### Options

| Option | Description | Default |
|---|---|---|
| `--port <n>` | Port for this run only | value in `monky.json`, or `3000` |

To change the port permanently use `monky config set port`.

::: warning Removed options
`--password`, `--max-users`, `--name`, `--voice-channel` and `--text-channel`
are no longer accepted here. They only had an effect while creating the
database and were silently ignored for existing servers. The command now fails
pointing at the alternative: `monky create` or `monky config set`.
:::

---

## `monky stop`

Stops the server, keeping it registered in PM2.

```bash
monky stop
```

The process stays listed in PM2 on purpose: removing it would discard the logs
exactly when they matter most, right after a crash or a manual stop. `monky
logs` keeps working with the server stopped.

If anyone is connected at that moment, the CLI reports how many people will be
disconnected and asks for confirmation before stopping. On a non-interactive
terminal (scripts, cron) the warning is printed and the stop goes ahead.

---

## `monky restart`

Restarts the server applying the current configuration.

```bash
monky restart [--port <n>]
```

`ecosystem.config.cjs` is rewritten before the restart, so a port or name
changed since the last `start` takes effect.

Just like `stop`, if anyone is connected the CLI warns and asks for confirmation
before restarting.

---

## `monky status`

Shows the state of the server.

```bash
monky status [--data <folder>]
```

With a single server (or with `--data`), it shows the details:

```
Estado do servidor: Friends
status: online
dataDir: /srv/monky-friends
porta: 3000
processo PM2: monky-server-a1b2c3d4
pid: 21877
uptime: 2026-08-27T18:02:11.000Z
restarts: 0
memória: 88 MB
cpu: 0%
```

With several servers and no `--data`, it prints the same table as `monky list` —
a read-only query has no side effects, so asking would be busywork.

---

## `monky logs`

Shows the logs of the server started with `monky start`.

```bash
monky logs [--lines <n>] [--level <level>] [--no-follow]
```

### Options

| Option | Description | Default |
|---|---|---|
| `--lines <n>` | How many previous lines to show | `100` |
| `--level <level>` | Minimum level: `INFO`, `WARN` or `ERROR` | no filter |
| `--no-follow` | Print and exit instead of following live | follows |

`--level` filters by minimum level: `INFO` shows everything, `WARN` shows
warnings and errors, `ERROR` shows errors only. Continuation lines (stack
traces, for instance) inherit the level of the line above them.

### Examples

```bash
monky logs                              # follows live (Ctrl+C to exit)
monky logs --lines 500                  # starts with the last 500 lines
monky logs --level WARN                 # warnings and errors only
monky logs --level ERROR --no-follow    # prints recent errors and exits
```

::: tip
`monky logs` reads PM2's logs. If the server is running inside the Monky app,
use the **Server Monitor** in the app itself (server menu → Server Monitor).
:::

---

## `monky members`

Lists the server members and their roles.

```bash
monky members
monky members info <nickname|clientId>
```

`members info` shows the id, clientId, public key, creation and last-seen dates,
whether they own the server and their roles.

---

## `monky admin`

Grants or revokes the Admin role.

```bash
monky admin add [nickname|clientId]
monky admin remove [nickname|clientId]
```

Without an argument, the command lists the members for you to pick from.

---

## `monky roles`

Administers the server roles.

```bash
monky roles                       # list
monky roles create [name] [color] [permissions]
monky roles assign [member] [role]
monky roles unassign [member] [role]
monky roles delete [role]
```

Without arguments, each subcommand is interactive. Permissions can be passed by
name, comma separated. Colors use the `#RRGGBB` format. The server's default
role cannot be removed from a member.

---

## `monky config`

Shows or changes the server configuration.

```bash
monky config                       # show everything
monky config set                   # pick the key interactively
monky config set <key> [value]     # change it directly
```

### Keys

| Key | Description | Default |
|---|---|---|
| `name` | Server name (at least 2 characters) | `Servidor dos Amigos` |
| `password` | Join password. Empty, `none` or `clear` removes it | no password |
| `port` | TCP port | `3000` |
| `icon` | Path to an image, copied into the data directory. Empty or `clear` removes it | no icon |
| `maxUsers` | Maximum simultaneous users | `20` |
| `allowSoundboard` | Allows the soundboard (`true`/`false`) | `true` |
| `maxAttachmentFileBytes` | Maximum size per attachment, in bytes | no limit |
| `maxAttachmentStorageBytes` | Total attachment storage, in bytes | no limit |
| `autoUpdate` | Enables the daily automatic update (`true`/`false`) | `false` |

Changing `port` with the server running offers to restart right away.

### Examples

```bash
monky config
monky config set name "Friends Server"
monky config set password           # typed hidden
monky config set password clear     # removes the password
monky config set maxUsers 50
monky config set autoUpdate true
```

---

## `monky update`

Updates Monky to the latest published version.

```bash
monky update [--beta] [--check] [--yes]
```

### Options

| Option | Description |
|---|---|
| `--beta`, `-b` | Also considers prereleases |
| `--check` | Only checks and exits, without updating |
| `--yes`, `-y` | Asks nothing — for scripts and the auto-updater |

The command downloads and installs the new package with `npm install -g` from
the GitHub release artifacts.

At the end the server is restarted (with confirmation, except with `--yes`).

### Examples

```bash
monky update --check           # is there a stable update?
monky update --check --beta    # and considering betas?
monky update                   # updates to the latest stable
monky update --beta            # updates to the latest, betas included
```

### Automatic updates

```bash
monky config set autoUpdate true
```

Registers a daily PM2 task, at 4am, running `monky update --yes` for that
server. The channel follows the installed version: if you are on a beta, the
auto-updater follows the beta channel.

It works on Linux, macOS and Windows. To turn it off:

```bash
monky config set autoUpdate false
```

---

## `monky destroy`

**Permanently** deletes all data of a server.

```bash
monky destroy [--data <folder>]
```

Removes the database, attachments, avatars and configuration, kills the PM2
process and drops the server from the registry. It asks for two confirmations:
typing `DESTROY` and a final "yes". It only accepts folders that actually hold a
Monky server.

If anyone is connected, the warning shows up before the confirmations, saying
how many people will be disconnected.

---

## See also

- [Host on a VPS](/en/hospedar-em-vps) — keeping the server up 24/7
- [Verify Releases](/en/verificar-releases) — checking that downloads are authentic
