// Explicit publication only. Never invoked by PR or installer build workflows.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const semver = require('semver');
const { iosReleaseConfig } = require('./ios-release-config.cjs');
const release = iosReleaseConfig(process.env.POS_RELEASE_CHANNEL || 'beta', require('../ios-ota.public.json'));
const trust = release.trust;
const version = process.argv[2];
if (process.env.OTA_PUBLISH_CONFIRM !== 'Publish iOS OTA now' || !semver.valid(version)) throw new Error('Explicit iOS OTA publication confirmation and version required.');
if (release.channel === 'stable' && semver.prerelease(version)) throw new Error('Stable OTA requires a stable version.');
const dir = path.resolve('ota-artifacts', version);
const raw = fs.readFileSync(path.join(dir, 'manifest.json'));
const envelope = JSON.parse(raw), payload = Buffer.from(envelope.payload, 'base64');
const publicKey = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(trust.publicKey, 'base64').toString('base64url') }, format: 'jwk' });
if (!crypto.verify(null, payload, publicKey, Buffer.from(envelope.signature, 'base64'))) throw new Error('Invalid signature.');
const m = JSON.parse(payload);
if (m.version !== version || m.channel !== trust.channel || m.appId !== trust.appId || m.url !== `${trust.origin}/pos-app/ios-ota/releases/${version}/bundle.zip` || m.expiresAt <= Date.now()) throw new Error('Invalid release identity.');
const checksum = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'bundle.zip'))).digest('hex');
if (checksum !== m.checksum) throw new Error('Bundle checksum mismatch.');
const bucket = process.env.OTA_R2_BUCKET;
if (!bucket || !process.env.R2_ENDPOINT) throw new Error('OTA_R2_BUCKET and R2_ENDPOINT are required.');
const aws = args => execFileSync('aws', [...args, '--endpoint-url', process.env.R2_ENDPOINT], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
const oldFile = path.join(dir, 'previous-manifest.json');
try {
  aws(['s3api', 'get-object', '--bucket', bucket, '--key', `pos-app/ios-ota/${trust.channel}/manifest.json`, oldFile]);
  const old = JSON.parse(fs.readFileSync(oldFile));
  const oldPayload = Buffer.from(old.payload, 'base64');
  if (!crypto.verify(null, oldPayload, publicKey, Buffer.from(old.signature, 'base64'))) throw new Error('Existing manifest signature is invalid. Investigate before publishing.');
  if (!semver.gt(version, JSON.parse(oldPayload).version)) throw new Error('Refusing to publish a previous or reused release version.');
} catch (e) { if (!/404|Not Found|NoSuchKey/.test(String(e.stderr || ''))) throw e; }
finally { if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile); }
const zipKey = `pos-app/ios-ota/releases/${version}/bundle.zip`;
try { aws(['s3api', 'head-object', '--bucket', bucket, '--key', zipKey]); throw new Error('Immutable release already exists. Choose a new version.'); }
catch (e) { if (!/404|Not Found|NoSuchKey/.test(String(e.stderr || ''))) throw e; }
aws(['s3', 'cp', path.join(dir, 'bundle.zip'), `s3://${bucket}/${zipKey}`, '--cache-control', 'public,max-age=31536000,immutable', '--content-type', 'application/zip']);
const verifyFile = path.join(dir, 'uploaded-verification.zip');
aws(['s3api', 'get-object', '--bucket', bucket, '--key', zipKey, verifyFile]);
if (crypto.createHash('sha256').update(fs.readFileSync(verifyFile)).digest('hex') !== checksum) throw new Error('Uploaded bytes do not match; manifest was not published.');
fs.unlinkSync(verifyFile);
aws(['s3', 'cp', path.join(dir, 'manifest.json'), `s3://${bucket}/pos-app/ios-ota/${trust.channel}/manifest.json`, '--cache-control', 'no-store', '--content-type', 'application/json']);
console.log(`Published iOS ${trust.channel} ${version}`);
