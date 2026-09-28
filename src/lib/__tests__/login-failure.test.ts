import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  failureFromAuthError,
  failureFromReadiness,
  isConfigurationFailure,
  loginFailureMessage,
} from "../login-failure";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const have = { supabaseUrl: false, supabaseKey: false, backendUrl: false };

describe("sign-in failure categories", () => {
  it("names a missing or half-saved connection as a configuration problem", () => {
    expect(failureFromReadiness({ ready: false, state: "missing", have })).toBe(
      "configuration-required",
    );
    expect(failureFromReadiness({ ready: false, state: "incomplete", have })).toBe(
      "configuration-invalid",
    );
    expect(failureFromReadiness({ ready: false, state: "failed", have })).toBe(
      "configuration-invalid",
    );
    expect(failureFromReadiness({ ready: true, state: "ready", have })).toBeUndefined();
  });

  it("only reports a genuine refusal as wrong credentials", () => {
    expect(failureFromAuthError("Invalid login credentials")).toBe("invalid-credentials");
    expect(failureFromAuthError("Failed to fetch")).toBe("cloud-unreachable");
    expect(failureFromAuthError("Load failed")).toBe("cloud-unreachable");
    expect(failureFromAuthError("Invalid API key")).toBe("configuration-invalid");
    expect(failureFromAuthError("relation \"app_users\" does not exist")).toBe(
      "cloud-schema-missing",
    );
    expect(failureFromAuthError("User is banned")).toBe("account-inactive");
    expect(failureFromAuthError("")).toBe("unknown-error");
  });

  it("prefers stable Supabase Auth codes over changeable response wording", () => {
    expect(failureFromAuthError({ code: "invalid_credentials", message: "Login refused" })).toBe(
      "invalid-credentials",
    );
    expect(failureFromAuthError({ code: "user_banned", message: "Login refused" })).toBe(
      "account-inactive",
    );
    expect(
      failureFromAuthError({ code: "validation_failed", message: "missing email or phone" }),
    ).toBe("configuration-invalid");
  });

  it("offers a way out only for connection problems", () => {
    expect(isConfigurationFailure("cloud-unreachable")).toBe(true);
    expect(isConfigurationFailure("invalid-credentials")).toBe(false);
  });

  it("never leaks keys or tokens in the wording", () => {
    const all = (
      [
        "configuration-required",
        "configuration-invalid",
        "cloud-unreachable",
        "cloud-schema-missing",
        "terminal-not-activated",
        "branch-not-configured",
        "invalid-credentials",
        "account-inactive",
        "permission-denied",
        "local-backend-unavailable",
        "unknown-error",
      ] as const
    ).map(loginFailureMessage);
    for (const text of all) {
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toMatch(/sb_publishable|apikey|Bearer|token/i);
    }
  });
});

describe("start-up ordering and the sign-in gate", () => {
  it("restores terminal identity before applying the saved device connection", () => {
    const profile = read("src/lib/connection-profile.ts");
    const identity = profile.indexOf("await hydrateTerminalConfig()");
    const applied = profile.indexOf("initCloudConfigFromShell()");
    expect(identity).toBeGreaterThan(-1);
    expect(applied).toBeGreaterThan(identity);
  });

  it("checks saved configuration before contacting the cloud", () => {
    const auth = read("src/lib/pos-auth.tsx");
    const login = auth.indexOf("const login = useCallback");
    const hydration = auth.indexOf("await awaitProfileHydrated()", login);
    const readiness = auth.indexOf("await hasRequiredPlatformConfig()", login);
    const passwordAuth = auth.indexOf("supabase.auth.signInWithPassword", login);
    expect(hydration).toBeGreaterThan(login);
    expect(readiness).toBeGreaterThan(hydration);
    expect(passwordAuth).toBeGreaterThan(readiness);
    expect(auth.slice(login, passwordAuth)).not.toContain('.from("app_users").select("id")');
  });

  it("refuses entry when the role and profile cannot be read", () => {
    const auth = read("src/lib/pos-auth.tsx");
    expect(auth).toMatch(/permission-denied/);
    expect(auth).toMatch(/cashierLogin:/);
  });
});
