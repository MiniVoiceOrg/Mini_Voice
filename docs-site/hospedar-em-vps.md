# Hospedar em VPS

Para manter o servidor no ar 24/7, rode só o servidor em uma máquina Linux. Requer **Node.js 20 ou superior** (a CI usa 22).

Instale o **Monky CLI** pela release:

```bash
npm install -g https://github.com/MonkyOrg/Monky/releases/download/v2.3.0/monky-cli-2.3.0.tgz
```

Troque `v2.3.0` pela versão desejada.

## Configuração inicial

O CLI é interativo:

```bash
monky bootstrap
```

Ele pergunta código de identidade, senha, nickname, nome do servidor, porta e senha do servidor. Ao final, oferece iniciar automaticamente.

## Iniciar e parar

```bash
monky start
monky stop
monky restart
monky status
monky logs
```

## Ver os logs

```bash
monky logs                      # segue os logs em tempo real (Ctrl+C para sair)
monky logs --lines 500          # começa exibindo as últimas 500 linhas
monky logs --level WARN         # só avisos e erros
monky logs --level ERROR --no-follow   # imprime os erros recentes e sai
```

`--level` filtra por nível mínimo: `INFO` mostra tudo, `WARN` mostra avisos e
erros, `ERROR` mostra só erros. Linhas de continuação (como stack traces)
acompanham o nível da linha acima delas.

::: tip
`monky logs` lê os logs do servidor iniciado com `monky start`, que roda via
PM2. Se o servidor estiver rodando dentro do app Monky, use o **Monitor do
Servidor** no próprio app (menu do servidor → Monitor do Servidor).
:::

## Administração

```bash
monky members
monky admin add
monky roles create
monky config set
monky --help
```

Documentação completa: [Monky CLI](/cli).

## Portas usadas

| Porta | Protocolo | Para quê | Precisa liberar? |
|---|---|---|---|
| `3000` (ou escolhida) | TCP | Login, chat, canais e sinalização | Sim, no anfitrião |
| `41234` | UDP | Descoberta na rede local | Só para achar servidores na LAN |
| Altas dinâmicas | UDP | Voz, vídeo e tela P2P | Normalmente funciona via STUN |

Não há servidor TURN; em redes muito restritas, use VPN.
