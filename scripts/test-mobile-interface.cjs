const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkMobileInterface } = require('./check-mobile-interface.cjs');
test('requires packaged UI resources while allowing runtime database code', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-local-interface-'));
  try {
    fs.writeFileSync(path.join(root, 'app.js'), 'fetch("https://configured-api.example/data")');
    fs.writeFileSync(path.join(root, 'app.css'), 'body{font-family:system-ui}');
    const html = '<script src="/app.js"></script><link rel="stylesheet" href="/app.css">';
    checkMobileInterface(root, html);
    assert.throws(() => checkMobileInterface(root, '<script src="https://example.com/app.js"></script>'), /remote asset/);
    assert.throws(() => checkMobileInterface(root, '<script src="/missing.js"></script>'), /Missing packaged/);
    fs.writeFileSync(path.join(root, 'app.css'), '@font-face{src:url(https://example.com/font.woff2)}');
    assert.throws(() => checkMobileInterface(root, html), /remote asset/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
