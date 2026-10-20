const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const semver = require('semver');
const root = path.resolve(__dirname, '..');
const trustPath = path.join(root, 'ios-ota.public.json');
const action = process.argv[2];
const run = (file, args = [], env = {}) => execFileSync(process.execPath, [file, ...args], { cwd: root, env: { ...process.env, ...env }, stdio: 'inherit', windowsHide: true });
const nativeEnv = { POS_RELEASE_CHANNEL: 'beta', POS_MOBILE_TARGET: 'ios' };
if (action === 'keygen') {
  const dir = path.join(root, '.ota-private'); fs.mkdirSync(dir, { recursive: true });
  const filename = path.join(dir, 'manifest-ed25519.pem');
  if (fs.existsSync(filename)) throw new Error('Signing key already exists; refusing to replace it.');
  const pair = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(filename, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
  const publicKey = Buffer.from(pair.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64');
  const trust = JSON.parse(fs.readFileSync(trustPath)); trust.publicKey = publicKey;
  fs.writeFileSync(trustPath, JSON.stringify(trust, null, 2) + '\n');
  console.log('Private key stored in ignored .ota-private/manifest-ed25519.pem. Back it up securely offline. Public key updated.');
} else if (action === 'build' || action === 'sync') {
  run(path.join(root, 'scripts/mobile-build.cjs'), [], nativeEnv);
  if (action === 'sync') run(path.join(root, 'node_modules/@capacitor/cli/bin/capacitor'), ['sync', 'ios'], nativeEnv);
} else if (action === 'package') {
  // Always create an iOS shell here: a preceding Android build uses the same output folder.
  run(path.join(root, 'scripts/mobile-build.cjs'), [], nativeEnv);
  const trust = JSON.parse(fs.readFileSync(trustPath));
  const version = process.env.OTA_VERSION || `1.4.75-beta.${new Date().toISOString().replace(/[^0-9]/g, '')}`;
  if (!semver.valid(version)) throw new Error('OTA_VERSION must be a semantic version.');
  const dir = path.join(root, 'ota-artifacts', version);
  if (fs.existsSync(dir)) throw new Error('Version directory already exists; release versions are immutable.');
  fs.mkdirSync(dir, { recursive: true });
  run(path.join(root, 'node_modules/@capgo/cli/dist/index.js'), ['bundle', 'zip', trust.appId, '--path', 'capacitor-shell', '--bundle', version, '--name', path.join(dir, 'bundle.zip'), '--json']);
  const zip = fs.readFileSync(path.join(dir, 'bundle.zip'));
  const checksum = crypto.createHash('sha256').update(zip).digest('hex');
  const keyfile = process.env.OTA_PRIVATE_KEY_FILE;
  if (!keyfile) throw new Error('Set OTA_PRIVATE_KEY_FILE to the offline signing key path.');
  const privateKey = crypto.createPrivateKey(fs.readFileSync(keyfile));
  const rawPublic = Buffer.from(crypto.createPublicKey(privateKey).export({ format: 'jwk' }).x, 'base64url').toString('base64');
  if (rawPublic !== trust.publicKey) throw new Error('Signing key does not match the key embedded in this IPA.');
  const minBuild = Number(process.env.OTA_MIN_BUILD), maxBuild = Number(process.env.OTA_MAX_BUILD);
  if (!Number.isSafeInteger(minBuild) || minBuild < 1 || !Number.isSafeInteger(maxBuild) || maxBuild < minBuild) throw new Error('Explicit OTA_MIN_BUILD and OTA_MAX_BUILD are required.');
  if (zip.length > 100000000) throw new Error('Bundle exceeds the 100 MB limit.');
  const percent = Number(process.env.OTA_ROLLOUT_PERCENT || 0);
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new Error('Invalid rollout percentage.');
  const now = Date.now();
  const payload = Buffer.from(JSON.stringify({ schema: 1, version, appId: trust.appId, platform: 'ios', channel: trust.channel, url: `${trust.origin}/pos-app/ios-ota/releases/${version}/bundle.zip`, checksum, size: zip.length, notes: process.env.OTA_RELEASE_NOTES || 'Beta interface update', minBuild, maxBuild, issuedAt: now, expiresAt: now + 7 * 86400000, rollout: { percent, salt: version, stopped: process.env.OTA_STOP === 'true' } }));
  const envelope = { payload: payload.toString('base64'), signature: crypto.sign(null, payload, privateKey).toString('base64') };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(envelope));
  console.log(`Prepared signed ${version}; checksum ${checksum}. Nothing published.`);
} else { throw new Error('Usage: node scripts/ios-ota.cjs keygen|build|sync|package'); }
