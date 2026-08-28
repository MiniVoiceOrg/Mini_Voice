import { bumpVersion, determineBumpType, calculateNextVersion, getNextBetaNumber, promoteBetaTag, formatBetaSuffix, parseVersionTag, compareVersionTags, getLatestReleaseTag, getLatestSemverTag } from './calculate-version.js';

console.log('=== Início dos Testes de Versionamento SemVer (#122) ===');

// console.assert nao muda o exit code no Node: sem este contador o script
// terminaria com sucesso mesmo com asserções quebradas e o CI nao veria nada.
let failures = 0;
const nativeAssert = console.assert.bind(console);
console.assert = (condition, ...args) => {
  if (!condition) failures += 1;
  nativeAssert(condition, ...args);
};

// 1. Test bumpVersion
console.assert(bumpVersion('1.0.55', 'patch') === '1.0.56', 'Patch bump: 1.0.55 -> 1.0.56');
console.assert(bumpVersion('1.0.55', 'minor') === '1.1.0', 'Minor bump: 1.0.55 -> 1.1.0');
console.assert(bumpVersion('1.0.55', 'major') === '2.0.0', 'Major bump: 1.0.55 -> 2.0.0');

console.assert(bumpVersion('v1.2.3', 'patch') === '1.2.4', 'Patch com v prefix');
console.assert(bumpVersion('v1.2.3', 'minor') === '1.3.0', 'Minor com v prefix');
console.assert(bumpVersion('v1.2.3', 'major') === '2.0.0', 'Major com v prefix');
console.log('✔ bumpVersion passou em todos os cenários');

// 2. Test determineBumpType
console.assert(determineBumpType(['fix: fix audio bug']) === 'patch', 'fix -> patch');
console.assert(determineBumpType(['fix(ui): adjust layout']) === 'patch', 'fix(scope) -> patch');
console.assert(determineBumpType(['chore: update dependencies', 'docs: update readme']) === 'patch', 'chore/docs -> patch');

console.assert(determineBumpType(['feat: add new feature']) === 'minor', 'feat -> minor');
console.assert(determineBumpType(['feat(soundboard): add shortcuts', 'fix: fix bug']) === 'minor', 'feat + fix -> minor');
console.assert(determineBumpType(['feature: new feature']) === 'minor', 'feature -> minor');

console.assert(determineBumpType(['feat!: breaking change in auth']) === 'major', 'feat! -> major');
console.assert(determineBumpType(['fix(core)!: breaking fix']) === 'major', 'fix! -> major');
console.assert(determineBumpType(['refactor: rewrite\n\nBREAKING CHANGE: new API']) === 'major', 'BREAKING CHANGE -> major');
console.assert(determineBumpType(['refactor: rewrite\n\nBREAKING-CHANGE: new API']) === 'major', 'BREAKING-CHANGE -> major');
console.assert(determineBumpType(['major: redesign architecture']) === 'major', 'major: -> major');
console.log('✔ determineBumpType identificou corretamente major, minor e patch');

// 3. Test calculateNextVersion helper
const resMinor = calculateNextVersion({
  prevTag: 'v1.0.55',
  commits: ['feat(ui): toggle noise suppression', 'fix(ui): fix alignment'],
});
console.assert(resMinor.nextVersion === '1.1.0', 'calculateNextVersion com feat deve resultar em 1.1.0');
console.assert(resMinor.nextTag === 'v1.1.0', 'nextTag deve ser v1.1.0');

const resPatch = calculateNextVersion({
  prevTag: 'v1.0.55',
  commits: ['fix: fix bug in player'],
});
console.assert(resPatch.nextVersion === '1.0.56', 'calculateNextVersion com fix deve resultar em 1.0.56');

const resMajor = calculateNextVersion({
  prevTag: 'v1.0.55',
  commits: ['refactor!: rewrite networking engine'],
});
console.assert(resMajor.nextVersion === '2.0.0', 'calculateNextVersion com breaking change deve resultar em 2.0.0');

console.log('✔ calculateNextVersion validado com sucesso!');

// 4. Test beta channel (#release-beta)
const betaFirst = calculateNextVersion({
  prevTag: 'v1.7.0',
  commits: ['feat: nova feature de chat'],
  channel: 'beta',
  betaNumber: 1,
});
console.assert(betaFirst.nextVersion === '1.8.0-beta001', 'beta channel deve gerar 1.8.0-beta001');
console.assert(betaFirst.nextTag === 'v1.8.0-beta001', 'nextTag beta deve ser v1.8.0-beta001');
console.assert(betaFirst.prerelease === true, 'beta deve marcar prerelease=true');
console.assert(betaFirst.baseVersion === '1.8.0', 'baseVersion deve ser 1.8.0');

