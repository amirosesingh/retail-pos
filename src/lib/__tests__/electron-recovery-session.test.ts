import { createRequire } from "node:module";
import { beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const session = require("../../../electron/admin-session.cjs") as {
  grantRecovery: () => void;
  clearRecovery: () => void;
  recoveryActive: () => boolean;
};

describe("Electron recovery privilege", () => {
  beforeEach(() => session.clearRecovery());

  it("opens and clears the short native repair session granted by main", () => {
    session.grantRecovery();
    expect(session.recoveryActive()).toBe(true);
    session.clearRecovery();
    expect(session.recoveryActive()).toBe(false);
  });
});
