"use strict";
// Real React/Radix rendering with synthetic IPC/auth only. No Electron profile,
// operator database, external network, credentials or live application UI.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { pathToFileURL } = require("node:url"), { chromium } = require("@playwright/test");
async function main() {
  const root = process.cwd(), directory = path.join(root, ".tmp", "legacy-recovery-ui"); fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "index.html"), '<div id="root"></div><script type="module" src="/.tmp/legacy-recovery-ui/main.tsx"></script>');
  fs.writeFileSync(path.join(directory, "auth.ts"), `import {useSyncExternalStore} from 'react';
let auth={isAdmin:true,user:{staffId:'fixture-admin'},authUserId:'fixture-auth'};const listeners=new Set<()=>void>();
export const setAuth=(value:any)=>{auth={...auth,...value};listeners.forEach(fn=>fn());};
export const useAuth=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>auth);
`);
  fs.writeFileSync(path.join(directory, "main.tsx"), `import React from 'react';import{createRoot}from'react-dom/client';
import{LegacyShiftRecoveryReview}from'@/platforms/windows/components/LegacyShiftRecoveryReview';import{setAuth}from'./auth';import'@/styles.css';
const shiftId='11111111-1111-4111-8111-111111111111',captureKey='a'.repeat(64);
const summary={status:'CLOSED',openedAt:'2026-11-01T08:00:00.1234567Z',closedAt:'2026-11-01T21:00:00.1234567Z',countedCash:'12345678901234567890.12',countedCard:null,countedDigital:'20',expectedCash:'100',expectedCard:'0',expectedDigital:'20'};
const initial={list:{ok:true,available:true,items:[{shiftId,status:'CLOSED',openedAt:summary.openedAt,closedAt:summary.closedAt}]},preview:{ok:true,shiftId,captureKey,classification:'legacy-local-closing-needs-review',canApprove:true,local:summary,cloud:{...summary,status:'OPEN',closedAt:null}},approve:{ok:true,state:'PENDING'}};
const calls={list:[],preview:[],approve:[]},next={},pending={};
const invoke=(kind,args)=>{calls[kind].push(args);if(next[kind]==='defer'){delete next[kind];return new Promise(resolve=>pending[kind]=resolve);}return Promise.resolve(next[kind]??initial[kind]);};
window.pos={sync:{legacyRecovery:{list:value=>invoke('list',value),preview:value=>invoke('preview',value),approve:value=>invoke('approve',value)}}};
window.fixture={calls,initial,setAuth,set:(kind,value)=>next[kind]=value,defer:kind=>next[kind]='defer',resolve:(kind,value)=>{const done=pending[kind];delete pending[kind];done(value??initial[kind]);}};
createRoot(document.getElementById('root')).render(<LegacyShiftRecoveryReview/>);
`);
  const { createServer } = await import("vite"), react = (await import("@vitejs/plugin-react")).default, tailwind = (await import("@tailwindcss/vite")).default;
  const { popupRuntimeAliases } = await import(pathToFileURL(path.join(root, "scripts/popup-runtime-aliases.mjs")).href);
  let server, browser; let passed = 0;
  try {
    server = await createServer({ configFile: false, root, cacheDir: path.join(directory, ".vite"), plugins: [react(), tailwind()],
      resolve: { alias: [{ find: /^@\/lib\/pos-auth$/, replacement: path.join(directory, "auth.ts") }, ...popupRuntimeAliases(), { find: "@", replacement: path.join(root, "src") }] },
      server: { host: "127.0.0.1", port: 0, fs: { allow: [root, fs.realpathSync(path.join(root, "node_modules"))] } }, logLevel: "error" });
    await server.listen(); const origin = `http://127.0.0.1:${server.httpServer.address().port}`, url = origin + "/.tmp/legacy-recovery-ui/index.html";
    browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-gpu"] });
    const newPage = async width => {
      const page = await browser.newPage({ viewport: { width, height: 840 } });
      await page.route("**/*", route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
      await page.goto(url); await page.getByRole("button", { name: "Review saved closings" }).waitFor(); return page;
    };
    const inspect = async page => { await page.getByRole("button", { name: "Review saved closings" }).click(); await page.getByRole("button", { name: /CLOSED · 11111111/ }).click(); await page.getByLabel("Administrator review reason").waitFor(); };
    for (const width of [1440, 390]) {
      const page = await newPage(width); await inspect(page);
      assert.deepEqual(await page.evaluate(() => window.fixture.calls.list), [{ afterId: null, limit: 25 }]);
      assert.deepEqual(await page.evaluate(() => window.fixture.calls.preview), ["11111111-1111-4111-8111-111111111111"]);
      const save = page.getByRole("button", { name: "Save reviewed recovery" }); assert(await save.isDisabled());
      await page.getByLabel("Administrator review reason").fill("  Reviewed original cashier closing  ");
      await page.evaluate(() => window.fixture.defer("approve")); await save.dblclick({ force: true });
      await page.waitForTimeout(30); assert.equal(await page.evaluate(() => window.fixture.calls.approve.length), 1);
      const args = await page.evaluate(() => window.fixture.calls.approve[0]); assert.equal(args.captureKey, "a".repeat(64));
      assert.equal(args.reason, "Reviewed original cashier closing"); assert.match(args.recoveryId, /^[a-f0-9-]{36}$/);
      await page.evaluate(() => window.fixture.resolve("approve")); await page.getByText(/Cloud acceptance is not yet confirmed/).waitFor();
      assert.equal(await save.count(), 0);
      const bounds = await page.getByRole("dialog").evaluate(element => { const b = element.getBoundingClientRect(); return { left: b.left, right: b.right, overflow: element.scrollWidth > element.clientWidth + 1 }; });
      assert(bounds.left >= 0 && bounds.right <= width + 1 && !bounds.overflow, JSON.stringify({ width, ...bounds }));
      await page.screenshot({ path: path.join(directory, `review-${width}.png`), fullPage: true });
      const before = await page.evaluate(() => JSON.stringify(window.fixture.calls)); await page.waitForTimeout(150); assert.equal(await page.evaluate(() => JSON.stringify(window.fixture.calls)), before);
      passed++; console.log(`PASS actual React review/requiredreason/singleapprove/pendingtruth/layout/no-readloop ${width}px`); await page.close();
    }
    {
      const page = await newPage(1440); await inspect(page); await page.getByLabel("Administrator review reason").fill("Review retry reason");
      await page.evaluate(() => window.fixture.set("approve", { ok: false, error: "Temporary connection failure" }));
      await page.getByRole("button", { name: "Save reviewed recovery" }).click(); await page.getByRole("alert").getByText("Temporary connection failure").waitFor();
      await page.evaluate(() => window.fixture.set("approve", { ok: true, state: "PENDING" })); await page.getByRole("button", { name: "Save reviewed recovery" }).click();
      await page.getByText(/Cloud acceptance is not yet confirmed/).waitFor(); const args = await page.evaluate(() => window.fixture.calls.approve); assert.equal(args.length, 2); assert.deepEqual(args[0], args[1]);
      passed++; console.log("PASS retry retains identical frozen recoverykey and explicit pending result"); await page.close();
    }
    for (const kind of ["list", "preview", "approve"]) {
      const page = await newPage(390);
      if (kind !== "list") await inspect(page);
      await page.evaluate(kind => window.fixture.defer(kind), kind);
      if (kind === "list") await page.getByRole("button", { name: "Review saved closings" }).click();
      if (kind === "preview") { await page.getByRole("button", { name: /CLOSED · 11111111/ }).click(); }
      if (kind === "approve") { await page.getByLabel("Administrator review reason").fill("Reason before logout"); await page.getByRole("button", { name: "Save reviewed recovery" }).click(); }
      await page.evaluate(() => window.fixture.setAuth({ isAdmin: false, user: { staffId: "different-cashier" }, authUserId: null }));
      await page.getByRole("dialog").waitFor({ state: "detached" });
      await page.evaluate(kind => window.fixture.resolve(kind), kind); await page.waitForTimeout(40);
      assert.equal(await page.getByRole("dialog").count(), 0); assert.equal(await page.getByText(/Cloud acceptance is not yet confirmed/).count(), 0);
      passed++; console.log("PASS late " + kind + " response ignored after session revocation"); await page.close();
    }
    {
      const page = await newPage(390);
      await page.evaluate(() => window.fixture.set("list", { ok: true, available: false, items: [] }));
      await page.getByRole("button", { name: "Review saved closings" }).click(); await page.getByText(/needs the reviewed recovery metadata upgrade/).waitFor();
      assert.equal(await page.getByRole("button", { name: "Save reviewed recovery" }).count(), 0);
      passed++; console.log("PASS missing metadata upgrade is explicit and never enables approval"); await page.close();
    }
    // A previously reviewed preview must not survive a now-unavailable schema.
    {
      const page = await newPage(390); await inspect(page); await page.getByLabel("Administrator review reason").fill("Old preview reason");
      await page.keyboard.press("Escape"); await page.getByRole("dialog").waitFor({ state: "detached" });
      await page.evaluate(() => window.fixture.set("list", { ok: true, available: false, items: [] }));
      await page.getByRole("button", { name: "Review saved closings" }).click(); await page.getByText(/needs the reviewed recovery metadata upgrade/).waitFor();
      assert.equal(await page.getByRole("button", { name: "Save reviewed recovery" }).count(), 0, "A stale approvable preview cannot coexist with missing schema");
      passed++; console.log("PASS reopening unavailable schema clears stale approvable preview"); await page.close();
    }
    {
      const page = await newPage(390);
      await page.evaluate(() => window.fixture.setAuth({ isAdmin: false })); await page.waitForTimeout(30);
      assert.equal(await page.getByRole("button", { name: "Review saved closings" }).count(), 0);
      assert.deepEqual(await page.evaluate(() => window.fixture.calls), { list: [], preview: [], approve: [] });
      passed++; console.log("PASS non-administrator gets no review control or IPC calls"); await page.close();
    }
    {
      const page = await newPage(390); await page.evaluate(() => window.fixture.set("list", { ok: true, available: true }));
      await page.getByRole("button", { name: "Review saved closings" }).click(); await page.getByRole("alert").getByText(/response is incomplete/).waitFor();
      assert.equal(await page.getByRole("dialog").count(), 1); assert.equal(await page.getByRole("button", { name: "Save reviewed recovery" }).count(), 0);
      passed++; console.log("PASS malformed unknown list response remains readable without crashing settings"); await page.close();
    }
    {
      const page = await newPage(390);
      await page.evaluate(() => window.fixture.set("preview", { ...window.fixture.initial.preview, canApprove: true, classification: "unknown-future-admission" }));
      await page.getByRole("button", { name: "Review saved closings" }).click(); await page.getByRole("button", { name: /CLOSED · 11111111/ }).click();
      await page.getByRole("alert").getByText(/response is incomplete/).waitFor(); assert.equal(await page.getByRole("button", { name: "Save reviewed recovery" }).count(), 0);
      passed++; console.log("PASS unsupported approval classification is explicitly refused"); await page.close();
    }
    {
      const page = await newPage(390); await inspect(page); await page.getByLabel("Administrator review reason").fill("Review unknown local state");
      await page.evaluate(() => window.fixture.set("approve", { ok: true, state: "ACCEPTED" })); await page.getByRole("button", { name: "Save reviewed recovery" }).click();
      await page.getByRole("alert").getByText(/saved recovery state was not confirmed/).waitFor(); assert.equal(await page.getByText(/Cloud acceptance is not yet confirmed/).count(), 0);
      passed++; console.log("PASS unknown local save result is not mistaken for cloud acceptance"); await page.close();
    }
    {
      const page = await newPage(390);
      await page.evaluate(() => window.fixture.set("preview", { ...window.fixture.initial.preview, shiftId: "22222222-2222-4222-8222-222222222222" }));
      await page.getByRole("button", { name: "Review saved closings" }).click(); await page.getByRole("button", { name: /CLOSED · 11111111/ }).click();
      await page.getByRole("alert").getByText(/response is incomplete|selected shift|different shift/).waitFor({ timeout: 3000 });
      assert.equal(await page.getByRole("button", { name: "Save reviewed recovery" }).count(), 0);
      passed++; console.log("PASS preview must belong to the actual selected shift"); await page.close();
    }
    console.log(`PASS ${passed} isolated headless React recovery UI groups; no operator data or external network`);
  } finally { await browser?.close(); await server?.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
