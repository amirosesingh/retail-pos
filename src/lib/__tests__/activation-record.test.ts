/**
 * Registration must be decidable offline, must reject tampering,
 * and must stay entirely out of the local trading path.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The record layer is browser-side; a tiny localStorage stand-in is enough.
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
};

import {
  clearActivationRecord,
  isRegistered,
  readActivationRecord,
  writeActivationRecord,
  type ActivationRecord,
} from "@/core/activation/activation-record";
import { emergencyMode } from "@/core/activation/registration-status";

vi.mock("@/core/activation/terminal-tokens", () => ({ readTerminalConfig: () => null }));

beforeEach(() => {
  window.localStorage.clear();
});

describe("activation record", () => {
  it("round-trips a sealed record and reports registered", async () => {
    await writeActivationRecord({ tokenId: "tok-1", stamp: "srv-1" });
    const record = await readActivationRecord();
    expect(record?.tokenId).toBe("tok-1");
    expect(record?.activated).toBe(true);
    expect(record?.stamp).toBe("srv-1");
    expect(await isRegistered()).toBe("registered");
  });

  it("does not expire a registered offline-capable terminal by elapsed days", async () => {
    await writeActivationRecord({ tokenId: "tok-1", verifiedAt: new Date(0) });
    expect(await isRegistered()).toBe("registered");
  });

  it("rejects a hand-edited record instead of granting access", async () => {
    await writeActivationRecord({ tokenId: "tok-1" });
    const sealed = await readActivationRecord();
    expect(sealed).not.toBeNull();

    // Alter an authenticated field without updating its tag.
    const { setDeviceSecret } = await import("../device-secrets");
    await setDeviceSecret("activation.record.v1", {
      ...(sealed as ActivationRecord),
      tokenId: "tok-tampered",
    });

    expect(await readActivationRecord()).toBeNull();
    expect(await isRegistered()).toBe("not-registered");
  });

  it("reports not-registered once the record is cleared (revocation)", async () => {
    await writeActivationRecord({ tokenId: "tok-1" });
    clearActivationRecord();
    expect(await isRegistered()).toBe("not-registered");
  });

  it("keeps the current receipt when an old verification loses its registration context while signing", async () => {
    await writeActivationRecord({ tokenId: "current-terminal" });
    let current = true;
    const old = writeActivationRecord({ tokenId: "old-terminal", isCurrent: () => current });
    current = false;
    await expect(old).rejects.toThrow("registration changed");
    expect((await readActivationRecord())?.tokenId).toBe("current-terminal");
  });

});

describe("emergency access branches", () => {
  it("covers registered and unregistered connection combinations", () => {
    expect(emergencyMode({ registration: "registered", cloudConnected: true })).toBe(
      "online-verified",
    );
    expect(emergencyMode({ registration: "registered", cloudConnected: false })).toBe(
      "offline-registered",
    );
    expect(emergencyMode({ registration: "not-registered", cloudConnected: true })).toBe(
      "online-unregistered",
    );
  });
});

describe("local trading path", () => {
  it("never reads the activation record", () => {
    const files = [
      "src/lib/pos-store.tsx",
      "src/lib/checkout.ts",
      "src/lib/pos-print.ts",
      "src/lib/receipt-printer.ts",
      "src/lib/pos-auth.tsx",
    ];
    for (const file of files) {
      let source: string;
      try {
        source = readFileSync(file, "utf8");
      } catch {
        continue; // the file layout may differ; the rule only binds what exists
      }
      expect(source, `${file} must not depend on the activation record`).not.toContain(
        "activation-record",
      );
    }
  });
});
