/** Beta publisher deliberately has no configurable storage prefix or stable promotion. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const semver = require('semver');
const { BETA_BASE } = require('./prepare-beta.cjs');
const { validateRelease } = require('./publish-windows-release.cjs');
const PREFIX = 'pos-app/beta/';
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
function verifyBetaPair(windows, android, { version, commit }) {
  if (!/^\d+\.\d+\.\d+-beta\.[1-9]\d*$/.test(version || '') || !semver.valid(version) || !/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('Invalid beta identity.');
  const releaseId = `beta-v${version}-${commit.slice(0, 7)}`;
  const read = (dir, file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const win = read(windows, 'release.json'), apk = read(android, 'latest.json');
  for (const meta of [win, apk]) if (meta.version !== version || meta.commit !== commit || meta.tag !== `beta-v${version}`) throw new Error('Beta packages have different identities.');
  if (win.path !== `${PREFIX}releases/${releaseId}/` || apk.path !== `${PREFIX}releases/${releaseId}/android/` || apk.file !== `Retail-${version}.apk`) throw new Error('Invalid beta artifact path.');
  validateRelease(windows, version, { beta: true });
  const bytes = fs.readFileSync(path.join(android, apk.file));
  if (!bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw new Error('Invalid beta APK.');
  const manifests = [read(windows, 'manifest.json'), read(android, 'manifest.json')];
  for (const m of manifests) if (m.version !== version || m.apkUrl !== `${BETA_BASE}/releases/${releaseId}/android/${apk.file}` || m.windowsUrl !== `${BETA_BASE}/latest/Retail%20Setup%20${version}.exe` || !Number.isSafeInteger(m.buildNumber) || m.buildNumber < 1) throw new Error('Invalid beta update manifest.');
  if (manifests[0].buildNumber !== manifests[1].buildNumber || manifests[0].bundleEpoch !== manifests[1].bundleEpoch) throw new Error('Beta build numbers differ.');
  return { releaseId, manifest: manifests[0], apk };
}
function assertBetaKey(key) {
  if (!key.startsWith(PREFIX) || key.includes('..') || key.includes('\\')) throw new Error('Beta publisher cannot access stable storage.');
}
function originStore() {
  if (!process.env.R2_ENDPOINT || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) throw new Error('Beta R2 credentials are required.');
  const aws = args => execFileSync('aws', [...args, '--endpoint-url', process.env.R2_ENDPOINT], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  return {
    read(key, optional = false) {
      assertBetaKey(key);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-beta-'));
      const file = path.join(dir, 'object');
      try { aws(['s3api', 'get-object', '--bucket', 'updatelccms', '--key', key, file]); return fs.readFileSync(file); }
      catch (error) { if (optional && /NoSuchKey|\(404\)/.test(String(error.stderr ?? ''))) return null; throw error; }
      finally { if (fs.existsSync(file)) fs.unlinkSync(file); fs.rmdirSync(dir); }
    },
    write(file, key, immutable) {
      assertBetaKey(key);
      aws(['s3', 'cp', file, `s3://updatelccms/${key}`, '--cache-control', immutable ? 'public,max-age=31536000,immutable' : 'no-cache,no-store,must-revalidate']);
    },
  };
}
async function publishBeta(windows, android, expected, store = originStore()) {
  const pair = verifyBetaPair(windows, android, expected);
  const existing = await store.read(`${PREFIX}manifest.json`, true);
  if (existing && semver.gt(JSON.parse(existing.toString()).version, expected.version)) throw new Error('Refusing an older beta release.');
  const immutable = async (file, key) => {
    const local = fs.readFileSync(file), old = await store.read(key, true);
    if (old && digest(old) !== digest(local)) throw new Error('Refusing different historical beta bytes.');
    if (!old) await store.write(file, key, true);
    if (digest(await store.read(key)) !== digest(local)) throw new Error('Beta artifact verification failed.');
  };
  const name = `Retail Setup ${expected.version}.exe`;
  for (const file of [name, name + '.blockmap']) {
    await immutable(path.join(windows, file), `${PREFIX}releases/${pair.releaseId}/${file}`);
    await immutable(path.join(windows, file), `${PREFIX}latest/${file}`);
  }
  await immutable(path.join(android, pair.apk.file), `${PREFIX}releases/${pair.releaseId}/android/${pair.apk.file}`);
  await immutable(path.join(windows, 'release.json'), `${PREFIX}releases/${pair.releaseId}/release.json`);
  await immutable(path.join(windows, 'latest.yml'), `${PREFIX}latest/${expected.version}.yml`);
  // Every advertised package has been read back and verified before pointer updates.
  const pointers = [
    [path.join(windows, 'latest.yml'), 'latest/latest.yml'],
    [path.join(android, 'latest.json'), 'latest/android/latest.json'],
    [path.join(windows, 'manifest.json'), 'manifest.json'],
    [path.join(windows, 'manifest.json'), 'latest/manifest.json'],
  ];
  for (const [file, key] of pointers) {
    await store.write(file, PREFIX + key, false);
    if (digest(await store.read(PREFIX + key)) !== digest(fs.readFileSync(file))) throw new Error('Beta pointer verification failed.');
  }
  console.log(`Published isolated beta ${expected.version}`);
}
module.exports = { verifyBetaPair, assertBetaKey, publishBeta };
if (require.main === module) publishBeta('upload', 'release-assets', { version: process.env.BETA_VERSION, commit: process.env.GITHUB_SHA }).catch(error => { console.error(error.message); process.exitCode = 1; });
