import { execSync } from 'child_process';

/**
 * Builds the friendly, grouped changelog shown both on the GitHub release and,
 * since #547, inside the client. It turns the raw commit range into three
 * sections — Novidades / Correções / Outros — so a release reads like release
 * notes instead of a flat list of subjects.
 *
 * The text itself comes from the curated `#NNN: descrição` lines the team keeps
 * in commit bodies; a commit without them falls back to its `- ` bullets and
 * then to its subject. Each commit is placed in a section by its *subject*
 * conventional type (feat → Novidades, fix → Correções, everything else →
 * Outros), because the body lines carry the description but not the type.
 */

/** Conventional-commit types we recognise, mirroring calculate-version.js. */
const COMMIT_TYPES =
  'feat|feature|minor|fix|bugfix|perf|refactor|style|docs|chore|test|build|ci|revert|major';

/**
 * A bullet GitHub writes into a squash body (`* fix: subject`). We skip these
 * when reading descriptions: the team curates `#NNN:` lines instead, and a
 * stray squash bullet would otherwise leak a raw, typed subject into the notes.
 */
const SQUASH_ENTRY = new RegExp(`^\\s*[*-]\\s+(${COMMIT_TYPES})(\\([^)]*\\))?(!)?:`, 'i');

/** A curated changelog line as kept in commit bodies: `#498: descrição`. */
const ISSUE_LINE = /^#\d+:/;

const GROUPS = [
  ['novidades', '#### ✨ Novidades'],
  ['correcoes', '#### 🐛 Correções'],
  ['outros', '#### 🔧 Outros'],
];

const FALLBACK_LINE = '- Melhorias diversas e correções.';

/**
 * Picks the section a commit belongs to from its subject's conventional type.
 * Anything that is not a feature or a fix lands in "Outros", which is also where
 * untyped commits go.
 */
export function classifyGroup(subjectLine) {
  const header = String(subjectLine || '')
    .replace(/^\s*[*-]\s+/, '')
    .trim();
  if (/^(feat|feature|minor)(\([^)]*\))?!?:/i.test(header)) return 'novidades';
  if (/^(fix|bugfix)(\([^)]*\))?!?:/i.test(header)) return 'correcoes';
  return 'outros';
}

/**
 * Strips the conventional-commit type prefix and any leading squash bullet from
 * a subject, leaving the human part (kept as the last-resort description).
 */
export function stripType(subject) {
  return String(subject || '')
    .replace(/^\s*[*-]\s+/, '')
    .replace(new RegExp(`^(${COMMIT_TYPES})(\\([^)]*\\))?!?:\\s*`, 'i'), '')
    .trim();
}

/**
 * Pulls the user-facing lines out of one commit message.
 *
 * Preference order, matching how the team writes commits:
 * 1. Curated `#NNN: descrição` lines from the body (continuation lines that
 *    wrap onto the next row are folded back in).
 * 2. Plain `- `/`* ` bullets from the body (squash `* type:` bullets excluded).
 * 3. The subject with its type prefix removed.
 */
export function extractEntries(commitMessage) {
  const lines = String(commitMessage || '').split('\n');
  const subject = (lines[0] || '').trim();
  const bodyLines = lines.slice(1);

  const entries = [];
  let current = null;
  const flush = () => {
    if (current) {
      const text = current.replace(/\s+/g, ' ').trim();
      if (text) entries.push(text);
      current = null;
    }
  };

  for (const raw of bodyLines) {
    const line = raw.trim();
    if (ISSUE_LINE.test(line)) {
      flush();
      current = line;
    } else if (current) {
      const ends =
        !line ||
        /^co-authored-by:/i.test(line) ||
        /^breaking[ -]change:/i.test(line) ||
        SQUASH_ENTRY.test(line);
      if (ends) flush();
      else current += ` ${line}`;
    }
  }
  flush();
  if (entries.length > 0) return entries;

  const bullets = bodyLines
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s+/.test(l) && !SQUASH_ENTRY.test(l))
    .map((l) => l.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean);
  if (bullets.length > 0) return bullets;

  const fromSubject = stripType(subject);
  return fromSubject ? [fromSubject] : [];
}

/** Removes exact duplicate lines while keeping their first-seen order. */
function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (seen.has(it)) continue;
    seen.add(it);
    out.push(it);
  }
  return out;
}

/**
 * Turns a list of commit messages (oldest first) into the grouped changelog
 * markdown. Pure and side-effect free so it can be unit-tested with synthetic
 * commits; the CLI wrapper below feeds it the real git range.
 */
export function buildChangelog(commits = [], options = {}) {
  const { repo, version, prevTag } = options;
  const buckets = { novidades: [], correcoes: [], outros: [] };

  for (const message of commits) {
    if (!message || typeof message !== 'string') continue;
    const subject = message.split('\n')[0] || '';
    const group = classifyGroup(subject);
    for (const entry of extractEntries(message)) {
      buckets[group].push(entry);
    }
  }

  const sections = [];
  for (const [key, heading] of GROUPS) {
    const items = dedupe(buckets[key]);
    if (items.length === 0) continue;
    sections.push(heading, '');
    for (const item of items) sections.push(`- ${item}`);
    sections.push('');
  }

  let notes = sections.join('\n').trim();
  if (!notes) notes = FALLBACK_LINE;

  if (repo && prevTag && version) {
    notes += `\n\n**Comparação completa**: https://github.com/${repo}/compare/${prevTag}...v${version}`;
  }
  return notes;
}

/**
 * Reads commit messages in `${prevTag}..HEAD`, oldest first, merges excluded.
 * Mirrors calculate-version.js's delimiter approach so a body containing blank
 * lines is never split into several commits.
 */
export function getCommitsInRange(prevTag) {
  try {
    const range = prevTag ? `${prevTag}..HEAD` : 'HEAD';
    const DELIMITER = '---__COMMIT_DELIMITER__---';
    const output = execSync(`git log --reverse --no-merges ${range} --pretty=format:"%B${DELIMITER}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return output
      .split(DELIMITER)
      .map((c) => c.trim())
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('generate-changelog.js') ||
    process.argv[1].endsWith('generate-changelog.mjs'));

if (isDirectRun) {
  const args = process.argv.slice(2);
  const getFlag = (name) => {
    const idx = args.indexOf(name);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
  };

  const prevTag = getFlag('--prev') || process.env.PREV_TAG || '';
  const version = getFlag('--version') || process.env.RELEASE_VERSION || '';
  const repo = getFlag('--repo') || process.env.GITHUB_REPOSITORY || '';

  const commits = getCommitsInRange(prevTag);
  const notes = buildChangelog(commits, { repo, version, prevTag });
  process.stdout.write(`${notes}\n`);
}
