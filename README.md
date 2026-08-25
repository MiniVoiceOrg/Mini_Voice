<div align="center">
  <img src="images/Logo.png" alt="Monky" width="220">
  <h1>Monky 🎙️</h1>
  <p><b>Voz, vídeo, tela e chat entre amigos — no seu próprio servidor, sem cadastro e sem intermediários.</b></p>

  <p>
    <a href="https://github.com/MonkyOrg/Monky/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/MonkyOrg/Monky?label=download&color=5865f2"></a>
    <a href="LICENSE"><img alt="Licença MIT" src="https://img.shields.io/badge/licen%C3%A7a-MIT-green"></a>
    <a href="https://github.com/MonkyOrg/Monky/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/MonkyOrg/Monky/actions/workflows/ci.yml/badge.svg"></a>
    <a href="https://github.com/MonkyOrg/Monky/discussions/categories/ideias"><img alt="Ideias" src="https://img.shields.io/badge/ideias-vote%20aqui-orange"></a>
  </p>

  <p><b>Português</b> · <a href="README.en.md">English</a></p>
</div>

---

## 📚 Índice

- [O que é o Monky](#-o-que-é-o-monky)
- [Instalando](#️-instalando)
- [Começando (o caminho rápido)](#-começando-o-caminho-rápido)
- [Criar o seu servidor](#-criar-o-seu-servidor)
- [Entrar em um servidor](#-entrar-em-um-servidor)
- [Usando o app no dia a dia](#-usando-o-app-no-dia-a-dia)
- [Configurações que valem a pena ajustar](#️-configurações-que-valem-a-pena-ajustar)
- [Hospedar num VPS (ou Linux/Docker)](#-hospedar-num-vps-ou-linuxdocker)
- [Problemas comuns](#-problemas-comuns)
- [Recursos em resumo](#-recursos-em-resumo)
- [Roadmap & Votação](#️-roadmap--votação)
- [Como colaborar](#-como-colaborar)
- [Para desenvolvedores](#-para-desenvolvedores)
- [Licença](#-licença)

---

## 🤔 O que é o Monky

Monky é um aplicativo desktop (Windows e macOS) para conversar por voz com
os amigos, ligar a câmera, compartilhar a tela e trocar mensagens — no estilo de
um Discord bem enxuto, só que **o servidor é seu**.

Como funciona na prática:

1. **Uma pessoa hospeda.** Ela clica em *Criar Servidor* dentro do próprio app
   (ou roda o servidor num VPS). Não existe conta, e-mail nem nuvem no meio.
2. **Os amigos entram** informando o IP e a porta desse servidor.
3. **A conversa é direta.** O servidor só faz o "encontro" (login, canais, chat e
   sinalização). A voz, o vídeo e o compartilhamento de tela viajam **P2P
   (WebRTC)** de um computador para o outro, o que deixa a latência baixa e a
   banda do anfitrião livre.

Tudo o que é seu fica com você: histórico de chat e usuários ficam num arquivo
SQLite (`server.db`) na máquina do anfitrião; nickname, avatar e preferências
ficam salvos no seu próprio PC.

---

## ⬇️ Instalando

Baixe a versão mais recente na página de releases:

**➡️ [github.com/MonkyOrg/Monky/releases/latest](https://github.com/MonkyOrg/Monky/releases/latest)**

| Sistema | Arquivo | Observação |
|---|---|---|
| Windows 10/11 (x64) | `Monky-<versão>-win-x64-setup.exe` | Instalador — permite escolher a pasta |
| Windows 10/11 (x64) | `Monky-<versão>-win-x64-portable.exe` | Não instala nada, é só executar |
| macOS (Intel / Apple Silicon) | `Monky-<versão>-mac-<arch>.dmg` | Escolha `x64` (Intel) ou `arm64` (M1/M2/M3+) |

> **O Windows/macOS mostrou um aviso de segurança?** É esperado: os
> executáveis ainda não têm assinatura digital paga. No Windows, clique em
> *Mais informações › Executar assim mesmo*. No macOS, clique com o botão
> direito no app › *Abrir*.

**Atualizações:** o app avisa quando sai uma versão nova, e você também pode
conferir a qualquer momento em **Configurações › Atualizações › Verificar
atualizações**.

---

## 🚀 Começando (o caminho rápido)

Ao abrir o app você vê a tela de conexão, com duas abas: **Entrar no Servidor**
e **Meus Servidores**. Antes de qualquer coisa, escolha seu **nickname** e, se
quiser, uma **foto de perfil** (fica salva no seu PC e vai junto para os
servidores em que você entrar).

Escolha o seu caso:

- 👥 **Um amigo já tem um servidor** → vá para [Entrar em um servidor](#-entrar-em-um-servidor).
- 🏠 **Você quer hospedar** → vá para [Criar o seu servidor](#-criar-o-seu-servidor).

---

## 🏠 Criar o seu servidor

Na aba **Meus Servidores › Criar Servidor**, preencha:

| Campo | Para que serve |
|---|---|
| **Seu Nickname (Anfitrião)** | Como você vai aparecer para os outros |
| **Nome do Servidor** | O nome que seus amigos verão (ex: *QG dos Amigos*) |
| **Porta Local** | Padrão `3000`. Só mude se essa porta já estiver em uso |
| **Senha de Acesso** | Opcional. Sem senha, qualquer um que tenha seu IP entra |
| **Canal de Texto / Canal de Voz** | Os canais iniciais (dá para criar mais depois) |

Clique em **Criar e Iniciar Servidor**. O servidor sobe na sua máquina, escuta
em todas as suas interfaces de rede na porta escolhida, e você já entra nele
automaticamente.

**Servidores criados ficam salvos** (até 10). Da próxima vez, é só abrir a aba
*Meus Servidores* e clicar em **Iniciar** — sem preencher nada de novo. O botão
**Parar** encerra o servidor local, e o **X** remove o servidor da lista.

> ⚠️ Enquanto o app do anfitrião estiver fechado (ou o servidor parado),
> ninguém consegue entrar. Se o servidor precisa ficar de pé 24/7, veja
> [Hospedar num VPS](#-hospedar-num-vps-ou-linuxdocker).

### Convidar os amigos

Já dentro do servidor, clique no **nome do servidor** (topo da lista de canais)
› **Convidar Amigos**. O app mostra o nome do servidor, o **seu IP público** e a
porta, e o botão copia tudo pronto para colar no WhatsApp/Discord.

Qual IP mandar para cada situação:

| Situação | IP que seus amigos devem usar |
|---|---|
| Todos na mesma casa/rede (Wi-Fi ou cabo) | Seu **IP local** (ex: `192.168.0.10`) — ou nem isso: o app deles acha o servidor sozinho |
| Amigos em outra internet | Seu **IP público** + porta liberada no roteador |
| Amigos em outra internet, sem mexer no roteador | O IP da **VPN** (Radmin VPN, Hamachi, ZeroTier, Tailscale…) |

### Liberando o acesso pela internet

Para que alguém de fora da sua rede consiga conectar direto no seu IP público:

1. **Libere a porta no firewall do Windows** (ou do seu sistema) para o
   aplicativo Monky.
2. **Faça o encaminhamento de porta (port forwarding)** no roteador: porta
   `3000` (TCP) apontando para o IP local do seu PC.
3. Se seu provedor usa CGNAT (comum em internet 4G/5G e alguns planos de fibra),
   o passo 2 não funciona — nesse caso use uma **VPN** como Radmin VPN ou
   Hamachi e passe o IP da VPN.

### Administrando o servidor

Clicando no nome do servidor você também acessa **Configurações do Servidor**,
onde dá para **renomear o servidor**, **alterar ou remover a senha** e
**permitir ou bloquear o soundboard** para todo mundo. Nos cabeçalhos
*Canais de Texto* e *Canais de Voz*, o **+** cria novos canais e o ícone de
lixeira apaga.

---

## 👥 Entrar em um servidor

Na aba **Entrar no Servidor** existem três caminhos:

**1. Servidores na Rede (mesma rede local).** Clique em **Buscar**: o app
escuta por ~5 segundos os servidores Monky na sua rede e lista cada um com
nome, IP e versão. Clique em **Entrar** e pronto — sem digitar IP.

**2. Servidores Salvos.** Todo servidor em que você entra fica salvo. A bolinha
ao lado do nome indica se ele está **online** (verde) ou **offline**, e a lista
mostra quem está conectado no momento. Clique em **Usar** para preencher os
campos, ou no **X** para remover da lista.

**3. Na mão.** Preencha:

- **Seu Nickname** — precisa ser único dentro daquele servidor;
- **IP / Host do Servidor** — o que o anfitrião te passou;
- **Porta** — normalmente `3000`;
- **Senha do Servidor** — só se o anfitrião tiver definido uma.

Clique em **Entrar no Servidor**.

> **Deu erro de conexão?** Veja [Problemas comuns](#-problemas-comuns).

---

## 🎧 Usando o app no dia a dia

### Voz

- Clique em um **canal de voz** na lista à esquerda para entrar na chamada.
- Quem está falando ganha um **anel verde** ao redor do avatar (detecção
  automática de voz — não existe push-to-talk, você fala e o app detecta).
- Na barra inferior: **microfone** (mutar/desmutar), **fone**
  (ensurdecer — para de ouvir todo mundo e muta você) e **desconectar**.
- O painel de voz mostra o **ping médio** da chamada e um botão para sair
  apenas da chamada, continuando no servidor.
- **Clique com o botão direito** em qualquer participante para ajustar o
  **volume individual** dele (0% muta só para você, 100% volta ao padrão).

### Câmera e compartilhamento de tela

Na barra de mídia, acima do seu perfil:

- 📷 **Câmera** — liga/desliga a webcam.
- 🖥️ **Compartilhar Tela** — abre o seletor para escolher **uma tela inteira ou
  uma janela específica**. O áudio da tela também é transmitido para os outros
  participantes.
- 🎵 **Soundboard** — toca seus efeitos sonoros na chamada (veja abaixo).

Quem está transmitindo aparece com o selo **LIVE** na lista de membros. Clique
no card do participante para colocá-lo em destaque (clique de novo para voltar
ao mosaico) ou use o botão de tela cheia sobre o vídeo.

### Chat

Cada **canal de texto** tem histórico salvo no servidor, com avatares,
horários e formatação básica de mensagem. Há um limite anti-flood de
10 mensagens a cada 5 segundos.

### Soundboard

1. Em **Configurações › Soundboard**, escolha uma **pasta do seu PC** com
   arquivos `.mp3`, `.wav` ou `.ogg`.
2. Na chamada, clique no botão de soundboard e toque o som — todo mundo ouve.
3. O **volume** dos sons e a opção **mutar soundboard só para você** ficam nas
   mesmas configurações.

O anfitrião pode desativar o soundboard para o servidor inteiro em
*Configurações do Servidor*.

---

## ⚙️ Configurações que valem a pena ajustar

Abra pelo ícone de engrenagem (na tela de conexão ou na barra inferior).

- **Perfil** — nickname e foto.
- **Dispositivos** — escolha do microfone, do alto-falante/fone e da câmera,
  com **pré-visualização da câmera** e botão para atualizar a lista quando você
  plugar um headset novo.
- **Sensibilidade de Voz (VAD)** — fale e observe o medidor: deixe o marcador
  logo acima do nível que aparece quando você está em silêncio. Valores baixos
  captam sussurros; valores altos ignoram ruído de fundo.
- **Supressão de Ruído (RNNoise)** — remove teclado mecânico, cliques e ruído
  ambiente usando rede neural. Deixe ligado se seu ambiente é barulhento.
- **Perfil de Qualidade e Desempenho** — afeta **apenas o que você transmite**:

  | Perfil | Áudio | Câmera | Tela | Quando usar |
  |---|---|---|---|---|
  | **Econômico** | 24 kbps | 360p | 480p | Internet lenta ou instável |
  | **Normal** (padrão) | 32 kbps | 480p | 720p | Uso geral |
  | **Alta Qualidade** | 48 kbps | 720p | 1080p | Internet rápida e PC sobrando |
  | **Gaming** | 28 kbps | reduzida | fluida (60 FPS) | Jogando: prioriza voz e tela fluida |

- **Atualizações** — versão atual e verificação manual.
- **Comunidade** — atalhos para sugerir ideias, votar e reportar bugs.

---

## 🖧 Hospedar num VPS (ou Linux/Docker)

Se você quer o servidor no ar 24/7, rode só o servidor (sem interface gráfica)
numa máquina Linux. Requer **Node.js 20 ou superior** (a CI do projeto usa a 22):

```bash
git clone https://github.com/MonkyOrg/Monky.git
cd Monky
npm install
npm run build
node apps/server/dist/index.js --port 3000 --data ./data --name "Servidor dos Amigos"
```

Opções disponíveis:

| Opção | Padrão | Descrição |
|---|---|---|
| `--port <n>` | `3000` | Porta TCP do servidor |
| `--data <caminho>` | `./data` | Onde ficam o `server.db` e os avatares |
| `--name <texto>` | `Servidor dos Amigos` | Nome exibido no app |
| `--password <senha>` | *(vazio)* | Senha de acesso |
| `--max-users <n>` | `20` | Limite de usuários simultâneos |
| `--text-channel <nome>` | `geral` | Canal de texto inicial |
| `--voice-channel <nome>` | `Geral` | Canal de voz inicial |

Depois, seus amigos entram normalmente usando o **IP do VPS** e a porta.

### Portas usadas

| Porta | Protocolo | Para quê | Precisa liberar? |
|---|---|---|---|
| `3000` (ou a que você escolher) | TCP | Login, chat, canais e sinalização | **Sim**, no anfitrião |
| `41234` | UDP | Descoberta automática de servidores na rede local | Só para achar servidores na LAN |
| Portas altas dinâmicas | UDP | Voz, vídeo e tela (WebRTC, direto entre os PCs) | Normalmente já funciona; conexões domésticas comuns resolvem sozinhas via STUN |

> A mídia P2P usa servidores STUN públicos para atravessar o NAT. Não há
> servidor TURN: em redes muito restritas (CGNAT dos dois lados, redes
> corporativas), a saída mais simples é todo mundo entrar numa VPN.

---

## 🧯 Problemas comuns

| Sintoma | O que costuma resolver |
|---|---|
| **"Não consigo conectar no servidor do meu amigo"** | Confirme IP e porta; peça para ele confirmar que o servidor está **iniciado**; verifique firewall e port forwarding no lado dele; se for CGNAT, usem uma VPN |
| **"Nickname já em uso"** | Nicknames são únicos por servidor — escolha outro |
| **Entrei, mas ninguém me ouve** | Confira o microfone em *Configurações › Dispositivos*, veja se o medidor VAD reage quando você fala, baixe a **sensibilidade de voz** e confirme que o mic não está mutado na barra inferior |
| **Ouço todo mundo cortando / travando** | Troque para o perfil **Econômico**, peça o mesmo a quem transmite, e prefira cabo a Wi-Fi |
| **A tela compartilhada está sem som** | Compartilhe uma **tela inteira** em vez de uma janela, e confira o volume do app de origem |
| **Não aparece nada em "Servidores na Rede"** | A descoberta só funciona na mesma rede local; clique em **Buscar** de novo e verifique se o firewall bloqueia UDP `41234` |
| **Um participante ficou mudo só para mim** | Botão direito no nome dele → volume individual em 100% |

---

## ✨ Recursos em resumo

- 🔊 **Voz P2P (WebRTC Mesh)** de baixa latência, sem passar áudio pelo servidor.
- 🟢 **Detecção de fala (VAD)** com sensibilidade ajustável e medidor ao vivo.
- 🤖 **Supressão de ruído com IA (RNNoise)**.
- 📷 **Câmera** com resolução e bitrate adaptativos.
- 🖥️ **Compartilhamento de tela ou janela**, com áudio.
- 💬 **Chat** com histórico persistente, avatares e proteção anti-flood.
- 🎵 **Soundboard** a partir de uma pasta do seu PC, com controle do anfitrião.
- 📡 **Descoberta automática de servidores** na rede local.
- 🎛️ **Perfis de qualidade** (Econômico, Normal, Alta Qualidade e Gaming).
- 🛡️ **Servidor self-hosted** com SQLite, senhas com `scrypt` e validação
  rigorosa de upload de avatares.

---

## 🗳️ Roadmap & Votação

O que entra nas próximas versões é decidido pela comunidade — e você **não
precisa saber programar** para participar.

- 💡 **[Sugerir uma ideia](https://github.com/MonkyOrg/Monky/discussions/new?category=ideias)** — uma proposta por discussão
- ⬆️ **[Ver e votar nas ideias](https://github.com/MonkyOrg/Monky/discussions/categories/ideias)** — antes de sugerir, veja se alguém já pediu o mesmo
- 📋 **[Issues abertas](https://github.com/MonkyOrg/Monky/issues)** — o que já foi planejado e o que está em andamento
- 🐛 **[Reportar um bug](https://github.com/MonkyOrg/Monky/issues/new/choose)** — bugs vão direto para Issues, sem votação

Na primeira semana de cada mês, as três ideias mais votadas (com no mínimo 5
votos) viram issues e entram no fluxo de desenvolvimento. O status volta
para a discussão original (`planejado`, `em-andamento`, `entregue` ou
`fora-de-escopo`, sempre com o motivo).

Os mesmos atalhos estão dentro do app, em **Configurações › Comunidade**.

---

## 🤝 Como colaborar

Toda ajuda conta, e a maior parte dela **não exige escrever código**.

### Sem programar

| O que fazer | Onde |
|---|---|
| Sugerir uma funcionalidade | [Discussions › Ideias](https://github.com/MonkyOrg/Monky/discussions/new?category=ideias) — uma proposta por discussão |
| Votar no que vem primeiro | [Ideias abertas](https://github.com/MonkyOrg/Monky/discussions/categories/ideias) — o voto define o próximo ciclo |
| Reportar um bug | [Nova issue](https://github.com/MonkyOrg/Monky/issues/new/choose) — com passos para reproduzir |
| Testar uma versão beta | **Configurações › Sobre e Updates › Receber versões beta** |
| Melhorar a documentação | PR direto neste `README.md` ou no `CONTRIBUTING.md` |

Ajudar a testar é especialmente útil: o projeto roda em Windows e macOS, em
redes muito diferentes (LAN, VPN, IP público, CGNAT), e a maioria dos problemas
aparece justamente nessa variedade.

### Com código

1. **Escolha uma issue.** As [issues abertas](https://github.com/MonkyOrg/Monky/issues) mostram o que já está
   planejado; comente na que você quiser pegar, para ninguém trabalhar em
   duplicado. Se for algo novo, abra uma issue antes — evita você codar algo
   que não entra.
2. **Faça um fork** e crie sua branch **a partir da `main` atualizada**:
   ```bash
   git checkout main && git pull
   git checkout -b feat/minha-mudanca
   ```
3. **Rode o projeto** — os comandos estão em
   [Para desenvolvedores](#-para-desenvolvedores).
4. **Abra o PR para a `main`.** A CI compila e empacota em Windows e macOS;
   **o PR só entra com os dois checks verdes**.
5. **Descreva como testar** na descrição do PR: o que mudou e o passo a passo
   para alguém validar. É o que faz a revisão andar rápido.

O `main` é protegido e todo merge passa por PR com squash.

📖 **O processo completo — padrões de código, estrutura do projeto, o que o
Monky é e o que não é — está em [CONTRIBUTING.md](CONTRIBUTING.md).**

---

## 💻 Para desenvolvedores

Requisitos: **Node.js 20 ou superior** (a CI usa a 22) e npm. No Windows, o módulo nativo de áudio de tela
precisa de **Python 3.11** e das **Build Tools do Visual Studio (MSVC)**.

```bash
npm install          # instala todos os workspaces
npm run build        # compila shared + server + client
npm start            # abre o app Electron
npm test             # roda os testes de todos os workspaces
npm run package      # gera o executável/ZIP em release/
```

Estrutura do repositório:

```text
Monky/
├── packages/
│   └── shared/                 # Protocolo, modelos, constantes e validadores
├── apps/
│   ├── server/                 # Servidor Node.js + WebSocket + SQLite (Clean Architecture)
│   └── client/                 # App Electron (main + preload + renderer)
├── package.json                # Workspaces NPM
└── tsconfig.base.json          # Configuração base do TypeScript
```

Quer mandar uma mudança? Veja [Como colaborar](#-como-colaborar).

---

## 📄 Licença

[MIT](LICENSE) — use, modifique e hospede à vontade.
