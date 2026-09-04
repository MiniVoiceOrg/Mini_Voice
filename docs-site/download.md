---
title: Download
---

# Download

Os botões abaixo apontam direto para os arquivos da última release — não é preciso procurar nada no GitHub.

<DownloadPanel lang="pt" />

## Qual arquivo escolher

| Sistema | Arquivo | Observação |
|---|---|---|
| Windows 10/11 (x64) | `Monky-<versão>-win-x64-setup.exe` | Instalador — permite escolher a pasta |
| Windows 10/11 (x64) | `Monky-<versão>-win-x64-portable.exe` | Não instala nada, é só executar |
| macOS (Intel / Apple Silicon) | `Monky-<versão>-mac-<arch>.dmg` | Escolha `x64` (Intel) ou `arm64` (M1/M2/M3+) |

## Depois de baixar

Windows e macOS podem exibir um aviso ao abrir o Monky pela primeira vez, porque os executáveis ainda não têm assinatura digital paga. Não é sinal de arquivo corrompido.

- **Windows**: clique em _Mais informações › Executar assim mesmo_.
- **macOS**: clique com o botão direito no app e escolha _Abrir_.

### macOS: "O aplicativo está danificado e não pode ser aberto"

No macOS (principalmente em Apple Silicon), o Gatekeeper pode bloquear o app com a mensagem **"está danificado e não pode ser aberto"**. O arquivo **não** está corrompido — é só a quarentena de segurança, porque o app ainda não é notarizado pela Apple.

Depois de mover o **Monky.app** para a pasta *Aplicativos*, abra o Terminal e rode:

```bash
xattr -dr com.apple.quarantine /Applications/Monky.app
```

Depois é só abrir o app normalmente. Se ainda reclamar, force uma reassinatura local (ad-hoc):

```bash
sudo xattr -cr /Applications/Monky.app
codesign --force --deep --sign - /Applications/Monky.app
```

## Atualizações

O app avisa quando sai uma versão nova. Você também pode conferir em **Configurações › Sobre e Atualizações › Verificar atualizações**.

No Windows a atualização é aplicada sozinha: o Monky baixa, instala e reabre.

No macOS o sistema não permite substituir um aplicativo que está em uso, então o Monky baixa o `.dmg`, abre a janela de instalação e **se fecha sozinho** logo em seguida. Arraste o Monky para a pasta *Aplicativos*, confirme a substituição e abra o app de novo.

Para conferir se o arquivo baixado é mesmo o que publicamos, veja [Verificar Releases](/verificar-releases) — toda release traz checksums SHA-256 e assinatura Cosign.

## Sobre o canal beta

As betas saem antes da versão estável e servem para testar o que está por vir. Elas passam pelo mesmo processo de build e assinatura, mas podem conter problemas que ainda não apareceram. Se você só quer usar o Monky, fique na estável.

Dá para receber betas pelo próprio app, sem baixar nada à mão, em **Configurações › Sobre e Atualizações**.

## Sobre o CLI

O CLI serve para hospedar um servidor sem interface gráfica, como em uma VPS. A referência completa dos comandos está em [Monky CLI](/cli), e o guia de hospedagem em [Hospedar em VPS](/hospedar-em-vps).
