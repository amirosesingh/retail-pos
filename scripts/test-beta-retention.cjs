const { test } = require('node:test');
const assert = require('node:assert/strict');
const { artifactVersion, planRetention, pruneBeta, parseReleaseList } = require('./prune-beta-releases.cjs');
const version = n => `1.4.75-beta.${n}`;
const releases = Array.from({ length: 12 }, (_, i) => ({ tag_name: `beta-v${version(i + 1)}`, prerelease: true, draft: false }));
const archive = n => `pos-app/beta/releases/beta-v${version(n)}-abcdef0/android/Retail-${version(n)}.apk`;

test('reads compact paginated metadata without downloading historical asset descriptions', () => {
  assert.deepEqual(parseReleaseList('beta-v1.4.75-beta.1\ttrue\tfalse\r\nbeta-v1.4.75-beta.2\ttrue\ttrue\n'), [
    { tag_name: 'beta-v1.4.75-beta.1', prerelease: true, draft: false },
    { tag_name: 'beta-v1.4.75-beta.2', prerelease: true, draft: true },
  ]);
  assert.deepEqual(parseReleaseList(''), []);
  assert.throws(() => parseReleaseList('beta-v1.4.75-beta.1\ttrue'), /Invalid/);
});

test('keeps exactly six newest betas in numeric order and never targets stable or pointers', () => {
  const protectedKeys = ['pos-app/latest/Retail Setup 1.4.74.exe', 'pos-app/beta/manifest.json', 'pos-app/beta/latest/latest.yml', 'pos-app/beta/latest/android/latest.json', 'pos-app/beta/unrecognized-file'];
  const keys = [...Array.from({ length: 12 }, (_, i) => archive(i + 1)), ...protectedKeys, archive(13)];
  const plan = planRetention([...releases, { tag_name: 'v1.4.74', prerelease: false }, { tag_name: 'beta-v1.4.75-beta.99', prerelease: true, draft: true }], keys, version(12));
  assert.deepEqual(plan.keep, [12, 11, 10, 9, 8, 7].map(version));
  assert.deepEqual(plan.removeKeys, [1, 2, 3, 4, 5, 6].map(archive));
  assert.equal(plan.removeReleases.length, 6);
  for (const key of protectedKeys) assert.ok(!plan.removeKeys.includes(key));
  assert.ok(!plan.removeKeys.includes(archive(13)), 'preserve newer incomplete uploads');
});

test('recognizes exact managed aliases, rejects traversal and mismatched filenames', () => {
  assert.equal(artifactVersion(`pos-app/beta/latest/Retail Setup ${version(1)}.exe.blockmap`), version(1));
  assert.equal(artifactVersion(`pos-app/beta/latest/${version(1)}.yml`), version(1));
  assert.equal(artifactVersion(`pos-app/beta/latest/android/Retail-${version(1)}.apk`), version(1));
  assert.equal(artifactVersion(archive(1).replace(`Retail-${version(1)}`, `Retail-${version(2)}`)), null);
  assert.equal(artifactVersion('pos-app/beta/../latest/latest.yml'), null);
});

test('refuses stale or incomplete release metadata before planning any deletion', () => {
  assert.throws(() => planRetention(releases, [], version(11)), /newer beta/);
  assert.throws(() => planRetention(releases, [], version(13)), /no published/);
  const small = planRetention(releases.slice(0, 4), [1, 2, 3, 4].map(archive), version(4));
  assert.equal(small.keep.length, 4);
  assert.equal(small.removeKeys.length, 0);
  assert.equal(small.removeReleases.length, 0);
});

test('checks all update pointers before cleanup and preserves active package paths', async () => {
  const removedKeys = [], removedTags = [];
  let disagree = true;
  const store = {
    read(key) { return Buffer.from(JSON.stringify({ version: disagree && key.endsWith('latest.yml') ? version(11) : version(12) })); },
    list: () => [1, 7, 12].map(archive),
    remove: key => removedKeys.push(key),
  };
  const github = { list: () => releases, remove: tag => removedTags.push(tag) };
  await assert.rejects(pruneBeta(store, github, version(12)), /pointers disagree/);
  assert.deepEqual(removedKeys, []); assert.deepEqual(removedTags, []);
  disagree = false;
  await pruneBeta(store, github, version(12));
  assert.deepEqual(removedKeys, [archive(1)]);
  assert.deepEqual(removedTags, [1, 2, 3, 4, 5, 6].map(n => `beta-v${version(n)}`));
});
