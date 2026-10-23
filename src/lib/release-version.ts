/** Human-facing label; the immutable release identity stays machine-readable. */
export function releaseRevision(version: string): number {
  const match = /^\d+\.\d+\.\d+\+revision\.([1-9]\d*)$/.exec(version);
  const value = match ? Number(match[1]) : 0;
  return Number.isSafeInteger(value) ? value : 0;
}
export function displayReleaseVersion(version: string): string {
  const revision = releaseRevision(version);
  return revision ? `${version.split("+")[0]} (${revision})` : version;
}
