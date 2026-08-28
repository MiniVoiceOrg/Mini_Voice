import { bumpVersion, determineBumpType, calculateNextVersion, promoteBetaTag, BETA_SUFFIX, parseVersionTag, compareVersionTags, getLatestReleaseTag, getLatestSemverTag } from './calculate-version.js';

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
});
console.assert(betaFirst.nextVersion === '1.8.0-beta', 'beta channel deve gerar 1.8.0-beta');
console.assert(betaFirst.nextTag === 'v1.8.0-beta', 'nextTag beta deve ser v1.8.0-beta');
console.assert(betaFirst.prerelease === true, 'beta deve marcar prerelease=true');
console.assert(betaFirst.baseVersion === '1.8.0', 'baseVersion deve ser 1.8.0');

const betaPatch = calculateNextVersion({
  prevTag: 'v1.7.0',
  commits: ['fix: corrige bug'],
  channel: 'beta',
});
console.assert(betaPatch.nextVersion === '1.7.1-beta', 'beta patch deve gerar 1.7.1-beta');

// O sufixo nao carrega mais contador. O zero-padding mantinha em ordem as
// betas de uma *mesma base* na pagina de releases do GitHub, que ordena pelo
// nome da tag (#338); como a base sobe a cada release (#378), nao ha duas
// betas da mesma base para desempatar e o contador so repetia "001" (#382).
console.assert(BETA_SUFFIX === 'beta', 'o sufixo de beta e apenas "beta"');
console.assert(
  !/\d/.test(String(betaFirst.nextVersion.split('-')[1])),
  'o sufixo de beta nao pode conter digitos'
);
const betaSeguinte = calculateNextVersion({
  prevTag: 'v1.8.0-beta',
  commits: ['fix: qualquer coisa'],
  channel: 'beta',
});
console.assert(
  betaSeguinte.baseVersion !== '1.8.0',
  'a beta seguinte nunca reutiliza a base da anterior'
);
// `semver.prerelease` le "beta" como o canal beta; "beta001" era interpretado
// como um canal customizado e travava o electron-updater (#354).
console.assert(betaFirst.nextVersion.endsWith('-beta'), 'a versao termina no canal "beta"');

// Stable channel (default) permanece inalterado
const stableStill = calculateNextVersion({ prevTag: 'v1.7.0', commits: ['fix: x'] });
console.assert(stableStill.nextVersion === '1.7.1', 'stable default deve gerar 1.7.1');
console.assert(stableStill.prerelease === false, 'stable deve marcar prerelease=false');

// promoteBetaTag: o formato atual e os numerados que ja foram publicados
console.assert(promoteBetaTag('v1.8.0-beta') === '1.8.0', 'promoteBetaTag deve extrair 1.8.0');
console.assert(
  promoteBetaTag('v1.8.0-beta003') === '1.8.0',
  'promoteBetaTag deve aceitar o formato com contador'
);
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
console.assert(parseVersionTag('v1.8.0').prerelease === false, 'tag estável não é prerelease');
console.assert(parseVersionTag('v1.8.0-beta').prerelease === true, 'v1.8.0-beta é prerelease');
console.assert(parseVersionTag('v1.8.0-beta').beta === null, '-beta sem contador não tem número');
console.assert(parseVersionTag('v1.8.0-beta003').beta === 3, 'beta003 deve ser lido como 3');
console.assert(parseVersionTag('v1.8.0-beta.3').beta === 3, 'formato antigo -beta.3 aceito');
console.assert(parseVersionTag('1.8.0').major === 1, 'tag sem prefixo v é aceita');
console.assert(parseVersionTag('nightly') === null, 'tag fora do padrão retorna null');
console.assert(parseVersionTag('v1.8') === null, 'versão incompleta retorna null');

