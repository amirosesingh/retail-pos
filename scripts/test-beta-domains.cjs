const { test } = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('../workers/beta-web-domains/index.mjs');

test('beta domains keep bodies, credentials and paths on the fixed beta upstream', async () => {
  const { routeBeta } = await modulePromise;
  const request = new Request('https://beta-pos.luckycharmsdnbhd.com/api/check?q=1', {
    method: 'POST', body: 'payload', headers: { origin: 'https://beta-pos.luckycharmsdnbhd.com', authorization: 'Bearer test', cookie: 'test=session' },
  });
  const response = await routeBeta(request, async upstream => {
    assert.equal(upstream.url, 'https://beta-retail-pos.amirosesingh.workers.dev/api/check?q=1');
    assert.equal(upstream.headers.get('origin'), 'https://beta-retail-pos.amirosesingh.workers.dev');
    assert.equal(upstream.headers.get('authorization'), 'Bearer test');
    assert.equal(upstream.headers.get('cookie'), 'test=session');
    assert.equal(await upstream.text(), 'payload');
    return new Response('ok', { headers: { 'set-cookie': 'test=next; Secure; HttpOnly; SameSite=Lax' } });
  });
  assert.equal(await response.text(), 'ok');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
});

test('external origins stay external and production domains cannot use the beta router', async () => {
  const { routeBeta } = await modulePromise;
  const response = await routeBeta(new Request('https://pos.luckycharmsdnbhd.com/'), () => { throw Error('Must not forward production'); });
  assert.equal(response.status, 404);
  await routeBeta(new Request('https://beta-member.luckycharmsdnbhd.com/join', { headers: { origin: 'https://attacker.invalid', 'cloudflare-workers-version-overrides': 'injected' } }), async upstream => {
    assert.equal(upstream.headers.get('origin'), 'https://attacker.invalid');
    assert.equal(upstream.headers.has('cloudflare-workers-version-overrides'), false);
    return new Response(null, { status: 302, headers: { location: '/membership' } });
  }).then(r => assert.equal(r.headers.get('location'), 'https://beta-member.luckycharmsdnbhd.com/membership'));
});

test('beta password association is served only for a configured signing team', async () => {
  const { routeBeta } = await modulePromise;
  const url = 'https://beta-pos.luckycharmsdnbhd.com/.well-known/apple-app-site-association';
  assert.equal((await routeBeta(new Request(url), () => { throw Error('Do not proxy association'); })).status, 404);
  const response = await routeBeta(new Request(url), () => { throw Error('Do not proxy association'); }, { IOS_BETA_TEAM_ID: 'ABCDEFGHIJ' });
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.deepEqual(await response.json(), { webcredentials: { apps: ['ABCDEFGHIJ.com.luckycharms.pos.beta'] } });
});
