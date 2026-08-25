# Contribuindo com o Mini Voice

Obrigado pelo interesse! Este documento explica como propor ideias, votar no que
vem primeiro e — se você quiser codar — como abrir um PR que entra sem atrito.

O Mini Voice é MIT e o desenvolvimento acontece todo em público, nas
[Issues](https://github.com/MiniVoiceOrg/Mini_Voice/issues).

---

## 🗳️ A forma mais fácil de ajudar: dizer o que você quer

Você **não precisa saber programar** para influenciar o rumo do projeto. O que
entra em cada ciclo é decidido pelos votos da comunidade.

### Propor uma ideia

Abra uma discussão em
**[Discussions › Ideias](https://github.com/MiniVoiceOrg/Mini_Voice/discussions/categories/ideias)**.

Duas regras que fazem a votação funcionar:

1. **Procure antes de postar.** Se a ideia já existe, vote nela em vez de abrir
   outra — duas propostas iguais dividem os votos e as duas perdem.
2. **Uma ideia por discussão.** Numa lista com cinco pedidos ninguém consegue
   dizer que concorda com o terceiro e discorda do quinto.

### Votar

Use o **botão de upvote** (⬆️) da discussão. É ele que conta — reações 👍 nos
comentários não entram no ranking.

Vote com honestidade: votos inflados por contas novas ou pedidos de mutirão são
descartados. O objetivo é medir o que as pessoas realmente querem, não quem
consegue mobilizar mais gente.

### O ciclo: como um voto vira código

Toda ideia carrega um label que diz em que pé ela está:

| Label | Significa |
|---|---|
| `ideia` | Aberta para votos e discussão |
| `planejado` | Selecionada — já virou issue |
| `em-andamento` | Alguém está implementando |
| `entregue` | Está em uma release publicada |
| `fora-de-escopo` | Não vamos fazer — sempre com o motivo explicado |

**Na primeira semana de cada mês**, as ideias em votação são revisadas. As **três
mais votadas** que tiverem **pelo menos 5 votos** são selecionadas: viram issues
com escopo e critérios de aceite e recebem o label `planejado`. Dali seguem o
fluxo normal: implementação → PR → release → validação → entrega.

O piso de 5 votos existe para o ciclo não promover ruído em meses parados — se
nenhuma ideia alcançar o piso, nenhuma é selecionada e todas continuam
acumulando votos para o mês seguinte. Votos não zeram entre ciclos.

Uma ideia não selecionada **não é recusada** — ela continua em votação. Só recebe
`fora-de-escopo` quando há uma decisão explícita de não fazer, sempre com o
motivo escrito na discussão.

Duas coisas que assumimos como compromisso:

- **Voto alto não é promessa automática.** Uma ideia muito votada pode ser
  recusada se conflitar com o que o Mini Voice é — P2P, self-hosted, sem
  servidor central e sem coleta de dados. Quando isso acontecer, o motivo é
  escrito na discussão, não deixamos morrer no silêncio.
- **O status volta para a discussão.** Se nada nunca muda de label, a votação
  vira teatro e as pessoas param de votar. Fechar esse ciclo é obrigação de quem
  mantém o projeto.

### Reportar um bug

Bugs vão direto em [Issues](https://github.com/MiniVoiceOrg/Mini_Voice/issues/new/choose),
não em Discussions — eles não precisam de votação para serem corrigidos.

---

## 💻 Contribuindo com código

### Rodando o projeto

Requisitos: **Node.js 22+** e as ferramentas de build nativas da sua plataforma
(o módulo de captura de áudio de tela é C++: MSVC no Windows, Xcode Command Line
Tools no macOS).

```bash
git clone https://github.com/MiniVoiceOrg/Mini_Voice.git
cd Mini_Voice
npm install
npm run build
npm start
```

Durante o desenvolvimento, em dois terminais:

```bash
npm run dev:server   # servidor WebSocket + SQLite
npm run dev:client   # app Electron com rebuild
```

Testes do servidor:

```bash
npm run test --workspace=apps/server
```

### Antes de começar a codar

**Trabalhe a partir de uma issue.** Se o que você quer fazer ainda não é uma
issue, abra a discussão primeiro — evita você investir tempo em algo que seria
recusado no PR por estar fora do escopo do projeto.

**Se a issue não estiver clara, pergunte antes.** Requisitos ambíguos, critérios
de aceite vagos ou decisões de design em aberto viram retrabalho garantido.
Nunca assuma — comente na issue e espere a resposta.

**Não pegue issues marcadas como bloqueadas.** Se você acha que uma delas
deveria andar, comente nela explicando o porquê antes de começar.

### Abrindo o PR

A `main` é protegida — todo merge passa por PR com squash.

```bash
git checkout -b feat/minha-mudanca
# ... commits ...
git push -u origin feat/minha-mudanca
```

Prefixos de branch e commit seguem [Conventional Commits](https://www.conventionalcommits.org/):
`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `ci:`. Referencie a issue no
título quando houver: `fix(voice): restaura microfone ao des-ensurdecer (#89)`.

Todo PR roda o workflow de **CI**, que faz o build e empacota o app em
Windows e macOS (`electron-builder --dir`, sem publicar). Isso pega regressões
de build nativo antes do merge — se falhar, o merge não acontece.

### Descreva como testar

No PR (ou na issue), inclua duas seções em PT-BR:

- **Como foi implementado** — resumo técnico: arquivos e áreas alteradas,
  decisões relevantes.
- **Como testar** — passo a passo para o QA validar: cenários, resultado
  esperado e casos de borda.

Isso não é burocracia: quem valida a mudança testa a partir do **build
publicado**, não do seu ambiente. Sem o passo a passo, a validação trava.

### Depois do merge

O push na `main` dispara o workflow **Release** automaticamente, que builda e
publica a nova versão com os artefatos de Windows e macOS. A validação só
começa **depois que a release estiver publicada** — nunca só após o merge.

> 🤖 Se você é um agente de IA trabalhando neste repositório, o fluxo completo e
> obrigatório está em [`AGENTS.md`](AGENTS.md).

---

## 🧭 O que o Mini Voice é (e o que não é)

Ajuda a calibrar propostas antes de escrevê-las:

- **É** um app de voz, vídeo, tela e chat **P2P** com servidor **self-hosted**,
  para grupos pequenos de amigos.
- **É** privado por construção: sem servidor central, sem conta obrigatória, sem
  telemetria, sem coleta de dados.
- **Não é** uma alternativa ao Discord em escala — o WebRTC mesh é ótimo para
  poucos participantes e ruim para dezenas.
- **Não é** um SaaS. Não haverá infraestrutura hospedada por nós que as pessoas
  precisem usar.

Propostas que exigem servidor central, cadastro ou coleta de dados vão contra a
razão de existir do projeto e serão recusadas — mesmo que sejam boas ideias em
abstrato.

---

## 📜 Licença

Ao contribuir, você concorda que sua contribuição será licenciada sob a
[licença MIT](LICENSE) do projeto.
