# Solução de Problemas

| Sintoma | O que costuma resolver |
|---|---|
| macOS diz que o app "está danificado e não pode ser aberto" | É a quarentena do Gatekeeper (app ainda não notarizado). Rode no Terminal: `xattr -dr com.apple.quarantine /Applications/Monky.app`. Veja [Instalação](/instalacao#avisos-de-seguranca) |
| Não consigo conectar no servidor do meu amigo | Confirme IP e porta; peça para ele confirmar que o servidor está iniciado; verifique firewall e port forwarding; em CGNAT, usem VPN ou [TURN](/turn) |
| Nickname já em uso | Nicknames são únicos por servidor — escolha outro |
| Entrei, mas ninguém me ouve | Confira microfone em Configurações › Dispositivos, veja o medidor VAD, baixe a sensibilidade e confirme que o mic não está mutado |
| Ouço todo mundo cortando | Use perfil Econômico, peça o mesmo a quem transmite e prefira cabo a Wi-Fi |
| Tela compartilhada sem som | Compartilhe uma tela inteira e confira o volume do app de origem |
| Nada em Servidores na Rede | A descoberta só funciona na mesma LAN; clique em Buscar de novo e verifique UDP `41234` no firewall |
| Um participante ficou mudo só para mim | Clique com o botão direito nele e volte o volume individual para 100% |
| Só não consigo falar com **uma** pessoa específica (com o resto funciona) | Aparece um ícone vermelho `link_off` ao lado dela. Os dois provavelmente estão atrás de CGNAT e não há rota direta. Quem hospeda pode ligar o [relay TURN](/turn); a alternativa é os dois entrarem numa VPN |
| O Avast (ou outro antivírus) apita ao instalar/atualizar | Falso positivo — veja [Antivírus: Avast e similares](#antivirus-avast-e-similares) |
| O botão do **relay TURN** está esmaecido e não deixa clicar | O host não pode rodar o relay. O próprio aviso embaixo do botão diz o motivo: servidor fora do Linux, servidor numa versão anterior ao recurso (atualize o servidor), ou servidor sem privilégio para instalar o coturn (rode `sudo bash scripts/install-turn.sh` uma vez) |
| O TURN está ligado mas ninguém conecta via relay | As portas podem estar fechadas. Veja o [guia completo de portas](/turn#portas-necessarias). Rode `monky status` — deve aparecer `✔ acessível` |
| No macOS, o compartilhamento de tela pede autorização mesmo já estando liberado | A permissão ficou presa na versão anterior — veja [macOS: a permissão de tela para de valer após atualizar](#macos-a-permissao-de-tela-para-de-valer-apos-atualizar) |

## Antivírus: Avast e similares

O Monky ainda **não é assinado digitalmente**. Sem essa assinatura, antivírus
baseados em reputação — o Avast em especial — marcam o instalador, o app e o
atualizador como suspeitos. É um **falso positivo**: o código é aberto e as
releases são geradas automaticamente pelo GitHub Actions a partir deste
repositório.

### Pastas do Monky para liberar

Adicione estas três pastas às exceções do seu antivírus:

| Pasta | Para que serve |
|---|---|
| `%LOCALAPPDATA%\Programs\Monky` | O aplicativo instalado |
| `%LOCALAPPDATA%\@monkyclient-updater` | Cache de download das atualizações |
| `%APPDATA%\@monky` | Seus dados locais (identidade, preferências) |

No Avast: **Menu › Configurações › Geral › Exceções › Adicionar exceção**.

::: tip
Cole o caminho com as variáveis (`%LOCALAPPDATA%`) direto no campo — o Windows
resolve sozinho. `%APPDATA%` corresponde a `AppData\Roaming`.
:::

### O aviso de "Old uninstaller" durante a atualização

Ao atualizar, o Avast pode acusar um arquivo chamado `old-uninstaller.exe` em
`%LOCALAPPDATA%\Temp\...`. Isso é normal: o instalador **não consegue apagar um
desinstalador que está em execução**, então ele copia o desinstalador antigo
para a pasta temporária do Windows e roda a cópia de lá. Quem faz isso é o
NSIS/electron-builder, e o caminho é fixo na ferramenta — **não é possível
apontá-lo para uma pasta do Monky**.

O caminho recomendado é liberar **apenas essa detecção específica** quando ela
aparecer, em vez de liberar a pasta inteira.

::: danger Atenção
`%LOCALAPPDATA%\Temp` **não é uma pasta do Monky**. Ela é a pasta temporária
compartilhada por todo o Windows e por todos os programas da máquina. Colocá-la
inteira em exceção reduz a proteção do seu antivírus contra qualquer outro
software, e não só contra o Monky.

Não recomendamos essa exceção e ela **não é de responsabilidade do projeto**: se
optar por fazê-la, é **por sua conta e risco**.
:::

## macOS: a permissão de tela para de valer após atualizar

Você já autorizou o Monky em **Ajustes do Sistema › Privacidade e Segurança ›
Gravação de Tela**, a chave continua ligada, mas ao tentar compartilhar a tela o
app insiste que falta autorização. Desligar e ligar a chave não adianta.

O motivo: o macOS **não guarda essa permissão pelo nome do app**, e sim pela
**assinatura de código** do binário. Como o Monky ainda não é assinado com um
certificado Apple Developer ID, o sistema acaba identificando o app pelo
conteúdo do próprio binário — que muda a cada versão. Depois de atualizar, o
macOS enxerga um app com identidade nova, e a autorização concedida à versão
anterior não se aplica a ele. Como o nome e o caminho continuam idênticos, a
entrada antiga permanece listada e marcada — daí a impressão de que já está tudo
liberado.

### Como voltar a compartilhar a tela

A partir da versão `3.0.0-beta007`, o próprio Monky detecta esse estado. Ao
clicar em **Compartilhar Tela**, se o macOS estiver negando a captura, aparece um
aviso com o botão **Reabrir permissão**: ele limpa a autorização antiga e
reinicia o app, e o macOS pergunta de novo na próxima tentativa. É só conceder.

Se preferir fazer na mão (ou estiver numa versão anterior):

1. Feche o Monky por completo (inclusive o ícone na barra de menus).
2. No **Terminal**, rode:

   ```bash
   tccutil reset ScreenCapture com.monky.app
   ```

3. Abra o Monky e tente compartilhar a tela.
4. Quando o macOS pedir a autorização, conceda novamente.

Se o comando não resolver, remova a entrada na mão: **Ajustes do Sistema ›
Privacidade e Segurança › Gravação de Tela**, selecione o Monky, clique em
**−** para removê-lo, e então repita o passo 3 para que ele seja adicionado de
novo.

::: tip Correção definitiva
A solução real é assinar o app com um certificado **Apple Developer ID**, que
mantém a mesma identidade entre versões e faz a permissão sobreviver às
atualizações. Isso depende de uma conta paga do Apple Developer Program; o
projeto já está preparado para usá-la assim que estiver disponível.
:::

## Não consigo me conectar com alguém específico (CGNAT)

Se você consegue falar com a maioria das pessoas, mas **com uma pessoa
específica** a chamada não conecta (aparece ícone vermelho `link_off`), o
problema é quase certamente **CGNAT** — ambos estão atrás de NAT simétrico e
o STUN não consegue "furar" a rota.

### Opção 1: Relay TURN (recomendado se o servidor é Linux)

O administrador do servidor pode ligar o relay TURN, que faz o servidor repassar
a mídia entre os dois. É transparente: o app usa automaticamente quando precisa.

Veja o [guia completo de TURN](/turn) — inclui como abrir portas, verificar e
diagnosticar.

### Opção 2: VPN

Se o servidor não for Linux (TURN não disponível) ou o admin não puder abrir as
portas, ambos os membros podem entrar numa **VPN** (como Tailscale, ZeroTier ou
WireGuard). A VPN cria uma rede virtual que contorna o CGNAT.

### Como saber se estou atrás de CGNAT?

- Acesse [ifconfig.me](https://ifconfig.me) e compare com o IP do seu roteador (em
  `192.168.x.x` ou `10.x.x.x`). Se o IP público **não aparece** na interface
  WAN do roteador, você está atrás de CGNAT.
- Internet móvel (4G/5G) é quase sempre CGNAT.
- Provedores de fibra residencial no Brasil frequentemente usam CGNAT.
