const fs = require('node:fs');
const path = require('node:path');
function iosReleaseConfig(channel = 'beta', base) {
  if (!['beta', 'stable'].includes(channel)) throw new Error('Invalid iOS release channel.');
  return {
    channel,
    appId: channel === 'beta' ? 'com.luckycharms.pos.beta' : 'com.luckycharms.pos',
    name: channel === 'beta' ? 'Retail Beta' : 'Retail',
    trust: channel === 'beta' ? base : {
      ...base, appId: 'com.luckycharms.pos', channel: 'production',
      endpoint: `${base.origin}/pos-app/ios-ota/production/manifest.json`,
    },
  };
}
function prepareIosProject(root, config) {
  const file = path.join(root, 'ios/App/App.xcodeproj/project.pbxproj');
  const source = fs.readFileSync(file, 'utf8');
  const pattern = /PRODUCT_BUNDLE_IDENTIFIER = com\.luckycharms\.pos(?:\.beta)?;/g;
  if ([...source.matchAll(pattern)].length !== 2) throw new Error('Unexpected iOS application targets.');
  fs.writeFileSync(file, source.replace(pattern, `PRODUCT_BUNDLE_IDENTIFIER = ${config.appId};`));
  const plist = path.join(root, 'ios/App/App/Info.plist');
  fs.writeFileSync(plist, fs.readFileSync(plist, 'utf8').replace(
    /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/,
    `$1${config.name}$2`,
  ));
}
module.exports = { iosReleaseConfig, prepareIosProject };