const betaPatch = calculateNextVersion({
  prevTag: 'v1.7.0',
  commits: ['fix: corrige bug'],
  channel: 'beta',
  betaNumber: 3,
});
console.assert(betaPatch.nextVersion === '1.7.1-beta003', 'beta patch deve gerar 1.7.1-beta003');

// O GitHub ordena a pagina de releases pelo nome da tag, entao o numero e
// zero-padded para que a ordem textual bata com a numerica (#338).
const beta14 = calculateNextVersion({
  prevTag: 'v1.7.0',
  commits: ['feat: x'],
  channel: 'beta',
  betaNumber: 14,
});
console.assert(beta14.nextTag === 'v1.8.0-beta014', 'beta 14 deve virar v1.8.0-beta014');
console.assert(
  ['v1.8.0-beta009', 'v1.8.0-beta014'].sort()[1] === 'v1.8.0-beta014',
  'beta014 deve ordenar depois de beta009 alfabeticamente'
);
console.assert(
  formatBetaSuffix(7) === 'beta007' && formatBetaSuffix(123) === 'beta123',
  'formatBetaSuffix deve preencher com zeros ate 3 digitos'
);
// SemVer proibe zero a esquerda em identificador numerico, entao o sufixo e um
// unico identificador alfanumerico (beta014) e nao beta.014.
console.assert(
  !/-beta\.\d/.test(beta14.nextVersion),
  'o sufixo nao pode usar identificador numerico separado por ponto'
);

// Stable channel (default) permanece inalterado
const stableStill = calculateNextVersion({ prevTag: 'v1.7.0', commits: ['fix: x'] });
console.assert(stableStill.nextVersion === '1.7.1', 'stable default deve gerar 1.7.1');
console.assert(stableStill.prerelease === false, 'stable deve marcar prerelease=false');

// getNextBetaNumber com lista de tags injetada
console.assert(
  getNextBetaNumber('1.8.0', ['v1.7.0', 'v1.8.0-beta001', 'v1.8.0-beta002']) === 3,
  'getNextBetaNumber deve retornar 3 após beta001 e beta002'
);
console.assert(
  getNextBetaNumber('1.8.0', ['v1.7.0', 'v1.9.0-beta001']) === 1,
  'getNextBetaNumber deve retornar 1 quando não há beta para a base'
);
console.assert(
  getNextBetaNumber('1.8.0', ['v1.8.0-beta009', 'v1.8.0-beta010']) === 11,
  'getNextBetaNumber deve tratar números corretamente (10 -> 11)'
);
// A contagem tem que enxergar as tags do formato antigo, senão o contador
// reiniciaria em 1 na virada de nomenclatura (#338).
console.assert(
  getNextBetaNumber('1.8.0', ['v1.8.0-beta.9', 'v1.8.0-beta.14']) === 15,
  'getNextBetaNumber deve continuar a contagem das tags no formato antigo'
);
console.assert(
  getNextBetaNumber('1.8.0', ['v1.8.0-beta.14', 'v1.8.0-beta015']) === 16,
  'getNextBetaNumber deve considerar os dois formatos ao mesmo tempo'
);

// promoteBetaTag
console.assert(promoteBetaTag('v1.8.0-beta003') === '1.8.0', 'promoteBetaTag deve extrair 1.8.0');
console.assert(promoteBetaTag('1.8.0-beta012') === '1.8.0', 'promoteBetaTag sem prefixo v');
console.assert(
  promoteBetaTag('v1.8.0-beta.3') === '1.8.0',
  'promoteBetaTag deve aceitar o formato antigo'
);
console.log('✔ Canal beta e promoção validados com sucesso!');

// 5. Numeração a partir da última release, betas incluídas (#378)
//
// Antes, toda a linha de beta mirava a mesma versão: 1.0.0 + feature virava
// 1.1.0-beta001 e qualquer beta seguinte continuava em 1.1.0, então promover
// depois de dezenas de mudanças ainda publicava 1.1.0. Agora cada release é
// numerada a partir da imediatamente anterior.
console.assert(parseVersionTag('v1.8.0').beta === null, 'tag estável não tem beta');
console.assert(parseVersionTag('v1.8.0-beta003').beta === 3, 'beta003 deve ser lido como 3');
console.assert(parseVersionTag('v1.8.0-beta.3').beta === 3, 'formato antigo -beta.3 aceito');
console.assert(parseVersionTag('1.8.0').major === 1, 'tag sem prefixo v é aceita');
console.assert(parseVersionTag('nightly') === null, 'tag fora do padrão retorna null');
console.assert(parseVersionTag('v1.8') === null, 'versão incompleta retorna null');

