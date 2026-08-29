<div align="center">
  <img src="images/Logo.png" alt="Monky" width="220">
  <h1>Monky 🎙️</h1>
  <p><b>Voz, vídeo, tela e chat entre amigos — no seu próprio servidor, sem cadastro e sem intermediários.</b></p>

  <p>
    <a href="https://github.com/MonkyOrg/Monky/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/MonkyOrg/Monky?label=download&color=5865f2"></a>
    <a href="https://monkyorg.github.io/Monky/"><img alt="Documentação" src="https://img.shields.io/badge/docs-monkyorg.github.io-blue"></a>
    <a href="https://buymeacoffee.com/monkyorg"><img alt="Buy Me A Coffee" src="https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Apoiar-yellow.svg"></a>
    <a href="LICENSE"><img alt="Licença MIT" src="https://img.shields.io/badge/licen%C3%A7a-MIT-green"></a>
    <a href="https://github.com/MonkyOrg/Monky/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/MonkyOrg/Monky/actions/workflows/ci.yml/badge.svg"></a>
    <a href="https://github.com/MonkyOrg/Monky/discussions/categories/ideas"><img alt="Ideias" src="https://img.shields.io/badge/ideias-vote%20aqui-orange"></a>
  </p>

  <p><b>Português</b> · <a href="README.en.md">English</a></p>
</div>

---

## 🤔 O que é o Monky

Monky é um aplicativo desktop (Windows e macOS) para voz, vídeo, compartilhamento de tela e chat entre amigos — no estilo de um Discord enxuto, só que **o servidor é seu**.

Como funciona na prática:

1. **Uma pessoa hospeda** pelo app ou em um VPS, sem conta, e-mail ou nuvem no meio.
2. **Os amigos entram** informando IP e porta.
3. **A conversa é direta:** voz, vídeo e tela trafegam P2P via WebRTC; o servidor cuida de login, canais, chat e sinalização.

Tudo o que é seu fica com você: histórico e usuários no SQLite (`server.db`) do anfitrião; nickname, avatar e preferências no seu PC.

## ⬇️ Instalar

Baixe a versão mais recente em [github.com/MonkyOrg/Monky/releases/latest](https://github.com/MonkyOrg/Monky/releases/latest).

| Sistema | Arquivo | Observação |
|---|---|---|
| Windows 10/11 (x64) | `Monky-<versão>-win-x64-setup.exe` | Instalador — permite escolher a pasta |
| Windows 10/11 (x64) | `Monky-<versão>-win-x64-portable.exe` | Não instala nada, é só executar |
| macOS (Intel / Apple Silicon) | `Monky-<versão>-mac-<arch>.dmg` | Escolha `x64` (Intel) ou `arm64` (M1/M2/M3+) |

Se o Windows/macOS mostrar aviso de segurança, veja [Instalação](https://monkyorg.github.io/Monky/instalacao). Para checksums e assinatura, veja [Verificar Releases](https://monkyorg.github.io/Monky/verificar-releases).

## 📚 Documentação

Manual completo de uso e hospedagem em **[monkyorg.github.io/Monky](https://monkyorg.github.io/Monky/)** — instalação, primeiros passos, criar servidor, hospedar em VPS e solução de problemas. ([English](https://monkyorg.github.io/Monky/en/))

## 🧩 Os 2 produtos

- **Monky** — app cliente para conversar com amigos. Ele também hospeda o servidor, com **Monitor do Servidor** para métricas e logs ao vivo.
- **[Monky CLI](https://monkyorg.github.io/Monky/cli)** — administração por linha de comando, ideal para VPS. Instale pela release, rode `monky create` e pronto; a mesma máquina pode hospedar quantos servidores quiser.

## 🏗️ Como funciona por dentro

O Monky separa **o que o servidor controla** do **que trafega entre as pessoas**:

```mermaid
flowchart TB
    subgraph MP["Plano de mídia — P2P, não passa pelo servidor"]
        direction LR
        A2["Ana"] <-->|"voz · vídeo · tela"| B2["Bruno"]
        B2 <-->|"voz · vídeo · tela"| C2["Carla"]
        A2 <-->|"voz · vídeo · tela"| C2
    end

    S[("Servidor Monky<br/>WebSocket + SQLite")]
    A["Ana"] <-->|"login, canais, chat, sinalização"| S
    B["Bruno"] <--> S
    C["Carla"] <--> S

    S -.->|"apresenta os pares<br/>uns aos outros"| MP
```

O servidor cuida de login, canais, chat, cargos e sinalização — e sai da frente.
Voz, vídeo e tela vão **direto de uma pessoa para a outra** via WebRTC, em mesh.
Duas consequências: a banda do servidor quase não importa (um VPS baratinho dá
conta) e **nem quem hospeda consegue ouvir a conversa**.

O detalhe completo — protocolo, autenticação por chave pública, banco, permissões,
plano de mídia, perfis de qualidade e limites conhecidos — está em
**[Arquitetura](https://monkyorg.github.io/Monky/arquitetura)**.

## 🗳️ Roadmap & Votação

A comunidade decide as próximas versões: [sugira ideias](https://github.com/MonkyOrg/Monky/discussions/new?category=ideas), [vote nas ideias abertas](https://github.com/MonkyOrg/Monky/discussions/categories/ideas) ou acompanhe as [issues](https://github.com/MonkyOrg/Monky/issues).

## 🤝 Como colaborar

Bugs começam em [Discussions › Bug Reports](https://github.com/MonkyOrg/Monky/discussions/new?category=bug-reports). Mudanças de código e documentação são bem-vindas por PR; leia [CONTRIBUTING.md](CONTRIBUTING.md).

## 💻 Para desenvolvedores

Requisitos: Node.js 22+ (versão usada pelo CI) e npm. No Windows, o módulo nativo de áudio de tela precisa de Python 3.11 e Build Tools do Visual Studio (MSVC).

```bash
npm install
npm run build
npm start
npm test
```

Detalhes de arquitetura estão em [Arquitetura](https://monkyorg.github.io/Monky/arquitetura), o fluxo de contribuição em [CONTRIBUTING.md](CONTRIBUTING.md) e os comandos do servidor no [manual do Monky CLI](https://monkyorg.github.io/Monky/cli). A especificação original do projeto — com MVP e roadmap — ficou registrada em [docs/especificacao-tecnica.md](docs/especificacao-tecnica.md).

## ☕ Apoie o Projeto

Se você gosta do Monky e quer apoiar o desenvolvimento contínuo, pague um café para nós! Toda contribuição ajuda a manter o projeto ativo e evoluindo:

👉 **[buymeacoffee.com/monkyorg](https://buymeacoffee.com/monkyorg)**

## 📄 Licença

[MIT](LICENSE) — use, modifique e hospede à vontade.
