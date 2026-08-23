# Instruções para Agentes de IA

Este documento define o fluxo de trabalho obrigatório para agentes de IA que
desenvolvem neste repositório a partir do board do GitHub.

## Fluxo de trabalho a partir do board

O board fica em: https://github.com/orgs/MiniVoiceOrg/projects/1

Sempre que iniciar um desenvolvimento a partir de uma issue/card do board, siga
exatamente estas etapas, nesta ordem:

1. **Antes de começar a codar**: mova o card para **In progress**.
   - **Nunca desenvolva cards que estejam na coluna `Blocked`.** Cards
     bloqueados não devem ser trabalhados enquanto estiverem nessa coluna. Se o
     desenvolvedor quiser que algo em `Blocked` seja desenvolvido, **solicite
     que ele (ou alguém com permissão) mova o card para fora de `Blocked`**
     (ex.: `Ready`/`In progress`) antes de qualquer implementação. Não mova o
     card para fora de `Blocked` por conta própria — peça a autorização/ação de
     quem tem permissão.
2. **Entenda a issue por completo antes de codar.** Se a issue **não estiver
   totalmente clara** (requisitos ambíguos, escopo indefinido, critérios de
   aceite vagos, decisões de design em aberto), **tire dúvidas com o
   desenvolvedor** antes de prosseguir. **Nunca assuma nada** — pergunte e só
   comece a implementar depois de esclarecer.
3. **Desenvolva** a solução completa da issue.
4. **Ao terminar**: abra um Pull Request para o branch padrão (`main`).
   - O `main` é protegido; todo merge deve passar por PR.
   - Faça o merge com squash e delete do branch após aprovação.
5. **Comente na issue/card do board (em PT-BR)** descrevendo:
   - **Como foi implementado**: resumo técnico da solução (arquivos/áreas
     alteradas, decisões relevantes).
   - **Como testar**: passo a passo claro para o QA validar (cenários,
     resultados esperados e casos de borda).
   - Objetivo: facilitar o trabalho do QA.
6. **Após o merge, aguarde a release ser gerada.** O push na `main` dispara
   automaticamente o workflow **Release** (GitHub Actions), que calcula a versão
   SemVer (`v<MAJOR>.<MINOR>.<PATCH>`) baseada nas convenções de commit, builda e publica
   uma nova release com os artefatos Win/Mac:
   - **Patch** (ex: `1.0.X`): correções de bugs (`fix:`, `fix(...)`, `bugfix:`, etc.).
   - **Minor** (ex: `1.X.0`): novas funcionalidades (`feat:`, `feat(...)`, `feature:`).
   - **Major** (ex: `X.0.0`): mudanças com breaking changes / refatoração arquitetural (`BREAKING CHANGE:`, `feat!:`, `major:`).
   **Só mova o card para `QA` depois que a release estiver publicada** (run do
   workflow concluída com sucesso), pois o QA valida a partir do build publicado
   — nunca apenas após o merge.
7. **Não mova para Done automaticamente.** Após o QA ser concluído, o
   desenvolvedor pode pedir ao agente para mover para **Done** ou fazer isso
   manualmente.

> Resumo: (esclarecer dúvidas se necessário) → `In progress` → (PR para `main`)
> → (comentário PT-BR: como foi feito + como testar) → (release publicada
> automaticamente) → `QA` → (após QA) `Done`.

### Comando para comentar na issue

```bash
gh issue comment <NÚMERO_DA_ISSUE> --body "<comentário em PT-BR>"
```

O comentário deve conter, no mínimo, uma seção **"Como foi implementado"** e uma
seção **"Como testar"**.

## Referência do board (org `MiniVoiceOrg`, projeto #1)

- Project ID: `PVT_kwDOEws3wM4BhD7I`
- Campo Status (field ID): `PVTSSF_lADOEws3wM4BhD7IzhgBIGI`
- Opções de Status (single-select-option-id):
  - Backlog: `f75ad846`
  - Blocked: `7a1e61fe`
  - Ready: `61e4505c`
  - In progress: `47fc9ee4`
  - QA: `df73e18b`
  - Done: `98236657`

### Comando para mover um card

```bash
gh project item-edit \
  --id <ITEM_ID> \
  --project-id PVT_kwDOEws3wM4BhD7I \
  --field-id PVTSSF_lADOEws3wM4BhD7IzhgBIGI \
  --single-select-option-id <OPTION_ID>
```

O `<ITEM_ID>` é o ID do item do projeto (não o número da issue). Liste os itens
e seus IDs com:

```bash
gh project item-list 1 --owner MiniVoiceOrg --format json
```

## Fluxo de PR (branch protegido)

```bash
export GIT_SSH_COMMAND='ssh -o BatchMode=yes'
git checkout -b <branch>
# ... commits ...
git push -u origin <branch>
gh pr create --title "<título>" --body "<descrição>"
gh pr merge <branch> --squash --delete-branch
git checkout main && git pull
```

Inclua sempre o trailer de co-autoria nos commits:

```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```
