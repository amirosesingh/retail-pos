/** Promote shared metadata only when both release downloads exist. */
const fs = require('node:fs');
const semver = require('semver');
const { compareRelease } = require('./release-version.cjs');
const BASE = 'https://updatecms.luckycharmsdnbhd.com/pos-app/';

async function promoteSharedManifest(file, { remote, upload, log = console.log }) {
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!semver.valid(manifest.version) || semver.prerelease(manifest.version)) throw new Error('Invalid shared release version.');
  const version = manifest.version;
  for (const [field, name] of [['apkUrl', `Retail-${version}.apk`], ['windowsUrl', `Retail Setup ${version}.exe`]]) {
    const url = new URL(manifest[field]);
    if (!url.href.startsWith(BASE) || decodeURIComponent(url.pathname.split('/').pop()) !== name)
      throw new Error(`Invalid ${field} for shared release ${version}.`);
    if (!await remote(url.href, { optional: true, range: true })) {
      log(`Shared ${version} is not ready: ${field} is not published. Keeping the previous shared manifest.`);
      return false;
    }
  }
  // Either platform can finish last. Never regress a newer complete release.
  const existing = await remote(`${BASE}manifest.json`, { optional: true });
  if (existing && compareRelease(JSON.parse(existing.toString()).version, version) > 0) {
    log(`Keeping the newer published shared release instead of ${version}.`);
    return false;
  }
  upload(file, 'manifest.json', false);
  upload(file, 'latest/manifest.json', false);
  log(`Published shared ${version} after verifying both platform downloads.`);
  return true;
}
module.exports = { promoteSharedManifest };
if (require.main === module) {
  const { remote, upload } = require('./publish-windows-release.cjs');
  promoteSharedManifest(process.argv[2], { remote, upload }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
