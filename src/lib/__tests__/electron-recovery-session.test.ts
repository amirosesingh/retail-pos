import { createRequire } from "node:module";
import { beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const session = require("../../../electron/admin-session.cjs") as {
  grantRecovery: (code: string, now?: number) => boolean;
  clearRecovery: () => void;
  recoveryActive: () => boolean;
};

const codeAt = (date: Date) => {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${pad(date.getFullYear(), 4)}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}`;
};

describe("Electron recovery privilege", () => {
  beforeEach(() => session.clearRecovery());

  it("opens a short native repair session only for the current clock code", () => {
    const now = new Date(2026, 9, 6, 15, 30, 20).getTime();
    expect(session.grantRecovery("000000000000", now)).toBe(false);
    expect(session.recoveryActive()).toBe(false);
    expect(session.grantRecovery(codeAt(new Date(now)), now)).toBe(true);
    expect(session.recoveryActive()).toBe(true);
    session.clearRecovery();
    expect(session.recoveryActive()).toBe(false);
  });
});
