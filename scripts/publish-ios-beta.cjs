// Invoked only by the owner-approved beta publication workflow, never PR checks.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { originStore } = require('./publish-beta-release.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function publishIosBeta(file, version, commit, store) {
  if (!/^\d+\.\d+\.\d+-beta\.[1-9]\d*$/.test(version || '') || !/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('Invalid beta identity.');
  const bytes = fs.readFileSync(file);
  if (!bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw new Error('Invalid IPA archive.');
  const key = `pos-app/beta/releases/beta-v${version}-${commit.slice(0, 7)}/ios/Retail-${version}-unsigned.ipa`;
  const existing = await store.read(key, true);
  if (existing && hash(existing) !== hash(bytes)) throw new Error('Refusing to overwrite historical IPA.');
  if (!existing) await store.write(file, key, true);
  if (hash(await store.read(key)) !== hash(bytes)) throw new Error('IPA upload verification failed.');
  console.log(`Verified beta IPA: ${key}`);
}
module.exports = { publishIosBeta };
if (require.main === module) publishIosBeta('ios-release-assets/Retail-iOS-Beta-unsigned.ipa', process.env.BETA_VERSION, process.env.GITHUB_SHA, originStore()).catch(error => { console.error(error.message); process.exitCode = 1; });
