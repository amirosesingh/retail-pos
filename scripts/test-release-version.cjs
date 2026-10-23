const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compareRelease, displayVersion } = require('./release-version.cjs');
test('stable revisions preserve base version and compare numerically', () => {
  assert.equal(displayVersion('1.4.77+revision.1'), '1.4.77 (1)');
  assert.equal(compareRelease('1.4.77+revision.1', '1.4.77'), 1);
  assert.equal(compareRelease('1.4.77+revision.10', '1.4.77+revision.2'), 1);
  assert.equal(compareRelease('1.4.77+revision.1', '1.4.78'), -1);
  assert.equal(compareRelease('1.4.77', '1.4.77+revision.1'), -1);
  assert.equal(compareRelease('1.4.77+other.1', '1.4.77'), 0);
  assert.equal(compareRelease('1.4.77-beta.2', '1.4.77-beta.1'), 1);
});
