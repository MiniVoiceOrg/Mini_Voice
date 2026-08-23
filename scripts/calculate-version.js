import { execSync } from 'child_process';
import fs from 'fs';

/**
 * Parses commit messages in the given range and determines if the bump
 * should be 'major', 'minor', or 'patch'.
 *
 * Rules:
 * - major: BREAKING CHANGE, BREAKING-CHANGE, commit type ending with '!' (e.g. feat!:, fix!:, refactor!:), or major: / major(...)
 * - minor: feat: / feat(...) / feature: / feature(...) / minor: / minor(...)
 * - patch: fix: / fix(...) / bugfix: / perf: / refactor: / style: / docs: / chore: / test: or default
 */
export function determineBumpType(commitMessages = []) {
  let hasMajor = false;
  let hasMinor = false;

  for (const message of commitMessages) {
    if (!message || typeof message !== 'string') continue;
    const trimmed = message.trim();
    if (!trimmed) continue;

    // Check for breaking changes
    if (
      /BREAKING[ -]CHANGE:/i.test(trimmed) ||
      /^[a-zA-Z0-9_-]+(\([^)]+\))?!:/m.test(trimmed) ||
      /^major(\([^)]+\))?:/i.test(trimmed)
    ) {
      hasMajor = true;
      break; // Major is the highest precedence
    }

    // Check for new features / minor
    if (/^(feat|feature|minor)(\([^)]+\))?:/i.test(trimmed)) {
      hasMinor = true;
    }
  }

  if (hasMajor) return 'major';
  if (hasMinor) return 'minor';
  return 'patch';
}

/**
 * Increments a semver string (e.g. "1.0.55" or "v1.0.55") by bumpType.
 */
export function bumpVersion(currentVersion, bumpType = 'patch') {
  const clean = String(currentVersion || '1.0.0').replace(/^v/, '').trim();
  const parts = clean.split('.').map((p) => {
    const n = parseInt(p, 10);
    return isNaN(n) ? 0 : n;
  });

  let major = parts[0] || 1;
  let minor = parts[1] || 0;
  let patch = parts[2] || 0;

  if (bumpType === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (bumpType === 'minor') {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }

  return `${major}.${minor}.${patch}`;
}

/**
 * Gets the latest git tag matching SemVer (e.g. v1.0.55).
 */
export function getLatestSemverTag() {
  try {
    const tags = execSync('git tag --sort=-creatordate', { encoding: 'utf8' })
      .split('\n')
      .map((t) => t.trim())
      .filter((t) => /^v?[0-9]+\.[0-9]+\.[0-9]+$/.test(t));
    return tags[0] || null;
  } catch (e) {
    return null;
  }
}

/**
 * Gets commit messages between a tag and HEAD.
 */
export function getGitCommitsSinceTag(tag) {
  try {
    const range = tag ? `${tag}..HEAD` : 'HEAD';
    const DELIMITER = '---__COMMIT_DELIMITER__---';
    const output = execSync(`git log ${range} --pretty=format:"%B${DELIMITER}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return output
      .split(DELIMITER)
      .map((c) => c.trim())
      .filter(Boolean);
  } catch (e) {
    try {
      return [execSync('git log -1 --pretty=format:"%B"', { encoding: 'utf8' }).trim()];
    } catch {
      return [];
    }
  }
}

/**
 * Main function to calculate next version.
 */
export function calculateNextVersion(options = {}) {
  const prevTag = options.prevTag || getLatestSemverTag() || 'v1.0.55';
  const commits = options.commits || getGitCommitsSinceTag(prevTag);
  const bumpType = options.bumpType || determineBumpType(commits);
  const nextVersion = bumpVersion(prevTag, bumpType);

  return {
    prevTag,
    bumpType,
    nextVersion,
    nextTag: `v${nextVersion}`,
    commitsCount: commits.length,
  };
}

// If executed directly from Node CLI
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('calculate-version.js') || 
  process.argv[1].endsWith('calculate-version.mjs')
);

if (isDirectRun) {
  const result = calculateNextVersion();
  console.log(`[Version] Previous tag: ${result.prevTag} | Bump: ${result.bumpType} | Next version: ${result.nextVersion}`);

  // Write to GitHub Actions GITHUB_OUTPUT if available
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    fs.appendFileSync(githubOutput, `version=${result.nextVersion}\nprev_tag=${result.prevTag}\nbump_type=${result.bumpType}\n`);
    console.log(`[Version] Written to $GITHUB_OUTPUT: version=${result.nextVersion}`);
  }
}
