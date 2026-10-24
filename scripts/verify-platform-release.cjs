const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateRelease } = require('./publish-windows-release.cjs');
const BASE = 'https://updatecms.luckycharmsdnbhd.com/pos-app/';
function verifyPlatformRelease(windows, android, { version, commit }) {
  if (!/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('Expected immutable release commit.');
  const releaseId = `v${version}-${commit.slice(0, 7)}`;
  const json = (dir, file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const win = json(windows, 'release.json');
  const apk = json(android, 'latest.json');
  for (const metadata of [win, apk]) {
    if (metadata.version !== version || metadata.tag !== `v${version}` || metadata.commit !== commit)
      throw new Error('Platform packages do not match the same release version and commit.');
  }
  if (win.path !== `pos-app/releases/${releaseId}/` || apk.path !== `pos-app/releases/${releaseId}/android/` || apk.file !== `Retail-${version}.apk`)
    throw new Error('Unexpected platform artifact identity.');
  validateRelease(windows, version);
  const bytes = fs.readFileSync(path.join(android, apk.file));
  if (bytes.length < 4 || !bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])))
    throw new Error('Android package is missing or invalid.');
  const manifests = [json(windows, 'manifest.json'), json(android, 'manifest.json')];
  for (const manifest of manifests) {
    if (manifest.version !== version || manifest.apkUrl !== `${BASE}releases/${releaseId}/android/Retail-${version}.apk` ||
        manifest.windowsUrl !== `${BASE}latest/Retail%20Setup%20${version}.exe` ||
        !Number.isSafeInteger(manifest.buildNumber) || manifest.buildNumber < 1 || !Number.isSafeInteger(manifest.bundleEpoch))
      throw new Error('Invalid paired update manifest.');
  }
  if (manifests[0].buildNumber !== manifests[1].buildNumber || manifests[0].bundleEpoch !== manifests[1].bundleEpoch)
    throw new Error('Platform build identities differ.');
  return { version, releaseId };
}
async function publishAndroidArchive(directory, { remote, upload }) {
  const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'latest.json'), 'utf8'));
  if (!/^Retail-\d+\.\d+\.\d+(?:\+revision\.[1-9]\d*)?\.apk$/.test(metadata.file) || !/^pos-app\/releases\/v\d+\.\d+\.\d+(?:\+revision\.[1-9]\d*)?-[a-f0-9]{7,40}\/android\/$/.test(metadata.path))
    throw new Error('Invalid Android archive identity.');
  const file = path.join(directory, metadata.file);
  const bytes = fs.readFileSync(file);
  const key = metadata.path.slice('pos-app/'.length) + metadata.file;
  const url = BASE + key;
  const hash = data => crypto.createHash('sha256').update(data).digest('hex');
  const existing = await remote(url, { optional: true });
  if (existing && hash(existing) !== hash(bytes)) throw new Error('Refusing to overwrite a different historical Android package.');
  if (!existing) upload(file, key, true);
  if (hash(await remote(url)) !== hash(bytes)) throw new Error('Android archive verification failed.');
  await remote(url, { range: true });
}
module.exports = { verifyPlatformRelease, publishAndroidArchive };
if (require.main === module) {
  (async () => {
    if (process.argv[2] === '--publish-android') {
      const { remote, upload } = require('./publish-windows-release.cjs');
      await publishAndroidArchive(process.argv[3], { remote, upload });
      return;
    }
    const result = verifyPlatformRelease(process.argv[2], process.argv[3], {
      version: require('../package.json').version, commit: process.env.GITHUB_SHA,
    });
    console.log(`Verified paired release ${result.releaseId}`);
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
