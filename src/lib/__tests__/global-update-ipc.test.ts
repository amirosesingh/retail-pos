import { createRequire } from "node:module";
import { expect, it } from "vitest";
const require = createRequire(import.meta.url);
const session = require("../../../electron/admin-session.cjs");
const gate = require("../../../electron/ipc-privilege.cjs");

it("allows software update IPC before sign-in while retaining administrative gates", () => {
  session.clear(); session.clearRecovery();
  for (const channel of ["update:status", "update:check", "update:download", "update:install", "update:download-install"]) {
    expect(gate.levelFor(channel, [])).toBe(gate.OPEN);
    expect(gate.allowed(channel)).toBe(true);
  }
  for (const channel of ["health:rollback", "local:rollback"]) {
    expect(gate.allowed(channel)).toBe(false);
  }
});
