/** Publish immutable NSIS artifacts first and the update pointer last. No SDK credentials enter the app. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const yaml = require('js-yaml');
const semver = require('semver');
const BUCKET = 'updatelccms';
const PREFIX = 'pos-app';
const PUBLIC = 'https://updatecms.luckycharmsdnbhd.com/pos-app';
const digest = data => crypto.createHash('sha512').update(data).digest('base64');
function stable(version) { if (!semver.valid(version) || semver.prerelease(version)) throw new Error('A stable semantic version is required.'); return version; }
function validateRelease(directory, version) {
  stable(version);
  const metadata = yaml.load(fs.readFileSync(path.join(directory, 'latest.yml'), 'utf8'));
  const name = `Retail Setup ${version}.exe`;
  if (metadata.version !== version || metadata.path !== name || metadata.files?.length !== 1 || metadata.files[0].url !== name)
    throw new Error('latest.yml must reference exactly the intended versioned installer.');
  const installer = fs.readFileSync(path.join(directory, name));
  const hash = digest(installer);
  if (metadata.sha512 !== hash || metadata.files[0].sha512 !== hash || metadata.files[0].size !== installer.length)
    throw new Error('Installer size or SHA-512 does not match latest.yml.');
  const blockmap = fs.readFileSync(path.join(directory, name + '.blockmap'));
  if (!blockmap.length) throw new Error('Missing installer blockmap.');
  return [name, name + '.blockmap'].map(file => {
    const data = fs.readFileSync(path.join(directory, file));
    return { file, sha512: digest(data), size: data.length };
  });
}
function retention(releases, now = Date.now()) {
  const sorted = [...releases].sort((a,b) => semver.rcompare(stable(a.version), stable(b.version)));
  const retain = [], remove = [];
  sorted.forEach((release, index) => {
    // Downloads and manually pinned recovery versions outlive a metadata switch.
    const age = now - Date.parse(release.released);
    (index < 5 || release.pinned || !Number.isFinite(age) || age < 30 * 86400000 ? retain : remove).push(release);
  });
  return { retain, remove };
}
async function remote(url, { optional = false, range = false } = {}) {
  const response = await fetch(url, { headers: { 'Cache-Control': 'no-cache', 'Accept-Encoding': 'identity', ...(range ? { Range: 'bytes=0-0' } : {}) }, signal: AbortSignal.timeout(120000) });
  if (optional && response.status === 404) return null;
  if (!response.ok) throw new Error(`Release endpoint returned HTTP ${response.status}.`);
  if (range) {
    if (response.status !== 206 || !/^bytes 0-0\/\d+$/.test(response.headers.get('content-range') || '')) throw new Error('Update endpoint does not support byte ranges.');
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length !== 1) throw new Error('Invalid byte-range response.');
    return data;
  }
  return Buffer.from(await response.arrayBuffer());
}
async function preflight(version) {
  stable(version);
  const body = await remote(`${PUBLIC}/latest/latest.yml`, { optional: true });
  if (body && !semver.gt(version, stable(yaml.load(body.toString()).version))) throw new Error('Release version must be newer than the published stable version.');
}
function aws(args) {
  if (!process.env.R2_ENDPOINT || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) throw new Error('R2 release credentials are required.');
  return execFileSync('aws', [...args, '--endpoint-url', process.env.R2_ENDPOINT], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'], windowsHide: true });
}
const contentType = file => file.endsWith('.exe') ? 'application/vnd.microsoft.portable-executable' : file.endsWith('.json') ? 'application/json' : file.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream';
function upload(file, key, immutable) {
  aws(['s3','cp',file,`s3://${BUCKET}/${PREFIX}/${key}`,'--content-type',contentType(file),'--cache-control',immutable ? 'public,max-age=31536000,immutable' : 'no-cache,no-store,must-revalidate']);
}
async function publish(directory, version, releaseId) {
  const artifacts = validateRelease(directory, version);
  if (!new RegExp(`^v${version.replaceAll('.', '\\.')}-[a-f0-9]{7,40}$`).test(releaseId)) throw new Error('Invalid release identity.');
  const published = await remote(`${PUBLIC}/latest/latest.yml`, { optional: true });
  if (published) {
    const current = yaml.load(published.toString());
    if (semver.gt(stable(current.version), version) || (current.version === version && current.sha512 !== artifacts[0].sha512))
      throw new Error('Refusing to replace the current release with older or different binaries.');
  }
  let historyBody = await remote(`${PUBLIC}/releases.json`, { optional: true });
  const history = historyBody ? JSON.parse(historyBody.toString()) : { releases: [] };
  if (!Array.isArray(history.releases)) throw new Error('Invalid release history.');
  // Bootstrap archives written by the previous pipeline without guessing versions from lexical ordering.
  if (!historyBody) {
    const listed = JSON.parse(aws(['s3api','list-objects-v2','--bucket',BUCKET,'--prefix',`${PREFIX}/releases/`,'--output','json']));
    for (const object of listed.Contents ?? []) {
      if (!/^pos-app\/releases\/v[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]+\/release\.json$/.test(object.Key)) continue;
      const data = await remote(`${PUBLIC}/${object.Key.slice(PREFIX.length + 1)}`);
      const legacy = JSON.parse(data.toString());
      stable(legacy.version);
      history.releases.push({ ...legacy, status: 'legacy-published', releaseId: object.Key.split('/')[2], artifacts: [] });
    }
  }
  if (history.releases.some(r => semver.gt(stable(r.version), version) || (r.version === version && r.releaseId !== releaseId))) throw new Error('Version already exists or is older than release history.');
  const archived = await remote(`${PUBLIC}/releases/${releaseId}/release.json`, { optional: true });
  const release = archived ? JSON.parse(archived.toString()) : { version, releaseId, released: new Date().toISOString(), status: 'successful', notes: `Release ${version}`, artifacts };
  if (release.version !== version || release.releaseId !== releaseId || JSON.stringify(release.artifacts) !== JSON.stringify(artifacts)) throw new Error('Historical release differs from this build.');
  fs.writeFileSync(path.join(directory, 'release.json'), JSON.stringify(release, null, 2));
  fs.copyFileSync(path.join(directory, 'latest.yml'), path.join(directory, `${version}.yml`));
  const immutableFiles = [...artifacts.map(a => a.file), `${version}.yml`, 'release.json'];
  // Verify both canonical archives and the flat versioned URLs NSIS uses to resolve old blockmaps.
  for (const file of immutableFiles) {
    for (const key of [`releases/${releaseId}/${file}`, ...(file === 'release.json' ? [] : [`latest/${file}`])]) {
      const url = `${PUBLIC}/${key.split('/').map(encodeURIComponent).join('/')}`;
      const local = fs.readFileSync(path.join(directory, file));
      const existing = await remote(url, { optional: true });
      if (existing && digest(existing) !== digest(local)) throw new Error(`Refusing to overwrite historical artifact ${file}.`);
      if (!existing) upload(path.join(directory, file), key, true);
      const verified = await remote(url);
      if (verified.length !== local.length || digest(verified) !== digest(local)) throw new Error(`Uploaded artifact failed verification: ${file}`);
      if (file.endsWith('.exe') || file.endsWith('.blockmap')) await remote(url, { range: true });
    }
  }
  const plan = retention([...history.releases.filter(r => r.version !== version), release]);
  const nextHistory = { current: version, releases: plan.retain, updated: release.released };
  const historyFile = path.join(directory, 'releases.json');
  fs.writeFileSync(historyFile, JSON.stringify(nextHistory, null, 2));
  // All referenced installers have been verified before any mutable pointer changes.
  upload(historyFile, 'releases.json', false);
  if (digest(await remote(`${PUBLIC}/releases.json`)) !== digest(fs.readFileSync(historyFile))) throw new Error('Release history verification failed.');
  upload(path.join(directory, 'manifest.json'), 'manifest.json', false);
  upload(path.join(directory, 'manifest.json'), 'latest/manifest.json', false);
  upload(path.join(directory, 'latest.yml'), 'latest/latest.yml', false); // publish stable pointer LAST
  if (digest(await remote(`${PUBLIC}/latest/latest.yml`)) !== digest(fs.readFileSync(path.join(directory, 'latest.yml')))) throw new Error('Published metadata verification failed; inspect CDN caching.');
  // Only known history entries are pruned. Keep all small historical blockmaps for old installed versions.
  for (const old of plan.remove) {
    if (!/^v\d+\.\d+\.\d+-[a-f0-9]{7,40}$/.test(old.releaseId)) throw new Error('Unsafe retention target.');
    // Android shares this release directory. Remove only known Windows objects.
    for (const file of [`Retail Setup ${old.version}.exe`, `Retail Setup ${old.version}.exe.blockmap`, `${old.version}.yml`, 'release.json'])
      aws(['s3','rm',`s3://${BUCKET}/${PREFIX}/releases/${old.releaseId}/${file}`]);
    for (const file of [`Retail Setup ${old.version}.exe`, `${old.version}.yml`]) aws(['s3','rm',`s3://${BUCKET}/${PREFIX}/latest/${file}`]);
  }
  console.log(`Published verified Windows ${version}; retained ${plan.retain.length} releases (five minimum plus recovery/download grace).`);
}
module.exports = { validateRelease, retention, preflight, publish };
if (require.main === module) {
  const version = require('../package.json').version;
  (process.argv.includes('--preflight') ? preflight(version) : publish('upload', version, process.env.RELEASE_ID)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
