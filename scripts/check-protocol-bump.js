import { execSync } from 'child_process';
import { determineBumpType } from './calculate-version.js';

/**
 * Fails a pull request that changes PROTOCOL_VERSION without marking the change
 * as breaking.
 *
 * Bumping PROTOCOL_VERSION makes client and server refuse each other outright
 * (`validators.ts` requires exact equality), so an outdated client cannot talk
 * to an updated server at all. That is a breaking change and has to ship as a
 * major release — it slipped through once as a plain `feat:` and published a
 * minor (#338).
 *
 * The check runs the very function the release pipeline uses to pick the bump,
 * over the same text the squash commit will carry (the PR title as subject plus
 * the branch commit messages as body), so the two can never disagree.
 */
const PROTOCOL_FILE = 'packages/shared/src/constants.ts';
const PROTOCOL_LINE = /^[+-]\s*export const PROTOCOL_VERSION/m;

function run(command) {
  return execSync(command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
}

const base = (process.env.BASE_SHA || '').trim();
const head = (process.env.HEAD_SHA || '').trim();
const prTitle = (process.env.PR_TITLE || '').trim();

if (!base || !head) {
  console.log('[Protocol] Sem contexto de pull request — nada a conferir.');
  process.exit(0);
}

let diff = '';
try {
  diff = run(`git diff ${base} ${head} -- ${PROTOCOL_FILE}`);
} catch {
  console.log('[Protocol] Nao foi possivel ler o diff; conferencia ignorada.');
  process.exit(0);
}

if (!PROTOCOL_LINE.test(diff)) {
  console.log('[Protocol] PROTOCOL_VERSION inalterado neste PR.');
  process.exit(0);
}

console.log('[Protocol] PROTOCOL_VERSION mudou neste PR.');

let commits = '';
try {
  commits = run(`git log ${base}..${head} --pretty=format:%B`);
} catch {
  commits = '';
}

const bump = determineBumpType([prTitle, commits]);
if (bump === 'major') {
  console.log('[Protocol] Marcador de breaking change encontrado — sera publicada uma major.');
  process.exit(0);
}

console.error(
  `::error file=${PROTOCOL_FILE}::PROTOCOL_VERSION mudou, mas os commits gerariam um bump "${bump}". ` +
    'Cliente e servidor com versoes de protocolo diferentes se recusam a conectar, entao isso e uma breaking change ' +
    'e precisa sair como major. Use um titulo de PR como "feat!: ..." ou inclua um paragrafo "BREAKING CHANGE: ..." ' +
    'na mensagem de um commit da branch.'
);
process.exit(1);
