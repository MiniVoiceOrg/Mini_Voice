---
layout: home
hero:
  name: Monky
  text: Voice, video, screen sharing and chat
  tagline: On your own server, with no sign-up and no company in the middle.
  image:
    src: /logo.png
    alt: Monky
  actions:
    - theme: brand
      text: Get Started
      link: /en/primeiros-passos
    - theme: alt
      text: Download
      link: /en/download
features:
  - icon: 🎙️
    title: Voice & Video
    details: WebRTC straight between participants, or routed through your own server in SFU mode.
  - icon: 🖥️
    title: Screen Sharing
    details: Share screens and windows with audio, multiple screens at once.
  - icon: 🏠
    title: Self-Hosted
    details: Run on your PC or VPS — your data, your rules.
  - icon: 🔒
    title: Full Privacy
    details: No sign-up, no tracking and nobody else's cloud.
---

## How it works

1. One person hosts from the app or on a VPS.
2. Friends join by entering the server IP and port.
3. Voice, video and screen sharing travel over WebRTC; the server handles login, channels, chat and signalling.

Whoever hosts decides where the media goes: **P2P Mesh**, the default, where it travels straight from one person to another, or **SFU**, where everyone sends their stream to the server once and it fans them out. The first costs the host no bandwidth; the second handles larger groups and spares the upload of whoever is streaming. See [Voice & Media Modes](/en/criar-seu-servidor#voice-media-modes-p2p-mesh-vs-sfu).

## Documentation map

- [Download](/en/download)
- [Getting Started](/en/primeiros-passos)
- [Create Your Server](/en/criar-seu-servidor)
- [Join a Server](/en/entrar-em-um-servidor)
- [Using the App](/en/usando-o-app)
- [Settings](/en/configuracoes)
- [Host on a VPS](/en/hospedar-em-vps)
- [Monky CLI](/en/cli)
- [Troubleshooting](/en/solucao-de-problemas)
- [Verify Releases](/en/verificar-releases)
- [Features](/en/recursos)
