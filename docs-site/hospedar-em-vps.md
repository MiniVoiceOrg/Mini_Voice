# Hospedar em VPS

Para manter o servidor no ar 24/7, rode só o servidor em uma máquina Linux —
sem interface gráfica e sem clonar o repositório. Todo o trabalho é feito pelo
**Monky CLI**, que é distribuído pronto em cada release.

Requer **Node.js 22 ou superior** (exigência do mediasoup; a CI também usa 22).

## Passo a passo

```bash
# 1. Instale o CLI a partir da release
#    O comando pronto, já com a versão mais recente, está na página de download:
#    https://monkyorg.github.io/Monky/download
npm install -g --allow-scripts=mediasoup https://github.com/MonkyOrg/Monky/releases/download/vX.Y.Z/monky-cli-X.Y.Z.tgz

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
| `40000-49151` | UDP e TCP | Mídia WebRTC no Modo SFU (mediasoup) | Só com o modo SFU ativado |
| `3478` | TCP e UDP | Relay TURN, se você ligar | Só com o relay ligado |
| `49152-65535` | UDP | Mídia repassada pelo relay | Só com o relay ligado |

Quando dois membros estão atrás de CGNAT, eles podem não conseguir se conectar
diretamente. O Monky traz um **relay TURN opcional** (desligado por padrão) que
repassa a mídia desse par pelo servidor — veja
[Relay de mídia (TURN)](/turn). Sem ele, a saída para redes
muito restritas continua sendo uma VPN.

### Abrindo as portas do Modo SFU

No Modo SFU a mídia não vai mais direto entre as pessoas: ela entra no servidor
por esse range. Como é tráfego UDP que chega sem ninguém ter pedido antes, a
regra de `RELATED,ESTABLISHED` que a maioria das distribuições traz **não
cobre** — o range precisa ser aberto explicitamente, e o mesmo vale para TCP,
que é o caminho de quem está numa rede que bloqueia UDP.

```bash
# Abrir o range da mídia SFU
sudo iptables -I INPUT -p udp --dport 40000:49151 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 40000:49151 -j ACCEPT

# Persistir (sobrevive a reboot)
sudo netfilter-persistent save
```

::: tip Se usar `ufw` em vez de `iptables`
```bash
sudo ufw allow 40000:49151/udp
sudo ufw allow 40000:49151/tcp
```
:::

::: warning O firewall do provedor é outro
Oracle Cloud, AWS, Azure, GCP e Hetzner têm um firewall fora da máquina, que o
`iptables` não alcança. O range precisa ser liberado também no painel web, do
mesmo jeito descrito em [Relay de mídia (TURN)](/turn#abrindo-portas-no-linux) —
lá os exemplos são das portas do relay, mas o caminho no painel é o mesmo.
:::

Para conferir se está valendo, entre num canal de voz e veja se a mídia chega:

```bash
sudo tcpdump -n -i any udp portrange 40000-49151 -c 20
```

Pacotes `In` de fora da máquina significam que o range está aberto. Só tráfego
`Out`, ou nada, quer dizer que algo antes está barrando — repare se existe uma
regra `REJECT` na cadeia `INPUT` acima das que você acabou de inserir
(`sudo iptables -L INPUT -n -v --line-numbers` mostra a ordem).

## Manutenção

```bash
monky logs --level WARN         # o que precisa de atenção
monky config set port 3010      # muda a porta e oferece reiniciar
monky update --check            # há versão nova?
monky config set autoUpdate true  # atualiza sozinho, diariamente às 4h
```

### Atualizar a versão do Node

O PM2 é um daemon de vida longa e continua usando o Node com que foi iniciado.
Trocar a versão do Node — principalmente saindo do apt para o `nvm` — pode
deixar o servidor num estado em que o `pm2 status` diz `online`, mas nada
escuta na porta.

Depois de mexer no Node, rode sempre:

```bash
monky update     # recompila os módulos nativos para o novo ABI
monky restart    # refixa o interpretador usado pelo PM2
pm2 save         # grava o estado bom no dump do PM2
```

Se mesmo assim o servidor não voltar, `monky restart --fresh` recria o registro
do processo no PM2. Os detalhes e o diagnóstico estão em
[Trocar a versão do Node](/cli#trocar-a-versao-do-node).

::: tip Mais de um servidor na mesma VPS
Basta rodar `monky create` de novo com outra pasta e outra porta. O CLI passa a
perguntar a qual servidor cada comando se refere — ou você informa direto com
`--data`. Veja [Múltiplos servidores](/cli#multiplos-servidores).
:::
