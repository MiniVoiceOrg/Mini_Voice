# Instruções para Agentes de IA

Este documento vale para agentes de IA que desenvolvem neste repositório.

**O processo de contribuição está em [`CONTRIBUTING.md`](CONTRIBUTING.md)** —
como rodar o projeto, padrões de commit, como abrir o PR e o que o Monky é e não
é. Leia aquilo primeiro: vale para todo mundo, humano ou agente.

Aqui ficam só as regras que existem **por você ser um agente**, e a seção final,
que só se aplica a quem tem acesso ao board da organização.

---

## Regras para agentes

Estas complementam o `CONTRIBUTING.md`; não o substituem.

1. **Nunca assuma.** Se a issue não estiver totalmente clara — requisitos
   ambíguos, escopo indefinido, critérios de aceite vagos, decisões de design em
   aberto — **pergunte ao desenvolvedor e espere a resposta** antes de
   implementar. Um humano hesita diante de ambiguidade; um agente tende a
   escolher uma interpretação e seguir. É a diferença que mais gera retrabalho.

2. **Não trabalhe em issue bloqueada, e não a desbloqueie.** Se você acha que
   deveria andar, peça a quem tem permissão — nunca mova por conta própria.

3. **Comente na issue ao terminar**, em PT-BR, com as duas seções que o
   `CONTRIBUTING.md` § *Descreva como testar* descreve:

   ```bash
   gh issue comment <NÚMERO_DA_ISSUE> --body "<comentário em PT-BR>"
   ```

4. **Verifique antes de afirmar.** Não diga que algo está feito, verde ou
   mergeado sem ter conferido. Estado de PR muda enquanto você trabalha:
   consulte `state` junto de `mergeable`, porque `mergeable: UNKNOWN` tanto
   significa "o GitHub ainda está calculando" quanto "já foi fechado".

5. **Documentação apodrece em silêncio.** Link, âncora, caminho de menu e nome
   de arquivo não dão erro quando ficam errados — apenas passam a apontar para o
   lugar errado. Ao mexer em documentação, confira o que você citou: âncoras
   contra o render real, caminhos de menu contra a interface, nomes de arquivo
   contra o que existe.

6. **Não invente trailer de co-autoria.** Atribua o commit a quem de fato
   escreveu.

---

## Fluxo do board

> ⚠️ **Esta seção só se aplica a quem tem acesso ao board da organização.**
> O board é privado. Se você está contribuindo de fora, ele não é visível nem
> necessário — siga o [`CONTRIBUTING.md`](CONTRIBUTING.md) e ignore o que vem
> abaixo.

O board fica em https://github.com/orgs/MonkyOrg/projects/1

Nem toda issue está no board: a entrada é filtrada por label, e bug começa em
Discussions e só vira issue depois de confirmado. Se a issue em que você vai
trabalhar não tem card, não crie um — pergunte ao desenvolvedor.

Quando houver card:

1. **Antes de codar**, mova para **In progress**.
2. **Ao terminar**, siga o fluxo de PR do `CONTRIBUTING.md`.
3. **Depois do merge, aguarde a release.** O push na `main` dispara o workflow
   **Release**, que publica os artefatos Win/Mac. Só mova para **QA** depois que
   a release estiver publicada — o QA valida a partir do build publicado, nunca
   apenas do merge.
4. **Nunca mova para Done por conta própria.** Depois do QA, o desenvolvedor
   decide.

> Resumo: (esclarecer dúvidas) → `In progress` → PR → (release publicada) →
> `QA` → (após QA) `Done`.

### Referência do board

- Project ID: `PVT_kwDOEws3wM4BhD7I`
- Campo Status (field ID): `PVTSSF_lADOEws3wM4BhD7IzhgBIGI`
- Opções de Status (single-select-option-id):

  | Coluna | ID |
  |---|---|
  | Discussing | `146d7ce6` |
  | Backlog | `f75ad846` |
  | Blocked | `7a1e61fe` |
  | In progress | `47fc9ee4` |
  | QA | `df73e18b` |
  | After QA Review | `98330754` |
  | Done | `98236657` |
  | Ideias descartadas | `6eeb0bfb` |

Estes IDs saem da API, e o board muda sem avisar — uma coluna `Ready` ficou
documentada aqui depois de ter sido removida. Confira antes de confiar:

```bash
gh api graphql -f query='
{ organization(login: "MonkyOrg") { projectV2(number: 1) {
    field(name: "Status") { ... on ProjectV2SingleSelectField { options { id name } } } } } }'
```

### Mover um card

```bash
gh project item-list 1 --owner MonkyOrg --format json   # descobre o <ITEM_ID>

gh project item-edit \
  --id <ITEM_ID> \
  --project-id PVT_kwDOEws3wM4BhD7I \
  --field-id PVTSSF_lADOEws3wM4BhD7IzhgBIGI \
  --single-select-option-id <OPTION_ID>
```

O `<ITEM_ID>` é o ID do item no projeto, não o número da issue. Requer token com
escopo `project` (`gh auth refresh -s project`).

> A configuração dos workflows automáticos do board (auto-add, item fechado)
> **não é exposta pela API** — é só interface. Se algo precisa mudar ali, peça ao
> desenvolvedor.
