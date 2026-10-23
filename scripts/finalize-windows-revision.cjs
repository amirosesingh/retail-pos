const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { revision } = require('./release-version.cjs');
const { validateRelease } = require('./publish-windows-release.cjs');

// Electron Builder omits SemVer metadata from generated artifact names.
// Change only the local, unpublished artifact names and manifest identity.
function finalizeWindowsRevision(directory, version) {
  if (!revision(version)) return;
  const base = version.split('+')[0];
  const manifest = path.join(directory, 'latest.yml');
  const metadata = yaml.load(fs.readFileSync(manifest, 'utf8'));
  if (metadata.version === version) {
    validateRelease(directory, version);
    return;
  }
  validateRelease(directory, base);
  const oldName = `Retail Setup ${base}.exe`;
  const newName = `Retail Setup ${version}.exe`;
  for (const suffix of ['', '.blockmap']) {
    if (fs.existsSync(path.join(directory, newName + suffix)))
      throw new Error('Revision artifact already exists; refusing replacement.');
  }
  for (const suffix of ['', '.blockmap'])
    fs.renameSync(path.join(directory, oldName + suffix), path.join(directory, newName + suffix));
  metadata.version = version;
  metadata.path = newName;
  metadata.files[0].url = newName;
  fs.writeFileSync(manifest, yaml.dump(metadata));
  validateRelease(directory, version);
}
module.exports = { finalizeWindowsRevision };
