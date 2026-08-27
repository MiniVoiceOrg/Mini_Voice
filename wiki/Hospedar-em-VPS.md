[🏠 Home](Home) · [English](en-Hospedar-em-VPS)

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

## Administração

```bash
monky members
monky admin add
monky roles create
monky config set
monky --help
```

Documentação completa: [docs/CLI.md](https://github.com/MonkyOrg/Monky/blob/main/docs/CLI.md).

## Portas usadas

| Porta | Protocolo | Para quê | Precisa liberar? |
|---|---|---|---|
| `3000` (ou escolhida) | TCP | Login, chat, canais e sinalização | Sim, no anfitrião |
| `41234` | UDP | Descoberta na rede local | Só para achar servidores na LAN |
| Altas dinâmicas | UDP | Voz, vídeo e tela P2P | Normalmente funciona via STUN |

Não há servidor TURN; em redes muito restritas, use VPN.

---
<sub>📝 Esta página é gerada a partir de [`wiki/`](https://github.com/MonkyOrg/Monky/tree/main/wiki) no repositório. Edições feitas direto na Wiki serão sobrescritas — abra um Pull Request.</sub>
