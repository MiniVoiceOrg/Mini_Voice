# Monky CLI

`monky` is the Monky server administration tool for VPS, Docker, or any
environment without a graphical client. It opens the same `server.db`
database used by the server and works in two modes:

- **Interactive mode** — run the command without arguments and the CLI asks
  the necessary questions step by step.
- **Direct mode** — pass all arguments on the command line for immediate
  execution (useful for scripts and automation).

> **Note:** for administrative commands (`members`, `roles`, `admin`,
> `config`), prefer using the CLI with the server stopped to avoid two
> instances writing to the same SQLite database simultaneously.

---

## Installation

### Prerequisites

- Node.js 18+
- npm

### Build the monorepo

```bash
git clone https://github.com/MonkyOrg/Monky.git
cd Monky
npm install
npm run build
```

### Install as a system command

```bash
npm install -g ./apps/server
```

After that, `monky` is available globally in the terminal — from any
directory, no `npx` needed.

### Alternative execution methods

If you don't want to install globally:

```bash
# Via npx (from monorepo root)
npx monky <command>

# Via node directly
node apps/server/dist/cli.js <command>

# Via npm workspace
npm run cli --workspace=apps/server -- <command>
```

---

## Global options

| Option           | Description                              | Default  |
|------------------|------------------------------------------|----------|
| `--data <path>`  | Path to the server data directory        | `./data` |
| `--help`, `-h`   | Show help                                | —        |

The `--data` option can be used with any command. When omitted, the CLI
defaults to `./data`. If the directory doesn't exist (for commands that
need an existing server), the CLI asks for the path interactively.

---

## Command reference

### `monky bootstrap`

Sets up a new server by defining the initial owner/administrator. This is
the first command to run on a new VPS.

#### Interactive mode

```bash
monky bootstrap
```

The CLI asks step by step:

1. **Server data directory** (default: `./data`)
2. **Owner's identity code** (`MONKY-ID:...`) — obtained in the Monky app
   under Settings → Export Identity
3. **Identity password** (hidden input)
4. **Owner's nickname** (default: `Owner`)
5. **Server name** (default: `Servidor dos Amigos`)
6. **Server port** (default: `3001`)
7. **Server password** (leave empty for no password)
8. **Confirmation** — shows a summary before applying
9. **Start the server now?** — optionally starts the server right after bootstrap

#### Direct mode

```bash
monky bootstrap --identity "MONKY-ID:..." --nickname "MyNick" --name "Server" --port 3001 --password "serverPassword"
```

| Flag           | Description                                     | Required |
|----------------|-------------------------------------------------|----------|
| `--identity`   | Exported identity code (`MONKY-ID:...`)         | Yes*     |
| `--nickname`   | Owner's nickname on the server                  | No       |
| `--name`       | Server name                                     | No       |
| `--port`       | Server port                                     | No       |
| `--password`   | Server password                                 | No       |

\* The identity password is always requested interactively (hidden input).

**Full example:**

```bash
monky --data /var/monky bootstrap --identity "MONKY-ID:1:eyJ..." --nickname Admin --name "Friends HQ" --port 4000
```

---

### `monky start`

Starts the Monky server as a daemon via **PM2** (process manager). The server
runs in the background with automatic restart on crash.

```bash
monky start
monky start --port 3001
monky start --data /var/monky --port 4000 --name "My Server"
```

| Flag               | Description                        | Default               |
|--------------------|------------------------------------|-----------------------|
| `--port`           | Server port                        | `3001`                |
| `--name`           | Server name                        | Stored value in DB    |
| `--password`       | Password (only if not in DB)       | —                     |
| `--max-users`      | Maximum users                      | Stored value or `100` |
| `--voice-channel`  | Initial voice channel name         | `Geral`               |
| `--text-channel`   | Initial text channel name          | `geral`               |

The command:

- Installs PM2 globally if not available.
- Creates the data directory if it doesn't exist.
- Generates an `ecosystem.config.js` file in the data directory.
- Starts the process via PM2 as a daemon (background).
- Auto-restart: if the server crashes, PM2 restarts it automatically.
- Memory limit: 512 MB (restarts if exceeded).

---

### `monky stop`

Stops the Monky server.

```bash
monky stop
```

Removes the process from PM2.

---

### `monky restart`

Restarts the Monky server with zero downtime.

```bash
monky restart
```

---

### `monky status`

Shows the current server state.

```bash
monky status
```

Displays: status (online/stopped/errored), PID, uptime, restart count,
memory and CPU.

---

### `monky logs`

Shows server logs in real time (tail).

```bash
monky logs
```

Press `Ctrl+C` to exit. Shows the last 50 lines and follows new entries.

---

### `monky members`

Manages server members.

#### List members

```bash
monky members
monky members list
```

Shows a table with ID, Nickname, Client ID, and Roles for each member.

#### Member information

```bash
# Interactive mode — asks for nickname/clientId
monky members info

# Direct mode — by nickname
monky members info lucas

# Direct mode — by clientId
monky members info abcd1234efgh5678
```

Shows detailed information: id, clientId, publicKey, avatar, creation and
last seen dates, owner status, and assigned roles.

---

### `monky admin`

Manages the administrator role.

#### Add admin

```bash
# Interactive mode — shows numbered member list to choose from
monky admin add

# Direct mode — by nickname
monky admin add lucas

# Direct mode — by clientId
monky admin add abcd1234efgh5678
```

