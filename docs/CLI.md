# Monky CLI

O `monky` é a ferramenta de administração do servidor Monky para VPS, Docker
ou qualquer ambiente sem cliente gráfico. Ele abre o mesmo banco `server.db`
usado pelo servidor e agora funciona tanto com argumentos inline quanto em modo
interativo.

> Importante: para comandos administrativos (`members`, `roles`, `admin`,
> `config`), prefira usar o CLI com o servidor parado para evitar duas
> instâncias gravando o mesmo SQLite ao mesmo tempo.

## Instalação

Depois de compilar o monorepo:

```bash
npm run build
```

você pode usar de três formas:

```bash
node apps/server/dist/cli.js <comando>
```

```bash
npm run cli --workspace=apps/server -- <comando>
```

```bash
npm install -g ./apps/server
monky <comando>
```

Se preferir instalar de dentro da pasta:

```bash
cd apps/server
npm install -g .
```

Opção global:

```bash
--data <pasta>
```

Define a pasta de dados do servidor. O padrão é `./data`.

## Ajuda rápida

```text
Monky CLI - Ferramenta de administração do servidor Monky

Uso:
  monky bootstrap          Configura um novo servidor (interativo)
  monky start              Inicia o servidor
  monky stop               Para o servidor
  monky members            Lista membros
  monky members info <id>  Info detalhada de um membro
  monky admin add [user]   Concede admin (interativo se sem arg)
  monky admin remove [user] Remove admin
  monky roles              Lista cargos
  monky roles create       Cria um novo cargo (interativo)
  monky roles assign       Atribui cargo a membro (interativo)
  monky roles unassign     Remove cargo de membro (interativo)
  monky roles delete       Remove um cargo (interativo)
  monky config             Mostra configuração do servidor
  monky config set [k] [v] Altera uma configuração (interativo se sem args)
```

## Comandos

### Bootstrap interativo

O fluxo recomendado para um servidor novo:

```bash
monky bootstrap
```

Perguntas feitas pelo CLI:

1. Caminho dos dados do servidor
2. Código de identidade do dono (`MONKY-ID:...`)
3. Senha da identidade
4. Nickname do dono
5. Nome do servidor
6. Porta do servidor
7. Senha do servidor
8. Confirmação final
9. Opcionalmente iniciar o servidor

Também funciona inline:

```bash
monky bootstrap --identity "MONKY-ID:..." --nickname Owner --port 3001 --password minhasenha
```

### Iniciar o servidor

```bash
monky start --data ./data
monky start --data ./data --port 3001 --name "Servidor dos Amigos"
```

O comando:

- lê a configuração já salva no banco quando disponível;
- grava o PID em `<dataDir>/monky.pid`;
- inicia o servidor em foreground;
- trata `SIGINT`/`SIGTERM` para shutdown gracioso.

### Parar o servidor

```bash
monky stop --data ./data
```

Lê o arquivo `monky.pid`, envia `SIGTERM` e remove PID stale quando necessário.

### Membros

```bash
monky members
monky members list
monky members info lucas
monky members info abcd1234efgh5678
```

Sem subcomando, `monky members` vira `monky members list`.

### Admin

```bash
monky admin add
monky admin add lucas
monky admin remove lucas
```

Sem usuário, `admin add` mostra todos os membros numerados para escolha
interativa.

### Cargos

```bash
monky roles
monky roles list
monky roles create
monky roles assign
monky roles unassign
monky roles delete
```

Sem subcomando, `monky roles` vira `monky roles list`.

No modo interativo:

- `roles create` pergunta nome, cor e permissões;
- `roles assign` deixa escolher membro e cargo;
- `roles unassign` faz o mesmo para remoção;
- `roles delete` lista cargos e pede confirmação.

### Configuração

```bash
monky config
monky config show
monky config set
monky config set name "QG dos Amigos"
monky config set maxUsers 50
monky config set allowSoundboard false
monky config set password clear
```

Sem subcomando, `monky config` vira `monky config show`.

Chaves suportadas:

- `name`
- `password` (`clear`, `none`, `null`, `empty` ou `remove` removem a senha)
- `maxUsers`
- `allowSoundboard`
- `maxAttachmentFileBytes`
- `maxAttachmentStorageBytes`

## Fluxo recomendado para VPS

1. Exporte sua identidade no app Monky.
2. Instale o CLI globalmente:

   ```bash
   npm install -g ./apps/server
   ```

3. Faça o bootstrap:

   ```bash
   monky bootstrap --data ./data
   ```

4. Inicie o servidor:

   ```bash
   monky start --data ./data --port 3001
   ```

5. Quando precisar parar:

   ```bash
   monky stop --data ./data
   ```
