# Instalação

Baixe a versão para o seu sistema na [página de download](/download) — os botões apontam direto para o arquivo certo da última release.

| Sistema | Arquivo | Observação |
|---|---|---|
| Windows 10/11 (x64) | `Monky-<versão>-win-x64-setup.exe` | Instalador — permite escolher a pasta |
| Windows 10/11 (x64) | `Monky-<versão>-win-x64-portable.exe` | Não instala nada, é só executar |
| macOS (Intel / Apple Silicon) | `Monky-<versão>-mac-<arch>.dmg` | Escolha `x64` (Intel) ou `arm64` (M1/M2/M3+) |

## Avisos de segurança

Windows e macOS podem mostrar aviso porque os executáveis ainda não têm assinatura digital paga.

- **Windows**: clique em *Mais informações › Executar assim mesmo*.
- **macOS**: clique com o botão direito no app e escolha *Abrir*.

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

Para verificar checksums e assinatura da release, veja [Verificar Releases](/verificar-releases).
