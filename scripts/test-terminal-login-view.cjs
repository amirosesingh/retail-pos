// Real React/Radix login components with synthetic auth, roster and platform
// signals. The wrapper simulates a gate unmount; it does not verify live Auth.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");
const root = path.resolve(__dirname, "..");
const cache = path.join(root, "node_modules", ".cache");
fs.mkdirSync(cache, { recursive: true });
const dir = fs.mkdtempSync(path.join(cache, "terminal-login-view-"));
const save = (name, text) => fs.writeFileSync(path.join(dir, name), text);
save("index.html", '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><div id="root"></div><script type="module" src="./main.tsx"></script>');
save("identity.ts", `
let calls=0;const pending=new Map();
export function login(username,password){
  if(username!=='administrator.fixture'||password!=='synthetic-password')throw new Error('Fixture expected both submitted fields');
  const id=++calls;return new Promise(resolve=>pending.set(id,resolve));
}
export const useAuth=()=>({login,cashierLogin:async()=>{throw new Error('Fixture must not submit a cashier PIN')}});
export const fail=(id,error='Synthetic sign-in service unavailable. Check connection.')=>{const finish=pending.get(id);if(!finish)throw new Error('Unknown fixture request');pending.delete(id);finish({ok:false,code:'cloud-unreachable',error})};
export const stats=()=>({calls,pending:[...pending.keys()]});
export const useBranding=()=>({company:'Synthetic terminal login fixture'});
export const hasNativePasswordManager=false;
export const offerSaveLogin=async()=>{};export const requestSavedLogin=async()=>null;
export const listTerminalStaff=async()=>({staff:[],reason:'not-authorised'});
export const activeBranchId=()=> 'fixture-branch';export const boundBranchName=()=> 'Fixture branch';
export const connectivity=()=> 'online';export const subscribeConnectivity=()=>()=>{};
export const attemptsLeft=()=>5;export const clearPinFailures=()=>{};
export const describeLockout=()=>'';export const lockoutRemaining=()=>0;export const notePinFailure=()=>0;
export const localStaffRoster=async()=>[];
export const ApprovalTokenButton=()=>null;
`);
save("main.tsx", `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {createMemoryHistory,createRootRoute,createRoute,createRouter,RouterProvider} from '@tanstack/react-router';
import {TerminalLogin} from '@/platforms/web/components/pos/TerminalLogin';
import {createLoginView} from '@/lib/login-view';import {recoverySearch} from '@/lib/recovery-section';
import {fail,stats} from '@/lib/pos-auth';import '@/styles.css';
const platform=new URLSearchParams(location.search).get('platform')||'android';
if(platform==='electron')window.pos={};
else if(platform!=='web')window.Capacitor={isNativePlatform:()=>true,getPlatform:()=>platform};
function App(){
  const [view]=useState(createLoginView);const [online,setOnline]=useState(true);
  window.fixtureControl={offline:()=>setOnline(false),online:()=>setOnline(true),fail,reset:()=>view.reset(),chooseCashier:()=>view.chooseMode('cashier'),stats:()=>({...stats(),...view.getSnapshot()})};
  return online?<TerminalLogin view={view}/>:<div role="status" data-testid="fixture-gate">Synthetic connection gate; login component unmounted</div>;
}
const rootRoute=createRootRoute({component:App});
const recovery=createRoute({getParentRoute:()=>rootRoute,path:'/recovery',validateSearch:recoverySearch});
const index=createRoute({getParentRoute:()=>rootRoute,path:'/'});
const router=createRouter({routeTree:rootRoute.addChildren([index,recovery]),history:createMemoryHistory({initialEntries:['/']})});
createRoot(document.getElementById('root')).render(<RouterProvider router={router}/>);
`);

