# Monky CLI

O `monky` é a ferramenta de administração do servidor Monky para VPS, Docker
ou qualquer ambiente sem cliente gráfico. Ele abre o mesmo banco `server.db`
usado pelo servidor e funciona em dois modos:

- **Modo interativo** — execute o comando sem argumentos e o CLI faz as
  perguntas necessárias passo a passo.
- **Modo direto** — passe todos os argumentos na linha de comando para
  execução imediata (útil para scripts e automação).

> **Nota:** para comandos administrativos (`members`, `roles`, `admin`,
> `config`), prefira usar o CLI com o servidor parado para evitar duas
> instâncias gravando o mesmo SQLite ao mesmo tempo.

---

## Instalação

### Pré-requisitos

- Node.js 18+
- npm

### Instalar a partir da release (recomendado)

Não é preciso clonar nem compilar nada. Cada release publica um pacote
`monky-cli-<versão>.tgz` pronto para instalação global:

```bash
npm install -g https://github.com/MonkyOrg/Monky/releases/download/v2.3.0/monky-cli-2.3.0.tgz
```

> Troque `v2.3.0` pela versão desejada. A lista completa está na
> [página de releases](https://github.com/MonkyOrg/Monky/releases).

Depois disso, `monky` fica disponível globalmente no terminal — de qualquer
pasta, sem `npx`. Confira com:

```bash
monky --help
```

Para atualizar, basta instalar a URL da versão nova por cima.

### Instalar a partir do código-fonte

Útil para desenvolvimento ou para rodar uma versão ainda não publicada:

```bash
git clone https://github.com/MonkyOrg/Monky.git
cd Monky
npm install
npm run build
npm install -g ./apps/server
```

### Formas alternativas de execução

Se não quiser instalar globalmente:

```bash
# Via npx (na raiz do monorepo)
npx monky <comando>

# Via node direto
node apps/server/dist/cli.js <comando>

# Via npm workspace
npm run cli --workspace=apps/server -- <comando>
```

---

## Opções globais

| Opção            | Descrição                                | Padrão   |
|------------------|------------------------------------------|----------|
| `--data <pasta>` | Caminho da pasta de dados do servidor    | `./data` |
| `--help`, `-h`   | Exibe a ajuda                            | —        |

A opção `--data` pode ser usada em qualquer comando. Quando omitida, o CLI
usa `./data` como padrão. Se a pasta não existir (em comandos que precisam
de um servidor existente), o CLI pergunta o caminho interativamente.

---

## Referência de comandos

### `monky bootstrap`

Configura um novo servidor definindo o dono/administrador inicial. É o
primeiro comando a executar numa VPS nova.

#### Modo interativo

```bash
monky bootstrap
```

O CLI pergunta passo a passo:

1. **Caminho dos dados do servidor** (padrão: `./data`)
2. **Código de identidade do dono** (`MONKY-ID:...`) — obtido no app Monky
   em Configurações → Exportar Identidade
3. **Senha da identidade** (entrada oculta)
4. **Nickname do dono** (padrão: `Owner`)
5. **Nome do servidor** (padrão: `Servidor dos Amigos`)
6. **Porta do servidor** (padrão: `3001`)
7. **Senha do servidor** (deixe vazio para sem senha)
8. **Confirmação** — exibe um resumo antes de aplicar
9. **Iniciar o servidor agora?** — opcionalmente já inicia após o bootstrap

#### Modo direto

```bash
monky bootstrap --identity "MONKY-ID:..." --nickname "MeuNick" --name "Servidor" --port 3001 --password "senhaDoServidor"
```

| Flag           | Descrição                                      | Obrigatório |
|----------------|-------------------------------------------------|-------------|
| `--identity`   | Código de identidade exportado (`MONKY-ID:...`) | Sim*        |
| `--nickname`   | Nickname do dono no servidor                    | Não         |
| `--name`       | Nome do servidor                                | Não         |
| `--port`       | Porta do servidor                               | Não         |
| `--password`   | Senha do servidor                               | Não         |

\* A senha da identidade é sempre solicitada interativamente (entrada oculta).

**Exemplo completo:**

```bash
monky --data /var/monky bootstrap --identity "MONKY-ID:1:eyJ..." --nickname Admin --name "QG da Galera" --port 4000
```

---

### `monky start`

Inicia o servidor Monky como daemon via **PM2** (process manager). O servidor
roda em background com auto-restart automático em caso de crash.

```bash
monky start
monky start --port 3001
monky start --data /var/monky --port 4000 --name "Meu Servidor"
```

| Flag               | Descrição                          | Padrão                |
|--------------------|------------------------------------|-----------------------|
| `--port`           | Porta do servidor                  | `3001`                |
| `--name`           | Nome do servidor                   | Valor salvo no banco  |
| `--password`       | Senha (só se não tiver no banco)   | —                     |
| `--max-users`      | Máximo de usuários                 | Valor salvo ou `100`  |
| `--voice-channel`  | Nome do canal de voz inicial       | `Geral`               |
| `--text-channel`   | Nome do canal de texto inicial     | `geral`               |

O comando:

- Instala PM2 globalmente se não estiver disponível.
- Cria a pasta de dados se não existir.
- Gera um arquivo `ecosystem.config.cjs` na pasta de dados.
- Inicia o processo via PM2 como daemon (background).
- Auto-restart: se o servidor crashar, PM2 reinicia automaticamente.
- Limite de memória: 512 MB (reinicia se exceder).

---

### `monky stop`

Para o servidor Monky.

```bash
monky stop
```

Remove o processo do PM2.

---

### `monky restart`

Reinicia o servidor Monky sem downtime.

```bash
monky restart
```

---

### `monky status`

Exibe o estado atual do servidor.

```bash
monky status
```

Mostra: status (online/stopped/errored), PID, uptime, quantidade de
restarts, memória e CPU.

---

### `monky logs`

Exibe os logs do servidor em tempo real (tail).

```bash
monky logs                              # segue os logs, começando pelas últimas 100 linhas
monky logs --lines 500                  # começa exibindo as últimas 500 linhas
monky logs --level WARN                 # só avisos e erros
monky logs --level ERROR --no-follow    # imprime os erros recentes e sai
```

| Flag                | Descrição                                              | Padrão |
|---------------------|--------------------------------------------------------|--------|
| `--lines <n>`       | Quantas linhas de histórico exibir antes de acompanhar | `100`  |
| `--level <nível>`   | Nível mínimo: `INFO`, `WARN` ou `ERROR`                | `INFO` |
| `--no-follow`       | Imprime o histórico e encerra, sem acompanhar          | —      |

`--level` filtra por nível mínimo: `INFO` mostra tudo, `WARN` mostra avisos e
erros, `ERROR` mostra só erros. Linhas de continuação (como stack traces)
acompanham o nível da linha acima delas.

Pressione `Ctrl+C` para sair.

::: tip
`monky logs` lê os logs do servidor iniciado com `monky start`, que roda via
PM2. Se o servidor estiver rodando dentro do app Monky, use o **Monitor do
Servidor** no próprio app — veja [Criar Seu Servidor](/criar-seu-servidor).
:::

---

### `monky members`

Gerencia membros do servidor.

#### Listar membros

```bash
monky members
monky members list
```

Exibe tabela com ID, Nickname, Client ID e Roles de cada membro.

#### Informações de um membro

```bash
# Modo interativo — pergunta o nickname/clientId
monky members info

# Modo direto — por nickname
monky members info lucas

# Modo direto — por clientId
monky members info abcd1234efgh5678
```

Exibe informações detalhadas: id, clientId, publicKey, avatar, datas de
criação e último acesso, se é owner, e cargos atribuídos.

---

### `monky admin`

Gerencia o cargo de administrador.

#### Adicionar admin

```bash
# Modo interativo — lista membros numerados para escolher
monky admin add

# Modo direto — por nickname
monky admin add lucas

# Modo direto — por clientId
monky admin add abcd1234efgh5678
```

No modo interativo, o CLI exibe uma lista navegável:

```
Membros do servidor:
  Use ↑↓ para navegar, Enter para selecionar
❯ Alice (abc123...)
  Bob (def456...)
  Carlos (ghi789...)
```

#### Remover admin

```bash
monky admin remove lucas
monky admin remove abcd1234efgh5678
```

---

### `monky roles`

Gerencia cargos (roles) do servidor.

#### Listar cargos

```bash
monky roles
monky roles list
```

Exibe cada cargo com: nome, ID, cor, posição, permissões (valor numérico),
se é padrão, e quantidade de membros atribuídos.

#### Criar cargo

```bash
# Modo interativo — pergunta nome, cor e permissões
monky roles create

# Modo direto
monky roles create "Moderador" "#00ff88" MANAGE_CHANNELS,MUTE_MEMBERS
```

No modo interativo, as permissões são exibidas como lista navegável com
seleção múltipla:

```
Permissões do cargo:
  Use ↑↓ para navegar, Espaço para marcar/desmarcar, Enter para confirmar
❯   Administrator (ADMINISTRATOR)
    Manage Server (MANAGE_SERVER)
    Manage Channels (MANAGE_CHANNELS)
    Mute Members (MUTE_MEMBERS)
    Deafen Members (DEAFEN_MEMBERS)
    Move Members (MOVE_MEMBERS)
    Kick Members (KICK_MEMBERS)
  ✔ Speak (SPEAK)
  ✔ Send Messages (SEND_MESSAGES)
  ✔ Read Messages (READ_MESSAGES)
    Attach Files (ATTACH_FILES)
```

Use `A` para selecionar/desmarcar tudo.

#### Atribuir cargo a membro

```bash
# Modo interativo — escolhe membro e cargo nas listas
monky roles assign

# Modo direto
monky roles assign lucas Moderador
```

No modo interativo, primeiro seleciona o membro (lista navegável com setas),
depois o cargo (lista navegável com setas).

#### Remover cargo de membro

```bash
# Modo interativo — escolhe membro e cargo a remover
monky roles unassign

# Modo direto
monky roles unassign lucas Moderador
```

Cargos marcados como padrão não podem ser removidos.

#### Excluir cargo

```bash
# Modo interativo — lista cargos e pede confirmação
monky roles delete

# Modo direto
monky roles delete Moderador
```

O CLI pede confirmação antes de excluir (`Confirma a remoção do cargo X? (s/N)`).

---

### `monky config`

Gerencia a configuração do servidor.

#### Exibir configuração

```bash
monky config
monky config show
```

Exibe: dataDir, id, name, hasPassword, maxUsers, ownerUserId, ownerNickname,
allowSoundboard, iconPath, maxAttachmentFileBytes, maxAttachmentStorageBytes
e createdAt.

#### Alterar configuração

```bash
# Modo interativo — menu com as chaves disponíveis
monky config set

# Modo direto
monky config set name "Servidor dos Amigos"
monky config set maxUsers 50
monky config set password "novasenha"
monky config set password clear
monky config set allowSoundboard false
monky config set maxAttachmentFileBytes 10485760
monky config set maxAttachmentStorageBytes 1073741824
monky config set autoUpdate true
```

No modo interativo sem argumentos, o CLI exibe um menu navegável:

```
Qual configuração deseja alterar?
  Use ↑↓ para navegar, Enter para selecionar
❯ name
  password
  maxUsers
  allowSoundboard
  maxAttachmentFileBytes
  maxAttachmentStorageBytes
  autoUpdate
```

Depois pergunta o novo valor com o valor atual como sugestão.

#### Chaves suportadas

| Chave                        | Descrição                                            | Tipo     |
|------------------------------|------------------------------------------------------|----------|
| `name`                       | Nome do servidor (mín. 2 caracteres)                 | texto    |
| `password`                   | Senha do servidor                                    | texto    |
| `maxUsers`                   | Número máximo de usuários                            | inteiro  |
| `allowSoundboard`            | Habilitar soundboard                                 | booleano |
| `maxAttachmentFileBytes`     | Tamanho máximo por arquivo anexado (bytes)           | inteiro  |
| `maxAttachmentStorageBytes`  | Armazenamento máximo total de anexos (bytes)         | inteiro  |
| `autoUpdate`                 | Atualização automática diária via PM2                | booleano |

**Valores especiais para `password`:** `clear`, `none`, `null`, `empty` ou
`remove` removem a senha do servidor.

**Valores booleanos aceitos:** `true`/`false`, `1`/`0`, `yes`/`no`,
`sim`/`nao`, `on`/`off`.

---

### `monky update`

Atualiza o servidor Monky para a versão mais recente (estável ou beta).

#### Verificar se há atualização

```bash
# Canal estável
monky update --check

# Incluindo canal beta/pré-release
monky update --check --beta
```

Consulta a API do GitHub Releases e compara com a versão local.

#### Atualizar

```bash
# Atualizar para a última versão estável
monky update

# Atualizar para a última versão beta
monky update --beta
```

O comando:

1. Verifica a versão mais recente no GitHub (canal estável ou beta).
2. Pede confirmação.
3. Se instalado via repositório Git:
   - Executa `git pull` (ou checkout da tag beta correspondente).
   - Executa `npm install`.
   - Executa `npm run build:server` (compila apenas `@monky/shared` e o servidor, sem buildar o client gráfico).
4. Se instalado standalone (`npm install -g monky-cli-*.tgz`):
   - Atualiza o pacote global do npm baixando o tarball oficial da release.
5. Se o servidor estiver rodando via PM2, pergunta se deseja reiniciar.

#### Atualização automática

```bash
monky config set autoUpdate true
```

Habilita um processo PM2 (`monky-updater`) que roda diariamente às 4h da
manhã. Se houver nova versão, faz pull + build + restart automaticamente.

Para desabilitar:

```bash
monky config set autoUpdate false
```

---

## Fluxo completo para VPS

### 1. Preparar o servidor

```bash
git clone https://github.com/MonkyOrg/Monky.git
cd Monky
npm install
npm run build
npm install -g ./apps/server
```

### 2. Exportar identidade no app Monky

No cliente Monky, vá em **Configurações → Exportar Identidade** e copie o
código `MONKY-ID:...`.

### 3. Configurar o servidor

```bash
monky bootstrap
```

Siga as perguntas. Ao final, o CLI oferece iniciar o servidor automaticamente.

### 4. Iniciar manualmente (quando necessário)

```bash
monky start
```

### 5. Parar o servidor

```bash
monky stop
```

### 6. Administrar

```bash
monky members          # ver quem está registrado
monky admin add        # promover alguém a admin
monky roles create     # criar um novo cargo
monky roles assign     # atribuir cargo a membro
monky config set       # alterar configurações
```

---

## Exemplos rápidos

```bash
# Bootstrap completo inline
monky bootstrap --identity "MONKY-ID:1:..." --nickname Admin --port 3001

# Iniciar servidor na porta 4000 com dados em outra pasta
monky --data /var/monky start --port 4000

# Listar membros de um servidor com dados em pasta customizada
monky --data /var/monky members

# Criar cargo Moderador com cor verde e permissão de gerenciar canais
monky roles create "Moderador" "#00ff88" MANAGE_CHANNELS

# Alterar nome do servidor
monky config set name "QG da Galera"

# Remover senha do servidor
monky config set password clear
```