In interactive mode, the CLI shows a navigable list:

```
Membros do servidor:
  Use ↑↓ para navegar, Enter para selecionar
❯ Alice (abc123...)
  Bob (def456...)
  Carlos (ghi789...)
```

#### Remove admin

```bash
monky admin remove lucas
monky admin remove abcd1234efgh5678
```

---

### `monky roles`

Manages server roles.

#### List roles

```bash
monky roles
monky roles list
```

Shows each role with: name, ID, color, position, permissions (numeric value),
whether it's the default role, and member count.

#### Create role

```bash
# Interactive mode — asks name, color, and permissions
monky roles create

# Direct mode
monky roles create "Moderator" "#00ff88" MANAGE_CHANNELS,MUTE_MEMBERS
```

In interactive mode, permissions are shown as a navigable multi-select list:

```
Permissões do cargo:
  Use ↑↓ para navegar, Espaço para marcar/desmarcar, Enter para confirmar
❯   Administrator (ADMINISTRATOR)
    Manage Server (MANAGE_SERVER)
    Manage Channels (MANAGE_CHANNELS)
    Mute Members (MUTE_MEMBERS)
    Deafen Members (DEAFEN_MEMBERS)
    Move Members (MOVE_MEMBERS)
    Kick Members (KICK_MEMBERS)
  ✔ Speak (SPEAK)
  ✔ Send Messages (SEND_MESSAGES)
  ✔ Read Messages (READ_MESSAGES)
    Attach Files (ATTACH_FILES)
```

Use `A` to select/deselect all.

#### Assign role to member

```bash
# Interactive mode — pick member and role from lists
monky roles assign

# Direct mode
monky roles assign lucas Moderator
```

In interactive mode, first select the member (navigable list with arrow keys),
then the role (navigable list with arrow keys).

#### Remove role from member

```bash
# Interactive mode — pick member and role to remove
monky roles unassign

# Direct mode
monky roles unassign lucas Moderator
```

Default roles cannot be removed.

#### Delete role

```bash
# Interactive mode — lists roles and asks for confirmation
monky roles delete

# Direct mode
monky roles delete Moderator
```

The CLI asks for confirmation before deleting.

---

### `monky config`

Manages server configuration.

#### Show configuration

```bash
monky config
monky config show
```

Shows: dataDir, id, name, hasPassword, maxUsers, ownerUserId, ownerNickname,
allowSoundboard, iconPath, maxAttachmentFileBytes, maxAttachmentStorageBytes,
and createdAt.

#### Change configuration

```bash
# Interactive mode — shows a menu with available keys
monky config set

# Direct mode
monky config set name "Friends Server"
monky config set maxUsers 50
monky config set password "newpassword"
monky config set password clear
monky config set allowSoundboard false
monky config set maxAttachmentFileBytes 10485760
monky config set maxAttachmentStorageBytes 1073741824
```

In interactive mode without arguments, the CLI shows a navigable menu:

```
Qual configuração deseja alterar?
  Use ↑↓ para navegar, Enter para selecionar
❯ name
  password
  maxUsers
  allowSoundboard
  maxAttachmentFileBytes
  maxAttachmentStorageBytes
```

Then asks for the new value with the current value as the suggestion.

#### Supported keys

| Key                          | Description                                          | Type     |
|------------------------------|------------------------------------------------------|----------|
| `name`                       | Server name (min. 2 characters)                      | text     |
| `password`                   | Server password                                      | text     |
| `maxUsers`                   | Maximum number of users                              | integer  |
| `allowSoundboard`            | Enable soundboard                                    | boolean  |
| `maxAttachmentFileBytes`     | Maximum size per attached file (bytes)               | integer  |
| `maxAttachmentStorageBytes`  | Maximum total attachment storage (bytes)             | integer  |

**Special values for `password`:** `clear`, `none`, `null`, `empty`, or
`remove` will remove the server password.

**Accepted boolean values:** `true`/`false`, `1`/`0`, `yes`/`no`,
`sim`/`nao`, `on`/`off`.

---

## Full VPS workflow

### 1. Prepare the server

```bash
git clone https://github.com/MonkyOrg/Monky.git
cd Monky
npm install
npm run build
npm install -g ./apps/server
```

### 2. Export identity in the Monky app

In the Monky client, go to **Settings → Export Identity** and copy the
`MONKY-ID:...` code.

### 3. Set up the server

```bash
monky bootstrap
```

Follow the prompts. At the end, the CLI offers to start the server automatically.

### 4. Start manually (when needed)

```bash
monky start
```

### 5. Stop the server

```bash
monky stop
```

### 6. Administer

```bash
monky members          # see registered users
monky admin add        # promote someone to admin
monky roles create     # create a new role
monky roles assign     # assign role to member
monky config set       # change settings
```

---

## Quick examples

```bash
# Full inline bootstrap
monky bootstrap --identity "MONKY-ID:1:..." --nickname Admin --port 3001

# Start server on port 4000 with data in a different directory
monky --data /var/monky start --port 4000

# List members from a server with custom data path
monky --data /var/monky members

# Create a Moderator role with green color and channel management permission
monky roles create "Moderator" "#00ff88" MANAGE_CHANNELS

# Change server name
monky config set name "Friends HQ"

# Remove server password
monky config set password clear
```
