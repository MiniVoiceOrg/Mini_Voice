# Troubleshooting

| Symptom | What usually fixes it |
|---|---|
| macOS says the app "is damaged and can't be opened" | It's the Gatekeeper quarantine (app not notarized yet). Run in Terminal: `xattr -dr com.apple.quarantine /Applications/Monky.app`. See [Installation](/en/instalacao#security-warnings) |
| I can't connect to my friend's server | Double-check IP and port; ask them to confirm the server is started; check firewall and port forwarding; on CGNAT, use a VPN |
| Nickname already in use | Nicknames are unique per server — pick another |
| I joined, but nobody hears me | Check microphone under Settings › Devices, watch the VAD meter, lower sensitivity and confirm the mic is not muted |
| Everyone sounds choppy | Use the Economy profile, ask broadcasters to do the same and prefer cable over Wi-Fi |
| Shared screen has no sound | Share a whole screen and check the source app volume |
| Nothing under Servers on the Network | Discovery only works on the same LAN; click Scan again and check UDP `41234` in the firewall |
| One participant is silent only for me | Right-click them and set individual volume back to 100% |
