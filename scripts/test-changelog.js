import { classifyGroup, stripType, extractEntries, buildChangelog } from './generate-changelog.js';

console.log('=== Início dos Testes do Changelog (#547) ===');

// console.assert nao muda o exit code no Node: sem este contador o script
// terminaria com sucesso mesmo com asserções quebradas e o CI nao veria nada.
let failures = 0;
const nativeAssert = console.assert.bind(console);
console.assert = (condition, ...args) => {
  if (!condition) failures += 1;
  nativeAssert(condition, ...args);
};

// 1. classifyGroup: a seção sai do tipo do assunto (subject) do commit.
console.assert(classifyGroup('feat: soundboard novo (#10)') === 'novidades', 'feat -> novidades');
console.assert(classifyGroup('feature: algo (#10)') === 'novidades', 'feature -> novidades');
console.assert(classifyGroup('minor: algo') === 'novidades', 'minor -> novidades');
console.assert(classifyGroup('feat(voz): push to talk') === 'novidades', 'feat(scope) -> novidades');
console.assert(classifyGroup('feat!: quebra protocolo') === 'novidades', 'feat! -> novidades');
console.assert(classifyGroup('fix: corrige audio (#11)') === 'correcoes', 'fix -> correcoes');
console.assert(classifyGroup('bugfix: corrige crash') === 'correcoes', 'bugfix -> correcoes');
console.assert(classifyGroup('fix(ui): ajuste (#12)') === 'correcoes', 'fix(scope) -> correcoes');
console.assert(classifyGroup('refactor: limpa modulo') === 'outros', 'refactor -> outros');
console.assert(classifyGroup('chore: bump deps') === 'outros', 'chore -> outros');
console.assert(classifyGroup('mensagem sem tipo') === 'outros', 'sem tipo -> outros');
console.log('✔ classifyGroup agrupou por tipo de commit');

// 2. stripType: remove o prefixo de tipo, preserva o resto (inclui "(#NNN)").
console.assert(stripType('feat: changelog no client (#547)') === 'changelog no client (#547)', 'remove feat:');
console.assert(stripType('fix(ui): ajuste do modal') === 'ajuste do modal', 'remove fix(scope):');
console.assert(stripType('* fix: bullet de squash') === 'bullet de squash', 'remove bullet + tipo');
console.assert(stripType('texto puro') === 'texto puro', 'sem tipo fica igual');
console.log('✔ stripType removeu o prefixo de tipo');

// 3. extractEntries: prioriza linhas "#NNN:" curadas do corpo.
const commitComIssue = [
  'feat: changelog no client (#547)',
  '',
  '#547: changelog amigavel agrupado e exibicao apos atualizar',
  '',
  'Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>',
].join('\n');
console.assert(
  JSON.stringify(extractEntries(commitComIssue)) ===
    JSON.stringify(['#547: changelog amigavel agrupado e exibicao apos atualizar']),
  'extrai a linha #NNN e ignora Co-authored-by'
);

// Linhas de continuacao (quebra de linha) sao dobradas de volta na mesma entrada.
const commitWrap = [
  'fix: reconexao (#44)',
  '',
  '#44: reconecta imediatamente quando a rede volta em vez',
  'de esperar o proximo heartbeat',
].join('\n');
console.assert(
  JSON.stringify(extractEntries(commitWrap)) ===
    JSON.stringify(['#44: reconecta imediatamente quando a rede volta em vez de esperar o proximo heartbeat']),
  'linhas de continuacao viram uma unica entrada'
);

// Varias linhas #NNN num mesmo commit viram varias entradas.
const commitMulti = [
  'feat: pacote (#1)',
  '',
  '#1: primeira coisa',
  '#2: segunda coisa',
].join('\n');
console.assert(
  JSON.stringify(extractEntries(commitMulti)) === JSON.stringify(['#1: primeira coisa', '#2: segunda coisa']),
  'multiplas linhas #NNN viram multiplas entradas'
);

