# Hospedar em VPS

Para manter o servidor no ar 24/7, rode só o servidor em uma máquina Linux —
sem interface gráfica e sem clonar o repositório. Todo o trabalho é feito pelo
**Monky CLI**, que é distribuído pronto em cada release.

Requer **Node.js 20 ou superior** (a CI usa 22).

## Passo a passo

```bash
# 1. Instale o CLI a partir da release
#    O comando pronto, já com a versão mais recente, está na página de download:
#    https://monkyorg.github.io/Monky/download
npm install -g https://github.com/MonkyOrg/Monky/releases/download/<versão>/monky-cli-<versão>.tgz

# 2. Crie o servidor (interativo)
monky create

# 3. Confira se subiu
monky status
```

O `monky create` pergunta onde guardar os dados, pede o código de identidade do
dono e oferece iniciar o servidor ao final. Numa VPS, prefira um caminho fora do
seu diretório pessoal, como `/srv/monky`.

O servidor roda como daemon do PM2 e volta sozinho depois de um reboot. A
referência completa dos comandos está em [Monky CLI](/cli).

## Portas usadas

| Porta | Protocolo | Para quê | Precisa liberar? |
|---|---|---|---|
| `3000` (ou escolhida) | TCP | Login, chat, canais e sinalização | Sim, no firewall da VPS |
| `41234` | UDP | Descoberta na rede local | Não, numa VPS |
| Altas dinâmicas | UDP | Voz, vídeo e tela P2P | Normalmente funciona via STUN |

Não há servidor TURN; em redes muito restritas, use VPN.

## Manutenção

```bash
monky logs --level WARN         # o que precisa de atenção
monky config set port 3010      # muda a porta e oferece reiniciar
monky update --check            # há versão nova?
monky config set autoUpdate true  # atualiza sozinho, diariamente às 4h
```

::: tip Mais de um servidor na mesma VPS
Basta rodar `monky create` de novo com outra pasta e outra porta. O CLI passa a
perguntar a qual servidor cada comando se refere — ou você informa direto com
`--data`. Veja [Múltiplos servidores](/cli#multiplos-servidores).
:::
