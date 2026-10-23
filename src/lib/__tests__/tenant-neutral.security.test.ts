/**
 * A build carries no tenant, and the doors that face the open internet are
 * braked.
 *
 * Anyone handed an APK, an installer or the web bundle must receive a client
 * that knows no project address and no key: the operator provisions the device
 * (activation, or Settings → Database & Cloud Connection). Alongside that, the
 * two credential surfaces that anyone can reach — the cashier PIN sign-in and
 * the recovery PIN — must count wrong attempts and lock out.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

describe("tenant-neutral builds", () => {
  it("no Supabase project address or publishable key is baked into the source", () => {
    const config = read("src", "lib", "external-supabase-config.ts");
    expect(config).not.toMatch(/https:\/\/[a-z0-9]{20}\.supabase\.co/);
    expect(config).not.toMatch(/sb_publishable_[A-Za-z0-9_-]+/);
  });

  it("the phone shell is refused if it still carries cloud configuration", () => {
    const build = read("scripts", "mobile-build.cjs");
    expect(build).toContain("__POS_CONFIG__");
    expect(build).toMatch(/throw new Error\([\s\S]{0,200}tenant identity/);
  });
});

describe("public credential surfaces are throttled", () => {
  it("cashier PIN sign-in counts failures by account and by caller address", () => {
    const route = read("src", "routes", "api", "public", "cashier-login.ts");
    expect(route).toContain("pin-throttle.server");
    expect(route).toContain("throttleFail");
    expect(route).toContain("throttleReset");
    const login = read("src", "lib", "cashier-login.server.ts");
    const sourceThrottle = read("src", "lib", "pin-request-throttle.server.ts");
    expect(login).toContain("beginPinRequest");
    expect(sourceThrottle).toContain("cashier-ip:");
    expect(route).toContain("429");
  });

  it("the recovery code locks out after repeated wrong entries", () => {
    expect(read("src", "lib", "emergency-pin.ts")).toMatch(/guesses\.count \+= 1/);
  });
});

describe("the staff roster is not public", () => {
  it("the till roster endpoint requires a registered terminal token", () => {
    const route = read("src", "routes", "api", "public", "terminal-staff.ts");
    expect(route).toContain("verifyRelayCaller");
    expect(route).toContain("terminalToken");
    expect(route).toContain("401");
  });

  it("PIN length is never published", () => {
    expect(read("src", "lib", "staff-admin.server.ts")).toMatch(/pinLength: 0/);
  });
});
