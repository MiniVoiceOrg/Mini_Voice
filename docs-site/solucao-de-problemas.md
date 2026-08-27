# Solução de Problemas

| Sintoma | O que costuma resolver |
|---|---|
| macOS diz que o app "está danificado e não pode ser aberto" | É a quarentena do Gatekeeper (app ainda não notarizado). Rode no Terminal: `xattr -dr com.apple.quarantine /Applications/Monky.app`. Veja [Instalação](/instalacao#avisos-de-seguranca) |
| Não consigo conectar no servidor do meu amigo | Confirme IP e porta; peça para ele confirmar que o servidor está iniciado; verifique firewall e port forwarding; em CGNAT, usem VPN |
| Nickname já em uso | Nicknames são únicos por servidor — escolha outro |
| Entrei, mas ninguém me ouve | Confira microfone em Configurações › Dispositivos, veja o medidor VAD, baixe a sensibilidade e confirme que o mic não está mutado |
| Ouço todo mundo cortando | Use perfil Econômico, peça o mesmo a quem transmite e prefira cabo a Wi-Fi |
| Tela compartilhada sem som | Compartilhe uma tela inteira e confira o volume do app de origem |
| Nada em Servidores na Rede | A descoberta só funciona na mesma LAN; clique em Buscar de novo e verifique UDP `41234` no firewall |
| Um participante ficou mudo só para mim | Clique com o botão direito nele e volte o volume individual para 100% |
| O Avast (ou outro antivírus) apita ao instalar/atualizar | Falso positivo — veja [Antivírus: Avast e similares](#antivirus-avast-e-similares) |

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
