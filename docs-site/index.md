---
layout: home
hero:
  name: Monky
  text: Voz, vídeo, tela e chat entre amigos
  tagline: No seu próprio servidor, sem cadastro e sem empresa nenhuma no meio.
  image:
    src: /logo.png
    alt: Monky
  actions:
    - theme: brand
      text: Começar
      link: /primeiros-passos
    - theme: alt
      text: Download
      link: /download
features:
  - icon: 🎙️
    title: Voz e Vídeo
    details: WebRTC direto entre os participantes, ou roteado pelo seu servidor no modo SFU.
  - icon: 🖥️
    title: Compartilhamento de Tela
    details: Compartilhe telas e janelas com áudio, múltiplas telas simultâneas.
  - icon: 🏠
    title: Auto-hospedado
    details: Rode no seu PC ou VPS — seus dados, suas regras.
  - icon: 🔒
    title: Privacidade Total
    details: Sem cadastro, sem rastreamento e sem nuvem de terceiros.
---

## Como funciona

1. Uma pessoa hospeda pelo app ou em um VPS.
2. Os amigos entram informando IP e porta.
3. Voz, vídeo e tela trafegam via WebRTC; o servidor cuida de login, canais, chat e sinalização.

Quem hospeda escolhe por onde a mídia passa: **P2P Mesh**, o padrão, em que ela vai direto de uma pessoa para a outra, ou **SFU**, em que cada um envia seu fluxo uma vez só para o servidor e ele distribui. O primeiro não custa banda a quem hospeda; o segundo aguenta grupos maiores e alivia o upload de quem transmite. Veja [Modos de Voz e Mídia](/criar-seu-servidor#modos-de-voz-e-midia-p2p-mesh-vs-sfu).

## Mapa da documentação

- [Download](/download)
- [Primeiros Passos](/primeiros-passos)
- [Criar Seu Servidor](/criar-seu-servidor)
- [Entrar Em Um Servidor](/entrar-em-um-servidor)
- [Usando o App](/usando-o-app)
- [Configurações](/configuracoes)
- [Hospedar em VPS](/hospedar-em-vps)
- [Monky CLI](/cli)
- [Solução de Problemas](/solucao-de-problemas)
- [Verificar Releases](/verificar-releases)
- [Recursos](/recursos)
