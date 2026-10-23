const fs = require('node:fs');
const path = require('node:path');

function configureUpdateDownload(root) {
  const java = path.join(root, 'android/app/src/main/java');
  const activities = [];
  function find(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) find(file);
      else if (item.name === 'MainActivity.java') activities.push(file);
    }
  }
  find(java);
  if (activities.length !== 1) throw new Error('Expected exactly one generated MainActivity.java.');
  const activity = activities[0];
  let source = fs.readFileSync(activity, 'utf8');
  const registration = 'registerPlugin(com.luckycharms.pos.PosUpdateDownloadPlugin.class);';
  if (!source.includes(registration)) {
    if (/void\s+onCreate\s*\(/.test(source)) {
      if (!/super\.onCreate\(savedInstanceState\);/.test(source)) throw new Error('Unknown MainActivity onCreate; cannot register update downloader safely.');
      source = source.replace('super.onCreate(savedInstanceState);', `${registration}\n        super.onCreate(savedInstanceState);`);
    } else {
      source = source.replace(/(extends\s+BridgeActivity\s*\{)/, `$1\n    @Override\n    public void onCreate(android.os.Bundle savedInstanceState) {\n        ${registration}\n        super.onCreate(savedInstanceState);\n    }\n`);
      if (!source.includes(registration)) throw new Error('Unknown generated MainActivity.');
    }
    fs.writeFileSync(activity, source);
  }
  const folder = path.join(java, 'com/luckycharms/pos');
  const appearanceRegistration = 'registerPlugin(com.luckycharms.pos.PosAppearancePlugin.class);';
  if (!source.includes(appearanceRegistration)) {
    if (!source.includes('super.onCreate(savedInstanceState);')) throw new Error('Unknown MainActivity; cannot register native appearance safely.');
    source = source.replace('super.onCreate(savedInstanceState);', `${appearanceRegistration}\n        super.onCreate(savedInstanceState);`);
    fs.writeFileSync(activity, source);
  }
  fs.mkdirSync(folder, { recursive: true });
  fs.copyFileSync(path.join(__dirname, '../native/android/PosUpdateDownloadPlugin.java'), path.join(folder, 'PosUpdateDownloadPlugin.java'));
  fs.copyFileSync(path.join(__dirname, '../native/android/PosAppearancePlugin.java'), path.join(folder, 'PosAppearancePlugin.java'));
  const credentialsRegistration = 'registerPlugin(com.luckycharms.pos.PosPasswordAutofillPlugin.class);';
  if (!source.includes(credentialsRegistration)) {
    if (!source.includes('super.onCreate(savedInstanceState);')) throw new Error('Unknown MainActivity; cannot register password manager safely.');
    source = source.replace('super.onCreate(savedInstanceState);', `${credentialsRegistration}\n        super.onCreate(savedInstanceState);`);
    fs.writeFileSync(activity, source);
  }
  fs.copyFileSync(path.join(__dirname, '../native/android/PosPasswordAutofillPlugin.java'), path.join(folder, 'PosPasswordAutofillPlugin.java'));
  const gradleFile = path.join(root, 'android/app/build.gradle');
  let gradle = fs.readFileSync(gradleFile, 'utf8');
  if (!gradle.includes('androidx.credentials:credentials:1.6.0')) {
    gradle += '\n// System password manager for verified POS logins.\ndependencies {\n' +
      '    implementation "androidx.credentials:credentials:1.6.0"\n' +
      '    implementation "androidx.credentials:credentials-play-services-auth:1.6.0"\n}\n';
    fs.writeFileSync(gradleFile, gradle);
  }
}
module.exports = { configureUpdateDownload };
if (require.main === module) configureUpdateDownload(path.resolve(__dirname, '..'));
