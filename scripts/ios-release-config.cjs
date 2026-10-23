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
  let project = source.replace(pattern, `PRODUCT_BUNDLE_IDENTIFIER = ${config.appId};`);
  if (!project.includes('CODE_SIGN_ENTITLEMENTS = App/App.entitlements;')) {
    const style = /CODE_SIGN_STYLE = Automatic;/g;
    if ([...project.matchAll(style)].length !== 2) throw new Error('Unexpected iOS signing configurations.');
    project = project.replace(style, 'CODE_SIGN_ENTITLEMENTS = App/App.entitlements;\n\t\t\t\tCODE_SIGN_STYLE = Automatic;');
  }
  fs.writeFileSync(file, project);
  const domain = config.channel === 'beta' ? 'beta-pos.luckycharmsdnbhd.com' : 'pos.luckycharmsdnbhd.com';
  fs.writeFileSync(path.join(root, 'ios/App/App/App.entitlements'),
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
    '<plist version="1.0"><dict><key>com.apple.developer.associated-domains</key><array>' +
    `<string>webcredentials:${domain}</string>` + '</array></dict></plist>\n');
  const plist = path.join(root, 'ios/App/App/Info.plist');
  fs.writeFileSync(plist, fs.readFileSync(plist, 'utf8').replace(
    /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/,
    `$1${config.name}$2`,
  ));
}
module.exports = { iosReleaseConfig, prepareIosProject };
