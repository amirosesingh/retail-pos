// Only this explicit metadata namespace has revision ordering. Arbitrary build
// metadata must not turn an otherwise equal release into an upgrade.
function revision(version) {
  const match = /^\d+\.\d+\.\d+\+revision\.([1-9]\d*)$/.exec(version);
  if (!match) return 0;
  const value = Number(match[1]);
  if (!Number.isSafeInteger(value)) throw new Error('Invalid release revision.');
  return value;
}
function compareRelease(a, b) {
  // Version preparation runs before npm install; only publishers need SemVer.
  const base = require('semver').compare(a, b);
  return base || Math.sign(revision(a) - revision(b));
}
function displayVersion(version) {
  return revision(version) ? `${version.split('+')[0]} (${revision(version)})` : version;
}
module.exports = { revision, compareRelease, displayVersion };
