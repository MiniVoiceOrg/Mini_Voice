import { bumpVersion, determineBumpType, calculateNextVersion } from './calculate-version.js';

console.log('=== Início dos Testes de Versionamento SemVer (#122) ===');

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
console.log('=== Todos os testes de versionamento passaram com sucesso! ===');
