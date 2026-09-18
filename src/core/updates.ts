/**
 * Pure update-check helpers: version comparison and "skip this version"
 * logic. No `react` or `@tauri-apps/*` imports here (see the map in
 * CLAUDE.md) — the actual check, download and install live in
 * `src/state/updates.ts`, which this is unit-tested independently of.
 */

interface VersionParts {
  nums: number[];
  /** The text after a `-`, e.g. "beta.1" in "1.2.0-beta.1"; `null` for a
   * plain release. */
  pre: string | null;
}

/** Parse a dotted version like "1.2.3" or "1.2.3-beta.1", with an optional
 * leading "v". Returns `null` for anything that doesn't look like a
 * version, so a malformed `latest.json` never looks like an update. */
function parse(v: string): VersionParts | null {
  const m = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?$/.exec(v.trim());
  if (!m) return null;
  const numsGroup = m[1];
  if (!numsGroup) return null;
  return { nums: numsGroup.split(".").map(Number), pre: m[2] ?? null };
}

/**
 * True if `candidate` is a strictly newer version than `current`.
 *
 * Numeric segments compare left to right, padding the shorter version with
 * zeros (so "1.2" and "1.2.0" are equal). A pre-release is older than the
 * same numbers without one ("1.2.0-beta.1" < "1.2.0"); two pre-releases of
 * the same numbers compare lexically, which is good enough for the labels
 * this project actually uses (`-beta.1`, `-rc.2`) without pulling in a full
 * semver library for one comparison.
 */
export function isNewerVersion(current: string, candidate: string): boolean {
  const b = parse(candidate);
  if (!b) return false;
  const a = parse(current);
  if (!a) return true;

  const len = Math.max(a.nums.length, b.nums.length);
  for (let i = 0; i < len; i++) {
    const an = a.nums[i] ?? 0;
    const bn = b.nums[i] ?? 0;
    if (an !== bn) return bn > an;
  }
  if (a.pre === b.pre) return false;
  if (a.pre === null) return false; // current is a release; candidate of the same numbers is a pre-release
  if (b.pre === null) return true; // candidate is the release of what current is a pre-release of
  return b.pre > a.pre;
}

export interface UpdateAvailability {
  currentVersion: string;
  latestVersion: string;
  /** The version last dismissed with "Skip this version", if any. */
  skippedVersion: string | null | undefined;
}

/**
 * Whether to show the "update available" banner: `latestVersion` must be
 * strictly newer than `currentVersion`, and not the exact version already
 * skipped (a later release still shows).
 */
export function shouldShowUpdateBanner({
  currentVersion,
  latestVersion,
  skippedVersion,
}: UpdateAvailability): boolean {
  if (skippedVersion && skippedVersion === latestVersion) return false;
  return isNewerVersion(currentVersion, latestVersion);
}
