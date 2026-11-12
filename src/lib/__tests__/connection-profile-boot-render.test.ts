import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { expect, it, vi } from "vitest";

vi.mock("@/platform-config/platform", () => ({ isTerminalApp: () => true }));
vi.mock("@/platforms/mobile/mobile-storage", () => ({ hydrateNativeStorage: async () => {}, flushNativeStorage: async () => {} }));
vi.mock("@/core/activation/terminal-tokens", () => ({ hydrateTerminalConfig: async () => null }));
vi.mock("../secure-cloud-config", () => ({ initCloudConfigFromShell: async () => {} }));
vi.mock("../backend-config", () => ({ hydrateBackendUrl: async () => {} }));
import { RegistrationRestoreError, isRegistrationRestoreError, registrationRestoreMessage } from "../connection-profile";

const source = readFileSync("src/routes/__root.tsx", "utf8");
const from = source.indexOf("function ConnectionProfileBoot(");
const to = source.indexOf("/** The shell survives", from);
const compiled = ts.transpileModule(source.slice(from, to) + "\nexports.Boot = ConnectionProfileBoot;", {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;

/** Render the real startup component and its effect with only routing/storage adapters isolated. */
function fixture(recovery = false) {
  const slots: unknown[] = [];
  let cursor = 0;
  let effectDeps: readonly unknown[] | undefined;
  let cleanup: (() => void) | undefined;
  const pending: Array<() => void> = [];
  const state = { hydrated: false };
  const hydrate = vi.fn(async () => {});
  const notify = vi.fn();
  const show = vi.fn();
  const module = { exports: {} as { Boot: React.ComponentType<{ children: React.ReactNode }> } };
  runInNewContext(compiled, {
    module, exports: module.exports, React,
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useEffect(effect: () => undefined | (() => void), deps: readonly unknown[]) {
      if (effectDeps && deps.every((value, index) => Object.is(value, effectDeps![index]))) return;
      effectDeps = deps;
      pending.push(() => { cleanup?.(); cleanup = effect() ?? undefined; });
    },
    useLocation: ({ select }: { select: (location: { pathname: string }) => unknown }) => select({ pathname: recovery ? "/recovery" : "/" }),
    isRecoveryPath: (pathname: string) => pathname === "/recovery",
    hydrateConnectionProfile: hydrate,
    isConnectionProfileHydrated: () => state.hydrated,
    isRegistrationRestoreError, registrationRestoreMessage,
    notifyError: notify,
    showNotification: show,
    TillLoader: ({ message }: { message: string }) => React.createElement("p", null, message),
    EmergencyAccessLink: () => React.createElement("a", { href: "/recovery" }, "Emergency access"),
  });
  return {
    state, hydrate, notify, show,
    render() {
      cursor = 0;
      const html = renderToStaticMarkup(React.createElement(module.exports.Boot, null, React.createElement("div", null, "Protected POS")));
      pending.splice(0).forEach(effect => effect());
      return html;
    },
    stop() { cleanup?.(); },
  };
}

const settle = async () => { for (let count = 0; count < 10; count++) await Promise.resolve(); };

it("identifies a registration mismatch on the main screen without claiming saved connection read failure", async () => {
  const f = fixture();
  f.hydrate.mockRejectedValueOnce(new RegistrationRestoreError({ code: "EACTIVATION_RECOVERY_BINDING", message: "private-proof https://private.example" }));
  expect(f.render()).toContain("Restoring secure connection");
  await settle();
  const html = f.render();
  expect(html).toContain("saved connection settings are available");
  expect(html).toContain("previous terminal binding");
  expect(html).toContain("Retry registration");
  expect(html).toContain("Emergency access");
  expect(html).not.toContain("Could not restore your saved connection");
  expect(html).not.toMatch(/private-proof|https:\/\/private|Protected POS/);
  expect(f.show).toHaveBeenCalledWith(registrationRestoreMessage("EACTIVATION_RECOVERY_BINDING"), "error");
  expect(f.notify).not.toHaveBeenCalled();
  f.stop();
});

it("retains the genuine saved-connection failure and strict startup gate", async () => {
  const f = fixture(); f.hydrate.mockRejectedValueOnce(new Error("private vault details"));
  f.render(); await settle();
  const html = f.render();
  expect(html).toContain("Could not restore your saved connection");
  expect(html).toContain("Retry connection");
  expect(html).toContain("Emergency access");
  expect(html).not.toMatch(/private vault details|Protected POS|Retry registration/);
  expect(f.notify).toHaveBeenCalledWith(expect.any(Error), "Restoring database connection");
  expect(f.show).not.toHaveBeenCalled();
  f.stop();
});

it("keeps emergency access reachable when registration restoration fails", async () => {
  const f = fixture(true); f.hydrate.mockRejectedValueOnce(new RegistrationRestoreError({ code: "EACTIVATION_RECOVERY_PROOF" }));
  expect(f.render()).toContain("Protected POS");
  await settle();
  expect(f.render()).toContain("Protected POS");
  f.stop();
});

it("opens ordinary startup only after the real hydration readiness contract succeeds", async () => {
  const f = fixture();
  f.hydrate.mockImplementationOnce(async () => { f.state.hydrated = true; });
  expect(f.render()).not.toContain("Protected POS"); await settle();
  expect(f.render()).toContain("Protected POS");
  f.stop();
});

it("never displays an unknown registration error's private details in the retry notification", async () => {
  const f = fixture();
  f.hydrate.mockRejectedValueOnce(new RegistrationRestoreError({ code: "PRIVATE_UNKNOWN", message: "secret-token https://private.example" }));
  f.render(); await settle();
  expect(f.show).toHaveBeenCalledWith(registrationRestoreMessage("PRIVATE_UNKNOWN"), "error");
  expect(JSON.stringify(f.show.mock.calls)).not.toMatch(/secret-token|private\.example|PRIVATE_UNKNOWN/);
  expect(f.notify).not.toHaveBeenCalled();
  expect(f.render()).not.toContain("Protected POS");
  f.stop();
});

it("does not show a late retry failure after the startup effect is unmounted", async () => {
  const f = fixture();
  let reject!: (cause: unknown) => void;
  f.hydrate.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
  f.render(); f.stop();
  reject(new RegistrationRestoreError({ code: "EACTIVATION_RECOVERY_BINDING" }));
  await settle();
  expect(f.show).not.toHaveBeenCalled();
  expect(f.notify).not.toHaveBeenCalled();
});
