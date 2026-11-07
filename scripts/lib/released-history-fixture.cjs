// Test-only execution of the released history contract against owned fixtures.
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { createRequire } = require("node:module");
const { runInThisContext } = require("node:vm");
const snapshot = require("../../src/lib/__tests__/fixtures/history-scope-legacy-1.4.82.json");

const sourceHashes = {
  "electron/jobs/bootstrap.cjs": "7d13ba99d2d14d67ad0f25569b191cb7292af38a28ff2f2b864afcaaf11ab497",
  "electron/sync/history-index-protocol.cjs": "262a8f0b604e1c39ef617ffb3a7df2ec4ef7d3983992006edb81233c9acee078",
};

function releasedHistoryModule(path) {
  assert.equal(snapshot.revision, "980d6b2f1c18867518b08243c7eb72083230f53a");
  assert(Object.hasOwn(sourceHashes, path));
  const { source, sha256 } = snapshot.sources[path];
  assert.equal(sha256, sourceHashes[path]);
  assert.equal(createHash("sha256").update(source).digest("hex"), sha256);
  const filename = require.resolve("../../" + path);
  const legacyModule = { exports: {} };
  const evaluate = runInThisContext("(function(require,module,exports){\n" + source + "\n})", { filename: "released-1.4.82/" + path });
  evaluate(createRequire(filename), legacyModule, legacyModule.exports);
  return legacyModule.exports;
}

module.exports = { releasedHistoryModule };
