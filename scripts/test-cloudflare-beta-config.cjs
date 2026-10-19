const { test } = require('node:test');
const assert = require('node:assert/strict');
const { betaConfig } = require('./prepare-cloudflare-beta.cjs');

test('beta app deployment retains build outputs and cannot claim production domains', () => {
  const generated = {
    name: 'retail-pos', main: 'index.mjs', assets: { directory: '../client', binding: 'ASSETS' },
    compatibility_flags: ['nodejs_compat'], routes: [{ pattern: 'pos.luckycharmsdnbhd.com', custom_domain: true }],
    vars: { OPERATOR_SETTING: 'do-not-copy' }, env: { production: { name: 'retail-pos' } },
  };
  const output = betaConfig(generated);
  assert.equal(output.name, 'retail-pos-beta-domains');
  assert.equal(output.main, generated.main);
  assert.deepEqual(output.assets, generated.assets);
  assert.deepEqual(output.routes.map(r => r.pattern), ['beta-pos.luckycharmsdnbhd.com', 'beta-member.luckycharmsdnbhd.com', 'beta-redeem.luckycharmsdnbhd.com']);
  assert.equal(output.observability.enabled, true);
  assert.equal(output.keep_vars, true);
  assert.equal(output.preview_urls, false);
  assert.equal(output.workers_dev, false);
  assert.equal(output.vars, undefined);
  assert.equal(output.env, undefined);
  assert.equal(generated.name, 'retail-pos');
  assert.equal(generated.vars.OPERATOR_SETTING, 'do-not-copy');
});

test('an unrelated generated worker cannot be turned into a beta POS deployment', () => {
  assert.throws(() => betaConfig({ name: 'another-worker' }), /Expected the generated retail-pos/);
});
