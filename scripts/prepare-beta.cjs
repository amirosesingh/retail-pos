const fs = require('node:fs');
const path = require('node:path');
const semver = require('semver');
const BETA_BASE = 'https://updatecms.luckycharmsdnbhd.com/pos-app/beta';
function betaVersion(base, sequence) {
  const stable = semver.parse(base);
  if (!stable || stable.prerelease.length || !Number.isSafeInteger(sequence) || sequence < 1) throw new Error('Invalid beta version inputs.');
  return `${stable.major}.${stable.minor}.${stable.patch + 1}-beta.${sequence}`;
}
function prepareBeta(root, version) {
  if (!/^\d+\.\d+\.\d+-beta\.[1-9]\d*$/.test(version) || !semver.valid(version)) throw new Error('Expected a beta prerelease version.');
  const file = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  pkg.name = 'retail-pos-beta';
  pkg.version = version;
  pkg.build.appId = 'app.lovable.pos.beta';
  pkg.build.productName = 'Retail Beta';
  pkg.build.detectUpdateChannel = false;
  pkg.build.win.artifactName = 'Retail Setup ${version}.exe';
  pkg.build.publish = [{ provider: 'generic', url: `${BETA_BASE}/latest/`, channel: 'latest' }];
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
  const lockFile = path.join(root, 'package-lock.json');
  const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  lock.name = pkg.name;
  lock.version = version;
  if (lock.packages?.['']) Object.assign(lock.packages[''], { name: pkg.name, version });
  fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'src/version.ts'), `// Generated for a beta artifact; never commit this build output.\nexport const APP_VERSION = "${version}";\n`);
}
module.exports = { betaVersion, prepareBeta, BETA_BASE };
if (require.main === module) {
  try {
    if (process.argv[2] === '--next') console.log(betaVersion(require('../package.json').version, Number(process.argv[3])));
    else prepareBeta(path.resolve(__dirname, '..'), process.env.BETA_VERSION);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
