# Settings

Open from the gear icon on the connection screen or bottom bar.

- **Profile** — nickname and picture.
- **Servers and settings** — export your saved servers and app settings to a
  `.monkybackup` file and restore them on another computer. You pick what goes in
  and what comes out each time, and the data can also ride along with the
  identity backup. The file is protected by the password you set when exporting:
  the saved server list may contain server passwords, so it never reaches the
  disk in the clear. Without that password the backup cannot be recovered.
- **Devices** — microphone, speaker/headphones and camera, with preview and list refresh.
- **Voice sensitivity (VAD)** — adjust while watching the meter; leave the marker above the silent level.
- **Noise suppression (RNNoise)** — reduces keyboard, clicks and room noise.
- **Quality and performance profile** — affects only what you transmit.
- **Behaviour** — keep Monky in the system tray when the window is closed, and
  ask before shutting down a server hosted on this machine when you are the last
  person to leave it.
- **Updates** — current version and manual check.
- **Community** — shortcuts for ideas, voting and bugs.

| Profile | Audio | Camera | Screen | When to use |
|---|---|---|---|---|
| Economy | 24 kbps | 360p | 480p | Slow or unstable internet |
| Normal | 32 kbps | 480p | 720p | General use |
| High Quality | 48 kbps | 720p | 1080p | Fast internet and a PC to spare |
| Gaming | 28 kbps | reduced | smooth (60 FPS) | Gaming: prioritises voice and fluid screen |

The **Custom** profile offers dropdowns with the most common values — aspect
ratio (16:9, 16:10, 4:3 and 21:9), resolution (from the lowest up to 4K), FPS
and bitrate. Every dropdown keeps a **Custom...** entry that reveals the plain
number box for anything outside the list. Changing the aspect ratio keeps the
resolution closest to the one you were already using.
