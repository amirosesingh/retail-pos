const fs = require('node:fs');
const crypto = require('node:crypto');
const semver = require('semver');
const { remote, upload } = require('./publish-windows-release.cjs');
async function publishIosStable(file, version, commit, store = { remote, upload }) {
  if (!semver.valid(version) || semver.prerelease(version) || !/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('Invalid stable iOS identity.');
  const key = `releases/v${version}-${commit.slice(0, 7)}/ios/Retail-${version}-unsigned.ipa`;
  const url = `https://updatecms.luckycharmsdnbhd.com/pos-app/${key}`;
  const bytes = fs.readFileSync(file);
  if (!bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw new Error('Invalid IPA.');
  const hash = b => crypto.createHash('sha256').update(b).digest('hex');
  const old = await store.remote(url, { optional: true });
  if (old && hash(old) !== hash(bytes)) throw new Error('Refusing to overwrite immutable IPA.');
  if (!old) await store.upload(file, key, true);
  if (hash(await store.remote(url)) !== hash(bytes)) throw new Error('IPA verification failed.');
  console.log(`Verified stable IPA: ${url}`);
}
module.exports = { publishIosStable };
if (require.main === module) publishIosStable('ios-release-assets/Retail-iOS-unsigned.ipa', process.env.RELEASE_VERSION, process.env.GITHUB_SHA).catch(e => { console.error(e.message); process.exitCode = 1; });
