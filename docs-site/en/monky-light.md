# Monky Light

::: warning In development
Monky Light has **no download yet**. This page describes what it will be and who it is for.
Follow along in [#119](https://github.com/MonkyOrg/Monky/issues/119).
:::

**Monky Light** is a separate client, written in native C++, that does **only two things: voice channels and text channels.**

It exists for two kinds of user:

- People on a **weak machine** who cannot run the full app comfortably.
- People on a **strong machine who do not want to share it** — the PC is for the game or for work, and the voice app should sit in the quietest corner possible.

## Maximum performance: Monky Light + Monky CLI

If your goal is performance and speed above everything else, this is the combination:

| Role | Use |
|---|---|
| **Hosting** | [Monky CLI](/en/cli) — headless server, ideally on a [VPS](/en/hospedar-em-vps) |
| **Talking** | **Monky Light** — native client, voice and text only |

The CLI removes the graphical interface on the server side; Light removes the embedded browser on the client side. What is left is the minimum: one network process and one audio process, on both ends.

## What's in

- Connect to a Monky server by IP and port, or through an invite link.
- Join and leave voice channels, speak and listen.
- Mute the microphone, deafen, adjust per-participant volume.
- Speech detection (VAD) and push-to-talk.
- Text channels: read history and send messages.
- Participant list with a speaking indicator.
- System tray and global shortcuts.

## What's out

Video, screen sharing, soundboard, attachments, avatars, channel and role administration, and **hosting a server**.

None of that disappears from Monky — it is missing **from Light**. Both clients speak the same protocol and share the same voice channel: you can be on Light while your friends are on the full app sharing their screens with each other.

For anything outside that list, use the full [Monky](/en/instalacao).

## Why not just an "economy mode" in the full app

The full app is Electron: it loads an entire Chromium to draw its interface. Even sitting idle in a voice channel, that costs several processes and hundreds of MB of RAM. No setting turns that cost off — it is the foundation.

Light has no browser at all. The interface is drawn with the system's native controls, audio is processed in C++, and the program goes **fully idle** when nobody is talking: no GPU usage, no screen redraws, no threads waking up for nothing.

## FAQ

**Do I need a different server?**
No. Same Monky server, same password, same identity, same channels.

**Can I host from Light?**
No. Hosts use the full app or the [Monky CLI](/en/cli).

**Does Light replace Monky?**
No. They are two clients for two uses. Monky remains the main app.