// Precedência SemVer: a beta fica abaixo da estável de mesmos números.
console.assert(compareVersionTags('v1.8.0-beta003', 'v1.8.0') < 0, 'beta < estável da mesma base');
console.assert(compareVersionTags('v1.8.0-beta009', 'v1.8.0-beta014') < 0, 'beta009 < beta014');
console.assert(compareVersionTags('v1.9.0-beta001', 'v1.8.0') > 0, 'base maior vence a estável menor');
console.assert(compareVersionTags('v1.8.0', 'v1.8.0') === 0, 'tags iguais empatam');

// A estável criada ao promover aponta para o mesmo commit da beta, então as
// duas tags têm a mesma data — ordenar por data não distinguiria as duas.
console.assert(
  getLatestReleaseTag(['v1.7.0', 'v1.8.0-beta001', 'v1.8.0-beta002']) === 'v1.8.0-beta002',
  'getLatestReleaseTag deve considerar betas'
);
console.assert(
  getLatestReleaseTag(['v1.8.0-beta002', 'v1.8.0']) === 'v1.8.0',
  'a estável promovida supera a própria beta'
);
console.assert(
  getLatestReleaseTag(['v1.7.0', 'nightly', 'sem-tag']) === 'v1.7.0',
  'tags fora do padrão são ignoradas'
);
console.assert(getLatestReleaseTag([]) === null, 'sem tags, getLatestReleaseTag retorna null');
console.assert(
  getLatestSemverTag(['v1.7.0', 'v1.8.0-beta002', 'v1.8.0-beta003']) === 'v1.7.0',
  'getLatestSemverTag continua ignorando betas (usado na promoção)'
);

// O marcador de prerelease é descartado antes do incremento.
console.assert(bumpVersion('v1.8.0-beta003', 'patch') === '1.8.1', 'patch sobre beta -> 1.8.1');
console.assert(bumpVersion('v1.8.0-beta003', 'minor') === '1.9.0', 'minor sobre beta -> 1.9.0');
console.assert(bumpVersion('v1.8.0-beta003', 'major') === '2.0.0', 'major sobre beta -> 2.0.0');

// O cenário descrito na issue: cada push move o número conforme o que carrega.
const linha1 = calculateNextVersion({
  prevTag: 'v1.0.0',
  commits: ['feat: primeira feature'],
  channel: 'beta',
  betaNumber: 1,
});
console.assert(linha1.nextVersion === '1.1.0-beta001', 'feature sobre 1.0.0 -> 1.1.0-beta001');

const linha2 = calculateNextVersion({
  prevTag: 'v1.1.0-beta001',
  commits: ['fix: corrige bug'],
  channel: 'beta',
  betaNumber: 1,
});
console.assert(linha2.nextVersion === '1.1.1-beta001', 'fix sobre a beta -> 1.1.1-beta001');

const linha3 = calculateNextVersion({
  prevTag: 'v1.1.1-beta001',
  commits: ['feat: outra feature'],
  channel: 'beta',
  betaNumber: 1,
});
console.assert(linha3.nextVersion === '1.2.0-beta001', 'nova feature sobre a beta -> 1.2.0-beta001');

const linhaBreaking = calculateNextVersion({
  prevTag: 'v1.2.0-beta001',
  commits: ['feat!: muda o protocolo'],
  channel: 'beta',
  betaNumber: 1,
});
console.assert(
  linhaBreaking.nextVersion === '2.0.0-beta001',
  'breaking change sobre a beta -> 2.0.0-beta001'
);

// Promover a última beta publica exatamente os números dela.
console.assert(promoteBetaTag('v1.2.0-beta001') === '1.2.0', 'promoção usa os números da beta');
console.log('✔ Numeração a partir da última release validada com sucesso! (#378)');

if (failures > 0) {
  console.error(`=== ${failures} asserção(ões) de versionamento falharam ===`);
  process.exit(1);
}

console.log('=== Todos os testes de versionamento passaram com sucesso! ===');
