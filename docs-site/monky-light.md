# Monky Light

::: warning Em desenvolvimento
O Monky Light ainda **não tem download**. Esta página descreve o que ele será e para quem serve.
Acompanhe em [#119](https://github.com/MonkyOrg/Monky/issues/119).
:::

**Monky Light** é um cliente separado, escrito em C++ nativo, que faz **só duas coisas: canal de voz e canal de texto.**

Ele existe para dois tipos de usuário:

- Quem tem uma **máquina fraca** e não consegue rodar o app completo com folga.
- Quem tem uma **máquina forte e não quer dividir nada** — o PC é para o jogo ou para o trabalho, e o app de voz tem que ocupar o canto mais apagado possível.

## Máxima performance: Monky Light + Monky CLI

Se o seu objetivo é performance e velocidade ao máximo, a combinação é esta:

| Papel | Use |
|---|---|
| **Quem hospeda** | [Monky CLI](/cli) — servidor sem interface gráfica, de preferência num [VPS](/hospedar-em-vps) |
| **Quem conversa** | **Monky Light** — cliente nativo, só voz e texto |

O CLI tira a interface gráfica do lado do servidor; o Light tira o navegador embutido do lado do cliente. Sobra o mínimo: um processo de rede e um de áudio, dos dois lados.

## O que entra

- Conectar a um servidor Monky por IP e porta, ou por link de convite.
- Entrar e sair de canais de voz, falar e ouvir.
- Silenciar microfone, ensurdecer, ajustar volume por participante.
- Detecção de fala (VAD) e push-to-talk.
- Canais de texto: ler histórico e enviar mensagens.
- Lista de participantes com indicador de quem está falando.
- Bandeja do sistema e atalhos globais.

## O que não entra

Vídeo, compartilhamento de tela, soundboard, anexos, avatares, criação e administração de canais e cargos, e **hospedar servidor**.

Nada disso some do Monky — some **do Light**. Os dois clientes falam o mesmo protocolo e convivem no mesmo canal de voz: dá para você estar no Light enquanto seus amigos estão no app completo, compartilhando tela entre eles.

Para qualquer coisa fora dessa lista, use o [Monky](/instalacao) completo.

## Por que não é o app completo "em modo econômico"

O app completo é Electron: ele carrega um Chromium inteiro para desenhar a interface. Mesmo parado num canal de voz, isso custa vários processos e centenas de MB de RAM. Não existe configuração que desligue esse custo — ele é a fundação.

O Light não tem navegador nenhum. A interface é desenhada com os controles nativos do sistema, o áudio é processado em C++, e o programa fica **totalmente ocioso** quando ninguém fala: sem uso de GPU, sem redesenho de tela, sem thread acordando à toa.

## Perguntas frequentes

**Vou precisar de um servidor diferente?**
Não. É o mesmo servidor Monky, mesma senha, mesma identidade, mesmos canais.

**Posso hospedar pelo Light?**
Não. Quem hospeda usa o app completo ou o [Monky CLI](/cli).

**O Light substitui o Monky?**
Não. São dois clientes para dois usos. O Monky continua sendo o app principal.
