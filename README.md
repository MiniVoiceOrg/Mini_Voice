<div align="center">
  <img src="images/Logo.png" alt="Monky" width="220">
  <h1>Monky 🎙️</h1>
  <p><b>Voz, vídeo, tela e chat entre amigos — no seu próprio servidor, sem cadastro e sem intermediários.</b></p>

  <p>
    <a href="https://github.com/MonkyOrg/Monky/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/MonkyOrg/Monky?label=download&color=5865f2"></a>
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

Se o Windows/macOS mostrar aviso de segurança, veja [Instalação](https://github.com/MonkyOrg/Monky/wiki/Instalacao). Para checksums e assinatura, veja [Verificar Releases](https://github.com/MonkyOrg/Monky/wiki/Verificar-Releases).

## 📚 Documentação

- [Wiki do Monky](https://github.com/MonkyOrg/Monky/wiki) — manual para usar e hospedar.
- [Primeiros Passos](https://github.com/MonkyOrg/Monky/wiki/Primeiros-Passos)
- [Criar Seu Servidor](https://github.com/MonkyOrg/Monky/wiki/Criar-Seu-Servidor)
- [Entrar Em Um Servidor](https://github.com/MonkyOrg/Monky/wiki/Entrar-Em-Um-Servidor)
- [Usando o App](https://github.com/MonkyOrg/Monky/wiki/Usando-o-App)
- [Hospedar em VPS](https://github.com/MonkyOrg/Monky/wiki/Hospedar-em-VPS)

## 🧩 Os 3 produtos

- **Monky** — app cliente para conversar com amigos.
- **[Monky Server](https://github.com/MonkyOrg/Monky/wiki/Monky-Server)** — painel gráfico para quem hospeda.
- **[Monky CLI](docs/CLI.md)** — administração por linha de comando, ideal para VPS.

## 🗳️ Roadmap & Votação

A comunidade decide as próximas versões: [sugira ideias](https://github.com/MonkyOrg/Monky/discussions/new?category=ideas), [vote nas ideias abertas](https://github.com/MonkyOrg/Monky/discussions/categories/ideas) ou acompanhe as [issues](https://github.com/MonkyOrg/Monky/issues).

## 🤝 Como colaborar

Bugs começam em [Discussions › Bug Reports](https://github.com/MonkyOrg/Monky/discussions/new?category=bug-reports). Mudanças de código e documentação são bem-vindas por PR; leia [CONTRIBUTING.md](CONTRIBUTING.md).

## 💻 Para desenvolvedores

Requisitos: Node.js 20+ (CI usa 22) e npm. No Windows, o módulo nativo de áudio de tela precisa de Python 3.11 e Build Tools do Visual Studio (MSVC).

```bash
npm install
npm run build
npm start
npm test
```

A arquitetura e comandos completos ficam em [CONTRIBUTING.md](CONTRIBUTING.md), [docs/CLI.md](docs/CLI.md) e [docs/especificacao-tecnica.md](docs/especificacao-tecnica.md).

## 📄 Licença

[MIT](LICENSE) — use, modifique e hospede à vontade.