// Precedência SemVer: a beta fica abaixo da estável de mesmos números.
console.assert(compareVersionTags('v1.8.0-beta', 'v1.8.0') < 0, 'beta < estável da mesma base');
console.assert(compareVersionTags('v1.8.0-beta003', 'v1.8.0') < 0, 'beta numerada < estável');
console.assert(compareVersionTags('v1.8.0-beta009', 'v1.8.0-beta014') < 0, 'beta009 < beta014');
console.assert(compareVersionTags('v1.9.0-beta', 'v1.8.0') > 0, 'base maior vence a estável menor');
console.assert(compareVersionTags('v1.8.0', 'v1.8.0') === 0, 'tags iguais empatam');
console.assert(compareVersionTags('v1.8.0-beta', 'v1.8.0-beta') === 0, 'betas iguais empatam');
// Na virada de formato as duas convivem: a numerada foi publicada antes.
console.assert(
  compareVersionTags('v1.8.0-beta', 'v1.8.0-beta001') < 0,
  '-beta sem contador fica abaixo da numerada da mesma base'
);
console.assert(
  compareVersionTags('v1.8.1-beta', 'v1.8.0-beta010') > 0,
  'a base decide antes do contador'
);

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
// A release seguinte à virada de formato precisa enxergar as betas numeradas,
// senão contaria a partir de uma tag antiga demais (#382).
console.assert(
  getLatestReleaseTag(['v1.7.0', 'v1.8.0-beta003', 'v1.8.1-beta']) === 'v1.8.1-beta',
  'getLatestReleaseTag mistura os dois formatos de beta'
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
console.assert(bumpVersion('v1.8.0-beta', 'patch') === '1.8.1', 'patch sobre beta -> 1.8.1');
console.assert(bumpVersion('v1.8.0-beta', 'minor') === '1.9.0', 'minor sobre beta -> 1.9.0');
console.assert(bumpVersion('v1.8.0-beta', 'major') === '2.0.0', 'major sobre beta -> 2.0.0');
console.assert(
  bumpVersion('v1.8.0-beta003', 'patch') === '1.8.1',
  'patch sobre a beta numerada continua funcionando'
);

// O cenário descrito na issue: cada push move o número conforme o que carrega.
const linha1 = calculateNextVersion({
  prevTag: 'v1.0.0',
  commits: ['feat: primeira feature'],
  channel: 'beta',
});
console.assert(linha1.nextVersion === '1.1.0-beta', 'feature sobre 1.0.0 -> 1.1.0-beta');

const linha2 = calculateNextVersion({
  prevTag: 'v1.1.0-beta',
  commits: ['fix: corrige bug'],
  channel: 'beta',
});
console.assert(linha2.nextVersion === '1.1.1-beta', 'fix sobre a beta -> 1.1.1-beta');

const linha3 = calculateNextVersion({
  prevTag: 'v1.1.1-beta',
  commits: ['feat: outra feature'],
  channel: 'beta',
});
console.assert(linha3.nextVersion === '1.2.0-beta', 'nova feature sobre a beta -> 1.2.0-beta');

const linhaBreaking = calculateNextVersion({
  prevTag: 'v1.2.0-beta',
  commits: ['feat!: muda o protocolo'],
  channel: 'beta',
});
console.assert(
  linhaBreaking.nextVersion === '2.0.0-beta',
  'breaking change sobre a beta -> 2.0.0-beta'
);

// A virada de formato: a proxima release conta a partir da ultima numerada.
const viradaDeFormato = calculateNextVersion({
  prevTag: 'v3.1.1-beta001',
  commits: ['fix: ajuste qualquer'],
  channel: 'beta',
});
console.assert(
  viradaDeFormato.nextVersion === '3.1.2-beta',
  'a beta seguinte a uma numerada sai como 3.1.2-beta'
);

// Promover a última beta publica exatamente os números dela.
console.assert(promoteBetaTag('v1.2.0-beta') === '1.2.0', 'promoção usa os números da beta');
console.log('✔ Numeração a partir da última release validada com sucesso! (#378)');

if (failures > 0) {
  console.error(`=== ${failures} asserção(ões) de versionamento falharam ===`);
  process.exit(1);
}

console.log('=== Todos os testes de versionamento passaram com sucesso! ===');
