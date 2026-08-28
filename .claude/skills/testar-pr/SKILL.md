---
name: testar-pr
description: Prepara a máquina para testar um PR do Monky ao vivo — lê o contexto do PR, faz checkout da branch, builda e sobe o app, e entrega um roteiro de teste derivado do que o PR mudou. Use quando pedirem para testar, validar ou revisar um PR rodando o aplicativo, ou quando alguém disser "testa o PR X".
---

# Testar um PR ao vivo

Tira o testador do trabalho manual de descobrir o que o PR faz, achar a branch,
buildar e adivinhar o que clicar. O objetivo é chegar rápido ao app aberto **e**
saber o que olhar dentro dele.

## 1. Não perca o trabalho de quem está na máquina

Antes de qualquer checkout:

```bash
git status --porcelain
git branch --show-current
```

Se houver mudanças não commitadas, **pare e pergunte** antes de mexer.
Não faça `stash` por conta própria — quem está testando pode estar no meio de
outra coisa. Guarde a branch atual: ela é para onde a máquina volta no fim.

## 2. Leia o PR antes de rodar

```bash
gh pr view <NUM> --json title,body,state,isDraft,mergeable,headRefName,files,additions,deletions
gh pr diff <NUM> --name-only
```

Do que sai daí, tire três coisas:

- **O que mudou de comportamento** — o corpo do PR costuma ter "Como testar";
  se tiver, ele manda mais do que a sua leitura do diff.
- **Que parte do app foi tocada** — use os caminhos para saber onde clicar:
  `apps/client/src/renderer/views/` é tela, `apps/server/` é servidor,
  `packages/shared/` costuma ser contrato entre os dois.
- **A issue ligada** — `Closes #N` no corpo. Leia a issue com
  `gh issue view <N>`: o relato original quase sempre descreve o cenário de
  teste melhor que o PR.

Se o PR estiver fechado, em rascunho ou com conflito, **diga isso antes de
buildar** — não faça o testador descobrir depois de cinco minutos de build.

## 3. Traga a branch

```bash
gh pr checkout <NUM>
```

Se `package-lock.json` estiver entre os arquivos alterados, rode `npm install`.
Se não estiver, pule — o build é longo o bastante sem isso.

## 4. Suba o app

```bash
npm run build
npm start
```

`npm run build` compila `packages/shared`, `apps/server` e `apps/client`, nessa
ordem. Se falhar, **mostre o erro e pare**: um PR que não builda é um resultado
de teste, não um obstáculo a contornar.

Para um ciclo mais curto, quando o PR só mexe no renderer, dois terminais:

```bash
npm run dev:server   # servidor WebSocket + SQLite
npm run dev:client   # Electron com rebuild automático
```

## 5. Monte o roteiro de teste

Entregue um roteiro curto e **específico deste PR**, não um checklist genérico.
Saia da leitura do passo 2 com:

1. **O caminho até a tela mexida** — em cliques, não em nomes de arquivo.
   "Configurações › Sobre e Updates › Comunidade", não "AboutTab.ts".
2. **O que deve acontecer** depois da mudança.
3. **O que acontecia antes**, quando o PR corrige um bug — é a única forma de o
   testador saber que testou a coisa certa.
4. **Uma borda que valha a pena** — o caso que o PR provavelmente não cobriu.

## Detalhes do Monky que mudam o teste

**Cliente e servidor precisam ser da mesma branch.** `PROTOCOL_VERSION` é
comparado por igualdade exata (`packages/shared/src/validators.ts`): se o PR
mexeu no protocolo, o app da branch não conecta num servidor de outra versão.
Crie o servidor pelo próprio app (*Meus Servidores*), não reaproveite um
servidor que já estava no ar.

**Só abre uma instância por máquina.** Existe `requestSingleInstanceLock`: a
segunda chamada de `npm start` apenas foca a janela já aberta. Para testar duas
pessoas na mesma call, são duas máquinas — ou uma segunda instância com
`--user-data-dir` apontando para outra pasta.

**Voz, vídeo e tela são P2P.** Não dá para validar de verdade sozinho: peça uma
segunda pessoa quando o PR mexer em `WebRtcManager`, `VideoService` ou
sinalização.

**Servidor de teste é descartável.** O CLI guarda o registro de servidores em
`MONKY_HOME`; aponte para uma pasta temporária se o teste for mexer nisso, para
não sujar os servidores reais de quem está testando.

## 6. Devolva a máquina como estava

Ao terminar, ofereça voltar para a branch anotada no passo 1:

```bash
git checkout <branch-anotada>
```

E diga se ficou build de outra branch em `dist/` — na dúvida, `npm run build`
resolve.
