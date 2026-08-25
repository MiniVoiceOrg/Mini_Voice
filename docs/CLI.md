# Monky CLI

O `monky-cli` é a ferramenta de administração do servidor Monky para cenários
de VPS, Docker ou qualquer ambiente sem cliente gráfico. Ele abre o mesmo banco
`server.db` usado pelo servidor e executa alterações diretamente no SQLite.

> Importante: o CLI foi pensado para uso com o servidor parado. Assim você evita
> conflitos entre duas instâncias gravando o mesmo arquivo de banco.

## Como usar

Depois de compilar o monorepo:

```bash
npm run build
```

você pode executar:

```bash
node apps/server/dist/cli.js <comando>
```

ou, dentro do workspace do servidor:

```bash
npm run cli --workspace=apps/server -- <comando>
```

Opção global:

```bash
--data <pasta>
```

Define a pasta de dados do servidor. O padrão é `./data`.

## Comandos disponíveis

### Listar membros

```bash
node apps/server/dist/cli.js members list --data ./data
```

Mostra todos os membros registrados com:

- `id`
- `nickname`
- `clientId`
- cargos atribuídos

### Ver detalhes de um membro

```bash
node apps/server/dist/cli.js members info lucas --data ./data
node apps/server/dist/cli.js members info abcd1234efgh5678 --data ./data
```

Aceita nickname ou clientId e mostra os detalhes completos do usuário.

### Conceder Admin

```bash
node apps/server/dist/cli.js admin add lucas --data ./data
```

Adiciona o cargo `Admin` ao usuário informado.

### Remover Admin

```bash
node apps/server/dist/cli.js admin remove lucas --data ./data
```

Remove o cargo `Admin` do usuário informado.

### Listar cargos

```bash
node apps/server/dist/cli.js roles list --data ./data
```

Mostra todos os cargos cadastrados, permissões, posição, se são automáticos e
quantos membros possuem cada um.

### Mostrar configuração do servidor

```bash
node apps/server/dist/cli.js config show --data ./data
```

Exibe os principais campos do `server_meta`, incluindo owner, senha, limites e
soundboard.

### Alterar configuração do servidor

```bash
node apps/server/dist/cli.js config set name "QG dos Amigos" --data ./data
node apps/server/dist/cli.js config set maxUsers 50 --data ./data
node apps/server/dist/cli.js config set allowSoundboard false --data ./data
node apps/server/dist/cli.js config set password clear --data ./data
```

Chaves suportadas:

- `name`
- `password` (`clear`, `none`, `null`, `empty` ou `remove` removem a senha)
- `maxUsers`
- `allowSoundboard`
- `maxAttachmentFileBytes`
- `maxAttachmentStorageBytes`

## Bootstrap do owner inicial

Quando o servidor está em um VPS e ainda não existe owner, use:

```bash
node apps/server/dist/cli.js bootstrap --identity "MONKY-ID:..." --data ./data
```

Opcionalmente, você também pode definir um apelido inicial:

```bash
node apps/server/dist/cli.js bootstrap --identity "MONKY-ID:..." --nickname "Owner VPS" --data ./data
```

### Fluxo recomendado

1. Abra o cliente Monky em uma máquina local.
2. Exporte sua identidade pelo fluxo normal do app.
3. Copie o código `MONKY-ID:...`.
4. No VPS, execute o comando `bootstrap`.
5. Informe a senha da identidade quando o CLI solicitar.

O CLI irá:

1. Descriptografar o código exportado.
2. Derivar a chave pública e o `clientId`.
3. Criar (ou reutilizar) o usuário correspondente no banco.
4. Definir esse usuário como owner em `server_meta.owner_user_id`.
5. Garantir que o cargo `Admin` esteja atribuído a ele.

Depois disso, ao entrar no servidor com essa mesma identidade, você já terá
controle administrativo completo.