// Sem linhas #NNN: cai para bullets do corpo (ignorando bullets de squash).
const commitBullets = [
  'chore: limpeza',
  '',
  '- remove codigo morto',
  '* fix: nao deve aparecer como bullet',
  '- ajusta script',
].join('\n');
console.assert(
  JSON.stringify(extractEntries(commitBullets)) === JSON.stringify(['remove codigo morto', 'ajusta script']),
  'fallback para bullets, ignorando bullets de squash tipados'
);

// Sem corpo util: cai para o assunto sem o tipo.
console.assert(
  JSON.stringify(extractEntries('feat: novidade solta (#9)')) === JSON.stringify(['novidade solta (#9)']),
  'fallback para o assunto sem o tipo'
);
console.log('✔ extractEntries priorizou #NNN, dobrou continuacao e fez fallback');

// 4. buildChangelog: agrupa, deduplica e anexa o link de comparacao.
const commits = [
  ['feat: changelog no client (#547)', '', '#547: exibe changelog apos atualizar'].join('\n'),
  ['fix: soundbar (#543)', '', '#543: corrige barra de progresso ao trocar de audio'].join('\n'),
  ['refactor: organiza updater', '', '#500: separa fetch das notas'].join('\n'),
];
const notes = buildChangelog(commits, { repo: 'MonkyOrg/Monky', version: '8.3.0-beta', prevTag: 'v8.2.8-beta' });

console.assert(notes.includes('#### ✨ Novidades'), 'tem secao Novidades');
console.assert(notes.includes('#### 🐛 Correções'), 'tem secao Correções');
console.assert(notes.includes('#### 🔧 Outros'), 'tem secao Outros');
console.assert(notes.includes('- #547: exibe changelog apos atualizar'), 'entrada de novidade presente');
console.assert(notes.includes('- #543: corrige barra de progresso ao trocar de audio'), 'entrada de correcao presente');
console.assert(notes.includes('- #500: separa fetch das notas'), 'entrada de outros presente');
console.assert(
  notes.includes('**Comparação completa**: https://github.com/MonkyOrg/Monky/compare/v8.2.8-beta...v8.3.0-beta'),
  'link de comparacao correto'
);
// Ordem das secoes: Novidades antes de Correções antes de Outros.
console.assert(
  notes.indexOf('Novidades') < notes.indexOf('Correções') &&
    notes.indexOf('Correções') < notes.indexOf('Outros'),
  'secoes na ordem Novidades > Correções > Outros'
);

// Secao vazia nao aparece.
const soFeat = buildChangelog([['feat: algo (#1)', '', '#1: coisa nova'].join('\n')], {});
console.assert(soFeat.includes('Novidades') && !soFeat.includes('Correções') && !soFeat.includes('Outros'), 'omite secoes vazias');

// Deduplicacao: a mesma linha vinda de dois commits aparece uma vez.
const dup = buildChangelog(
  [
    ['fix: a (#1)', '', '#1: mesma correcao'].join('\n'),
    ['fix: b (#1)', '', '#1: mesma correcao'].join('\n'),
  ],
  {}
);
console.assert((dup.match(/#1: mesma correcao/g) || []).length === 1, 'linhas duplicadas sao unificadas');

// Sem link quando faltam metadados; sem commits, usa a linha de fallback.
console.assert(!soFeat.includes('Comparação completa'), 'sem metadados nao anexa link');
console.assert(buildChangelog([], {}) === '- Melhorias diversas e correções.', 'sem commits usa fallback');
console.log('✔ buildChangelog agrupou, deduplicou e montou o link de comparacao');

if (failures > 0) {
  console.error(`\n✖ ${failures} asserção(ões) falharam nos testes do changelog.`);
  process.exit(1);
}
console.log('\n✅ Todos os testes do changelog passaram!');
