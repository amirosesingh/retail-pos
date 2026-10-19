const fs = require('node:fs');
const path = require('node:path');

const BETA_HOSTS = ['beta-pos', 'beta-member', 'beta-redeem'].map(name => `${name}.luckycharmsdnbhd.com`);

function betaConfig(generated) {
  if (generated.name !== 'retail-pos') throw new Error('Expected the generated retail-pos web configuration');
  const config = {
    ...generated,
    name: 'retail-pos-beta-domains',
    keep_vars: true,
    workers_dev: false,
    preview_urls: false,
    observability: { ...generated.observability, enabled: true },
    routes: BETA_HOSTS.map(pattern => ({ pattern, custom_domain: true })),
  };
  // Runtime database configuration belongs to the operator in Cloudflare.
  // Never copy production variables or named environments into beta.
  delete config.vars;
  delete config.env;
  return config;
}

if (require.main === module) {
  const source = path.resolve('dist/server/wrangler.json');
  const target = path.join(path.dirname(source), 'wrangler.beta.json');
  fs.writeFileSync(target, JSON.stringify(betaConfig(JSON.parse(fs.readFileSync(source, 'utf8'))), null, 2));
  console.log('Prepared retail-pos-beta-domains; only the three beta custom domains are included.');
}

module.exports = { betaConfig };
