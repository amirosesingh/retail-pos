import { describe, expect, it } from "vitest";
import { iosInstallSafe } from "../install-safety";
import { readFileSync } from "node:fs";
const login = { pathname: "/", confirmedPath: null, edited: false, visible: true, blocked: false, transactionSafe: true };
describe("iOS update notice and restart safety", () => {
  it("requires explicit confirmation to restart on the login screen", () => {
    expect(iosInstallSafe(login)).toBe(false);
    expect(iosInstallSafe({ ...login, confirmedPath: "/" })).toBe(true);
  });
  it.each([{edited:true}, {visible:false}, {blocked:true}, {transactionSafe:false}, {pathname:"/selling"}])("defers confirmed install when safety changes: %o", change => {
    expect(iosInstallSafe({ ...login, confirmedPath: "/", ...change })).toBe(false);
  });
  it("retains safe automatic installation on the software update page", () => {
    expect(iosInstallSafe({ ...login, pathname: "/settings/updates" })).toBe(true);
  });
  it("mounts the beta notice outside registration/login gates and keeps non-iOS builds inert", () => {
    const root=readFileSync('src/routes/__root.tsx','utf8');
    expect(root).toContain('<IosUpdateBanner />');
    expect(root.indexOf('{RELEASE_CHANNEL === "beta" && <AppUpdateNotices />}')).toBeLessThan(root.indexOf('<ConnectionProfileBoot>'));
    const stub=readFileSync('src/platform-config/ios-ota.tsx','utf8');
    expect(stub).toContain('export function IosUpdateBanner() { return null; }');
    expect(stub).not.toContain('@capgo');
  });
});
