# Features

- Low-latency voice over WebRTC, straight between participants (P2P Mesh), with no audio routed through the server.
- Optional SFU mode (`mediasoup`): everyone sends their stream once and the server fans it out, for larger groups and for anyone sharing a high-resolution screen. The app and the CLI ship a capacity estimator to size the host before turning it on.
- Speech detection (VAD) with adjustable sensitivity and live meter.
- AI noise suppression (RNNoise).
- Camera with adaptive resolution and bitrate.
- Screen or window sharing, with audio.
- Chat with persistent history, avatars and anti-flood protection.
- Private channels with per-role visibility: members without access never receive the channel from the server, not even its name.
- Soundboard from a PC folder, with host-side control.
- Automatic server discovery on the local network.
- Several servers connected at once: switching servers drops neither your voice call nor your messages.
- Quality profiles: Economy, Normal, High Quality and Gaming.
- Self-hosted server with SQLite, `scrypt` password hashing and strict avatar upload validation.
- Server Monitor in the app: live metrics (uptime, online users, members, channels, messages) and logs with a level filter.
- Command-line administration through the [Monky CLI](/en/cli), for VPS and headless servers.
