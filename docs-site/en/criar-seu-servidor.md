# Create Your Server

Under **My Servers › Create Server**, fill in the host nickname, server name, local port, optional password and starting text and voice channels.

Click **Create and Start Server**. The server starts on your machine, listens on every network interface on the chosen port, and you join automatically.

Created servers are saved (up to 10). Later, use **Start**, **Stop** or **X** under *My Servers*.

## Invite friends

Inside the server, click the **server name** › **Invite Friends**. The app shows the name, public IP and port, and copies the invite.

| Situation | IP your friends should use |
|---|---|
| Same local network | Your local IP, or the app's automatic discovery |
| Different internet connection | Your public IP + forwarded router port |
| Without touching the router | VPN IP, such as Radmin VPN, Hamachi, ZeroTier or Tailscale |

## Open access over the internet

Allow the port through the firewall, forward port `3000` (or the one you chose) to the PC's local IP, and use a VPN if the ISP is behind CGNAT.

## Administer

Under **Server Settings** you can rename the server, change/remove the password and allow or block the soundboard. Channel headers have **+** to create and a bin icon to delete.

## Server Monitor

While the server is running on your machine, the app shows what is going on inside it. Open it from the **monitoring** icon next to the *Stop* button under *My Servers*, or from the **server name › Server Monitor** once you are connected.

The panel shows:

- **Live metrics**, refreshed every 3 seconds: uptime, people online (and the limit), registered members, channels and messages.
- **Live logs**, with a level filter (`INFO`, `WARN`, `ERROR`), text search, auto-scroll, a button to copy what is visible and a button to clear.

The app keeps the most recent entries in memory — restarting the server starts the list over. For servers running on a VPS, use [`monky logs`](/en/hospedar-em-vps).
