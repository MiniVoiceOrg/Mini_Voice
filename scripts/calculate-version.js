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
 * Width the beta counter is zero-padded to. GitHub orders the releases page by
 * tag name, so unpadded numbers sorted `beta.9` above `beta.14` and buried the
 * newest build in the middle of the list (#338). Padding makes the textual
 * order match the numeric one. SemVer forbids leading zeroes in *numeric*
 * identifiers, hence `beta014` (a single alphanumeric identifier) instead of
 * the invalid `beta.014`.
 */
export const BETA_PAD_WIDTH = 3;

/** Formats a beta iteration as the zero-padded suffix used in tags (#338). */
export function formatBetaSuffix(betaNumber) {
  const n = Math.max(1, parseInt(betaNumber, 10) || 1);
  return `beta${String(n).padStart(BETA_PAD_WIDTH, '0')}`;
}

/**
 * Given a base stable version (e.g. "1.8.0"), returns the next beta iteration
 * number by inspecting existing beta git tags for that base. Recognises both
 * the padded `vX.Y.Z-betaNNN` form and the legacy `vX.Y.Z-beta.N` one, so the
 * counter keeps climbing across the rename instead of restarting (#338).
 * Returns 1 when no beta exists yet for the base. A `tagList` may be injected
 * (used by tests) to avoid shelling out to git.
 */
export function getNextBetaNumber(baseVersion, tagList = null) {
  const clean = String(baseVersion || '').replace(/^v/, '').trim();
  if (!clean) return 1;
  let tags = tagList;
  if (!tags) {
    try {
      tags = execSync('git tag', { encoding: 'utf8' }).split('\n');
    } catch {
      return 1;
    }
  }
  const re = new RegExp(`^v?${clean.replace(/\./g, '\\.')}-beta\\.?(\\d+)$`);
  let maxN = 0;
  for (const raw of tags) {
    const m = re.exec(String(raw).trim());
    if (m) {
      const n = parseInt(m[1], 10);
      if (!isNaN(n) && n > maxN) maxN = n;
    }
  }
  return maxN + 1;
}

/**
 * Strips the `v` prefix and the beta suffix from a beta tag, yielding the clean
 * stable version to publish when promoting (e.g. "v1.8.0-beta003" -> "1.8.0").
 * Accepts the legacy `-beta.N` form too, so betas published before the rename
 * can still be promoted (#338).
 */
export function promoteBetaTag(betaTag) {
  return String(betaTag || '')
    .replace(/^v/, '')
    .replace(/-beta\.?\d+$/i, '')
    .trim();
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
  const channel = options.channel === 'beta' ? 'beta' : 'stable';
  const prevTag = options.prevTag || getLatestSemverTag() || 'v1.0.55';
  const commits = options.commits || getGitCommitsSinceTag(prevTag);
  const bumpType = options.bumpType || determineBumpType(commits);
  const baseVersion = bumpVersion(prevTag, bumpType);

  if (channel === 'beta') {
    const betaNumber =
      options.betaNumber != null ? options.betaNumber : getNextBetaNumber(baseVersion);
    const nextVersion = `${baseVersion}-${formatBetaSuffix(betaNumber)}`;
    return {
      prevTag,
      bumpType,
      channel,
      prerelease: true,
      baseVersion,
      betaNumber,
      nextVersion,
      nextTag: `v${nextVersion}`,
      commitsCount: commits.length,
    };
  }

  return {
    prevTag,
    bumpType,
    channel,
    prerelease: false,
    baseVersion,
    nextVersion: baseVersion,
    nextTag: `v${baseVersion}`,
    commitsCount: commits.length,
  };
}

// If executed directly from Node CLI
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('calculate-version.js') || 
  process.argv[1].endsWith('calculate-version.mjs')
);

if (isDirectRun) {
  const args = process.argv.slice(2);
  const getFlag = (name) => {
    const idx = args.indexOf(name);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
  };

  const promoteTag = getFlag('--promote') || process.env.PROMOTE_TAG || '';
  const channelArg = (getFlag('--channel') || process.env.RELEASE_CHANNEL || 'stable').toLowerCase();

  let version, prevTag, bumpType, channel, prerelease;

  if (promoteTag) {
    // Promotion: republish a validated beta as a clean stable release.
    version = promoteBetaTag(promoteTag);
    prevTag = getLatestSemverTag() || '';
    bumpType = 'promote';
    channel = 'stable';
    prerelease = false;
    console.log(`[Version] Promote ${promoteTag} -> stable v${version} | Prev: ${prevTag || '<none>'}`);
  } else {
    const result = calculateNextVersion({ channel: channelArg === 'beta' ? 'beta' : 'stable' });
    version = result.nextVersion;
    prevTag = result.prevTag;
    bumpType = result.bumpType;
    channel = result.channel;
    prerelease = result.prerelease;
    console.log(
      `[Version] Previous tag: ${result.prevTag} | Bump: ${result.bumpType} | Channel: ${channel} | Next version: ${version}`
    );
  }

  // Write to GitHub Actions GITHUB_OUTPUT if available
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    fs.appendFileSync(
      githubOutput,
      `version=${version}\nprev_tag=${prevTag}\nbump_type=${bumpType}\nchannel=${channel}\nprerelease=${prerelease}\n`
    );
    console.log(
      `[Version] Written to $GITHUB_OUTPUT: version=${version} channel=${channel} prerelease=${prerelease}`
    );
  }
}