async function main() {
  const { createServer } = await import("vite");
  const react = (await import("@vitejs/plugin-react")).default;
  const tailwind = (await import("@tailwindcss/vite")).default;
  const errors = [], externalRequests = [], results = [];
  let browser, server, currentScenario = "startup";
  try {
    const synthetic = path.join(dir, "identity.ts");
    server = await createServer({ configFile: false, root, envDir: dir, envPrefix: "ISOLATED_FIXTURE_", cacheDir: path.join(dir, ".vite"), logLevel: "error",
      plugins: [react(), tailwind()], optimizeDeps: {
        entries: [path.join(dir, "main.tsx")], noDiscovery: true,
        include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-router", "@radix-ui/react-tabs", "@radix-ui/react-label", "@radix-ui/react-slot", "@radix-ui/react-collapsible", "lucide-react", "class-variance-authority", "clsx", "tailwind-merge"],
      },
      resolve: { alias: [
        ...["@/lib/pos-auth", "@/lib/branding", "@/lib/staff-admin", "@/lib/active-branch", "@/lib/pin-lockout", "@/core/activation/connection-health", "@/core/local-db/local-staff", "@/platform-config/password-manager", "@/platform-config/approval-token"].map(find => ({ find, replacement: synthetic })),
        { find: "@", replacement: path.join(root, "src") },
      ] }, server: { host: "127.0.0.1", port: 0, fs: { allow: [root] } } });
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({ channel: "chrome", headless: true });
    async function pageFor(width, platform) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, isMobile: width < 500, hasTouch: width < 500 });
      page.setDefaultTimeout(6000);
      await page.route("**/*", route => {
        const url = route.request().url();
        if (url.startsWith(origin + "/") || url.startsWith("data:")) return route.continue();
        externalRequests.push(url); return route.abort();
      });
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      const relative = path.relative(root, path.join(dir, "index.html")).replaceAll(path.sep, "/");
      await page.goto(`${origin}/${relative}?platform=${platform}`, { timeout: 30000 });
      await page.waitForFunction(() => Boolean(window.fixtureControl));
      return page;
    }
    const activate = (page, locator, width) => width < 500 ? locator.tap() : locator.click();
    async function administrator(page, width) {
      const tab = page.getByRole("tab", { name: "Supervisor / Admin", exact: true });
      if (await tab.count()) await activate(page, tab, width);
      await page.getByLabel("Email or username", { exact: true }).fill("administrator.fixture");
      await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
      await activate(page, page.getByRole("button", { name: "Sign in", exact: true }), width);
      await page.waitForFunction(() => window.fixtureControl.stats().busy);
    }
    async function pauseAndRecover(page) {
      await page.evaluate(() => window.fixtureControl.offline());
      await page.getByTestId("fixture-gate").waitFor();
      assert.equal(await page.getByLabel("Password", { exact: true }).count(), 0);
      await page.evaluate(() => window.fixtureControl.online());
      await page.getByLabel("Password", { exact: true }).waitFor();
      assert.equal(await page.getByLabel("Email or username", { exact: true }).inputValue(), "");
      assert.equal(await page.getByLabel("Password", { exact: true }).inputValue(), "");
    }
    async function noOverflow(page) {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    }
    for (const width of [390, 1440]) {
      for (const platform of ["android", "ios", "electron"]) {
        currentScenario = `${width}-${platform}-password-gate-recovery`;
        const page = await pageFor(width, platform);
        const pin = page.getByRole("tab", { name: "Sign in with PIN", exact: true });
        await pin.waitFor(); assert.equal(await pin.getAttribute("data-state"), "active");
        const setup = page.getByRole("link", { name: "Open terminal setup", exact: true });
        await setup.waitFor(); assert.equal(await setup.getAttribute("href"), "/recovery?section=activation");
        await administrator(page, width); await pauseAndRecover(page);
        const admin = page.getByRole("tab", { name: "Supervisor / Admin", exact: true });
        assert.equal(await admin.getAttribute("data-state"), "active");
        assert.equal(await admin.isDisabled(), true); assert.equal(await pin.isDisabled(), true);
        const submit = page.getByRole("button", { name: "Sign in", exact: true });
        assert.equal(await submit.isDisabled(), true);
        await submit.evaluate(button => button.closest("form").requestSubmit());
        await pin.evaluate(button => button.click());
        assert.equal((await page.evaluate(() => window.fixtureControl.stats())).calls, 1);
        assert.equal(await admin.getAttribute("data-state"), "active");
        await page.evaluate(() => window.fixtureControl.fail(1));
        const refusal = page.getByText("Synthetic sign-in service unavailable. Check connection.", { exact: true });
        await refusal.waitFor(); assert.equal(await submit.isDisabled(), false);
        assert.equal(await page.getByRole("link", { name: "Open connection settings", exact: true }).getAttribute("href"), "/recovery?section=connection");
        await noOverflow(page); await page.screenshot({ path: path.join(dir, `${width}-${platform}-admin-error.png`) });
        await pauseAndRecover(page); await refusal.waitFor(); assert.equal(await admin.getAttribute("data-state"), "active");
        await page.evaluate(() => window.fixtureControl.reset()); await setup.waitFor();
        assert.equal(await pin.getAttribute("data-state"), "active");
        if (platform === "android") {
          await administrator(page, width); await page.evaluate(() => { window.fixtureControl.offline(); window.fixtureControl.reset(); });
          await page.getByTestId("fixture-gate").waitFor(); await page.evaluate(() => window.fixtureControl.online()); await setup.waitFor();
          await administrator(page, width);
          await page.evaluate(() => window.fixtureControl.fail(2, "Stale request must stay hidden"));
          await page.waitForTimeout(30);
          assert.equal(await page.getByText("Stale request must stay hidden", { exact: true }).count(), 0);
          assert.equal(await page.getByRole("button", { name: "Sign in", exact: true }).isDisabled(), true);
          await page.evaluate(() => window.fixtureControl.fail(3, "Current request refusal"));
          await page.getByText("Current request refusal", { exact: true }).waitFor();
          assert.equal(await page.getByRole("button", { name: "Sign in", exact: true }).isDisabled(), false);
          results.push({ width, platform, scenario: "reset-and-stale-request", passed: true });
        }
        results.push({ width, platform, scenario: "default-pin-admin-gate-refusal-repair-reset", passed: true });
        await page.close();
      }
      currentScenario = `${width}-web-password-only`;
      const page = await pageFor(width, "web");
      await page.getByLabel("Password", { exact: true }).waitFor();
      assert.equal(await page.getByRole("tab").count(), 0);
      await page.evaluate(() => window.fixtureControl.chooseCashier());
      await administrator(page, width); await pauseAndRecover(page);
      assert.equal(await page.getByRole("tab").count(), 0);
      await page.evaluate(() => window.fixtureControl.fail(1));
      await page.getByText("Synthetic sign-in service unavailable. Check connection.", { exact: true }).waitFor();
      assert.equal(await page.getByRole("link", { name: "Open connection settings", exact: true }).count(), 0);
      await page.getByRole("button", { name: "Open connection settings", exact: true }).waitFor();
      await page.evaluate(() => window.fixtureControl.reset());
      await page.getByLabel("Password", { exact: true }).waitFor(); assert.equal(await page.getByRole("tab").count(), 0);
      await noOverflow(page); await page.screenshot({ path: path.join(dir, `${width}-web-password.png`) });
      results.push({ width, platform: "web", scenario: "password-only-gate-recovery-reset", passed: true }); await page.close();
    }
    assert.deepEqual(externalRequests, []); assert.deepEqual(errors, []);
    save("results.json", JSON.stringify({ results, externalRequests, errors }, null, 2));
    console.log(JSON.stringify({ scenarios: results.length, passed: results.length, externalRequests: externalRequests.length, errors, artifacts: dir }, null, 2));
  } catch (error) {
    const page = browser?.contexts().at(-1)?.pages().at(-1);
    if (page) {
      await page.screenshot({ path: path.join(dir, "failure.png") }).catch(() => {});
      const state = await page.evaluate(() => ({ text: document.body.innerText, stats: window.fixtureControl?.stats() })).catch(() => null);
      save("failure.json", JSON.stringify({ currentScenario, results, state, errors, externalRequests }, null, 2));
    }
    throw new Error(`${currentScenario}: ${error.message}`, { cause: error });
  } finally { if (browser) await browser.close(); if (server) await server.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
