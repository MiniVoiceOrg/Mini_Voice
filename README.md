# Mini Voice 🎙️

Aplicativo desktop desenvolvido com **Electron**, **TypeScript**, **WebRTC P2P Mesh**, **WebSocket** e **SQLite** para comunicação simples, privada e autônoma entre amigos através de servidor self-hosted.

---

## 🚀 Funcionalidades Principais

- 🔊 **Comunicação por Voz P2P:** WebRTC Mesh de baixa latência sem retransmissão pesada pelo servidor.
- 🟢 **Detecção de Fala em Tempo Real (VAD):** Indicador visual de voz (anel verde) com sensibilidade ajustável via Web Audio API.
- 📷 **Câmera e Vídeo:** Ativação/desativação de webcam com controle de resolução e bitrate adaptativo.
- 🖥️ **Compartilhamento de Tela:** Compartilhamento de janelas e telas completas via Electron Desktop Capturer.
- 💬 **Chat de Texto:** Mensagens em tempo real, timestamps, avatares, histórico persistido no SQLite e rate limiting.
- 🎛️ **Perfis de Qualidade e Desempenho:**
  - **Econômico:** Áudio 24 kbps, Câmera 360p, Tela 480p (ideal para conexões modestas).
  - **Normal (Padrão):** Áudio 32 kbps, Câmera 480p, Tela 720p.
  - **Alta Qualidade:** Áudio 48 kbps, Câmera 720p, Tela 1080p.
  - **Gaming Mode:** Prioridade máxima para áudio (28 kbps), vídeo reduzido e sem impacto em jogos online.
- 🛡️ **Servidor Autoritativo Self-Hosted:**
  - Banco SQLite local (`server.db`) com migrações automáticas.
  - Hashing seguro de senhas com `scrypt`.
  - Validação rigorosa de uploads de avatar (MIME, magic bytes, limite de 5MB e proteção contra path traversal).
  - Proteção contra flood (10 msgs / 5s).
  - Nicknames únicos por servidor e Client ID persistido localmente.

---

## 📁 Estrutura do Projeto

```text
Mini_Voice/
├── packages/
│   └── shared/                 # Protocolo, modelos, constantes e validadores
├── apps/
│   ├── server/                 # Servidor autônomo (Node.js + WebSocket + SQLite + Clean Architecture)
│   └── client/                 # Aplicativo Desktop Electron (Main + Preload + Renderer com UI Dark Mode)
├── package.json                # Gerenciamento de Workspaces NPM
└── tsconfig.base.json          # Configuração base TypeScript
```

---

## 🛠️ Como Executar

### 1. Instalação e Build
```bash
npm install
npm run build
```

### 2. Executar os Testes Automatizados
```bash
npm run test --workspace=apps/server
```

### 3. Iniciar o Aplicativo Electron
```bash
npm start
```
*(ou `npm run start --workspace=apps/client`)*

### 4. Gerar Executável / ZIP para Enviar a Amigos
```bash
npm run package
```
*(Gera a pasta portátil e o arquivo `Mini-Voice-Windows.zip` na pasta `release/`)*

### 5. Executar Servidor Standalone (Opcional para VPS/Linux/Docker)
```bash
node apps/server/dist/index.js --port 3000 --data ./data --name "Servidor dos Amigos"
```

---

## 🗳️ Roadmap & Votação

O que entra nas próximas versões é decidido pela comunidade — e você **não
precisa saber programar** para participar.

- 💡 **[Sugerir uma ideia](https://github.com/MiniVoiceOrg/Mini_Voice/discussions/new?category=ideias)** — uma proposta por discussão
- ⬆️ **[Ver e votar nas ideias](https://github.com/MiniVoiceOrg/Mini_Voice/discussions/categories/ideias)** — antes de sugerir, veja se alguém já pediu o mesmo
- 📋 **[Board do projeto](https://github.com/orgs/MiniVoiceOrg/projects/1)** — o que está em desenvolvimento, em QA e concluído
- 🐛 **[Reportar um bug](https://github.com/MiniVoiceOrg/Mini_Voice/issues/new/choose)** — bugs vão direto para Issues, sem votação

Na primeira semana de cada mês, as três ideias mais votadas (com no mínimo 5
votos) viram issues no board e entram no fluxo de desenvolvimento. O status volta
para a discussão original (`planejado`, `em-andamento`, `entregue` ou
`fora-de-escopo`, sempre com o motivo).

Os mesmos atalhos estão dentro do app, em **Configurações › Comunidade**.

O processo completo — incluindo como rodar o projeto e abrir um PR — está em
**[CONTRIBUTING.md](CONTRIBUTING.md)**.

---

## 📄 Licença

[MIT](LICENSE) — use, modifique e hospede à vontade.
