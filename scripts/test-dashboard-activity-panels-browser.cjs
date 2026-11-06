"use strict";
// Mounted production routes/components and real tables/receipt dialogs with
// controlled report/provider snapshots. No live profile, data or remote traffic.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { pathToFileURL } = require("node:url"), { chromium } = require("@playwright/test");
assert.deepEqual(process.argv.slice(2), ["--run"]);
(async () => {
  const root = process.cwd(), dir = path.join(root, ".tmp", "dashboard-activity-ui"); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/.tmp/dashboard-activity-ui/main.tsx"></script></body></html>');
  fs.writeFileSync(path.join(dir, "mock.tsx"), `
import React,{useSyncExternalStore}from'react';
const get=()=>window.fixture.state,subscribe=fn=>{window.fixture.listeners.add(fn);return()=>window.fixture.listeners.delete(fn)};
const useSnapshot=()=>useSyncExternalStore(subscribe,get,get);
const stores=[{id:'A',code:'A',name:'Shop A',groupId:'one',active:true},{id:'B',code:'B',name:'Shop B',groupId:'two',active:true}];
const settings={receipt:{},tax:{},integrations:{},visibility:{hidden:{}}};
export const money=value=>Number(value).toFixed(2);export const stockAt=()=>0;
export const usePos=()=>{const s=useSnapshot();return{ready:s.ready,loadPhase:s.ready?'ready':'loading',currentStore:stores.find(x=>x.id===s.branch),stores,allStores:stores,state:{stores,products:[],members:[],sales:s.sales,transfers:[],shifts:[],settings}}};export const usePosOptional=usePos;
export const useAuth=()=>{const s=useSnapshot();return{ready:s.authReady,isAdmin:false,user:s.signedIn?{staffId:s.actor,name:'Fixture',role:'cashier',permissions:{can_view_sales_reports:true}}:null,terminalStoreId:s.terminal,canSwitchStores:!s.terminal,can:flag=>['can_view_sales_reports','can_view_inventory'].includes(flag)}};export const useAuthOptional=useAuth;
export const useReportSales=(_seed,ids)=>{const s=useSnapshot();return{sales:s.sales.filter(x=>ids.includes(x.storeId)),loading:s.loading,refreshing:s.refreshing,error:s.error}};
export const useDrawerEvents=()=>useSnapshot().drawer;
export const useSponsorshipTotals=()=>({rows:[],loading:false,error:false});
export const useQuery=()=>{const s=useSnapshot();return{data:s.board,isLoading:s.loading,isFetching:s.loading||s.refreshing,isError:!!s.error,error:s.error?new Error(s.error):null,refetch:()=>{window.fixture.retries++}}};
export const createFileRoute=()=>options=>({options});export const Link=({to,children,...props})=><a {...props} href={to} onClick={e=>e.preventDefault()}>{children}</a>;
export const AppShell=({children})=><div data-fixture-shell>{children}</div>;export const HomeShortcuts=()=>null;
export const useVisibility=()=>({visible:()=>true,visibleRoute:()=>true});
export const terminalRuntimePlatform=()=> 'web';export const localDb=()=>null;export const effectiveDatabaseMode=()=> 'online';
export const sessionEpoch=()=>get().epoch;export const supabaseConfig=()=>({url:'https://'+get().profile+'.example.invalid'});
export const supabaseExternal={from:()=>{throw new Error('Unexpected database read in fixture')}};
const profile={tableViews:{}};export const usePersonalAppearance=()=>({profile,editable:true,update:()=>{window.fixture.preferenceWrites++}});
export const useUserPermissions=()=>({requirePermission:async()=>false});export const logger={log:()=>{}};export const notifyError=()=>{};
`);
  fs.writeFileSync(path.join(dir, "main.tsx"), `
import React from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{Route as Dashboard}from'@/routes/dashboard';import{Route as Board}from'@/routes/analytics';import{setPosTimeZone}from'@/lib/time-zone';import'@/styles.css';
setPosTimeZone('UTC');const today=new Date().toISOString().slice(0,10),at=today+'T04:00:00Z';
const bill=id=>({id:'sale'+id,receiptNo:'TEST-'+id,shiftId:'shift'+id,storeId:id,storeName:'Shop '+id,createdAt:at,cashier:'Cashier '+id,method:'split',memberId:null,pointsEarned:0,subtotal:20,discount:0,total:20,tax:0,roundingAdjustment:0,paid:20,change:0,lines:[{productId:'p',name:'Fixture item',qty:1,price:20,cost:5}],payments:[{id:'p1'+id,method:'cash',amount:10},{id:'p2'+id,method:'card',amount:10}],refunded:false});
const drawer=id=>({id:'drawer'+id,at,storeId:id,staffName:'Cashier '+id,role:'cashier',reason:'Count drawer '+id,note:'Synthetic event',approvedBy:'Fixture supervisor'});
const emptyBoard={storeDays:[],itemDays:[],bills:[],storeNames:{A:'Shop A',B:'Shop B'},liveStoreIds:['A','B']};
const activeBoard={...emptyBoard,storeDays:[{store_id:'A',sale_day:today,sale_month:today.slice(0,7),bills:1,revenue:20,cost:5,profit:15,discount:0,foc_value:0,units:1}],
itemDays:[{store_id:'A',sale_day:today,product_id:'p',product_name:'Fixture item',product_category:'Shoes',units:1,revenue:20,cost:5,profit:15}],bills:[{store_id:'A',created_at:at,total:20,discount_amount:0,coupon_discount:0}],hourlyRows:[]};
window.fixture={listeners:new Set(),retries:0,preferenceWrites:0,documentToken:crypto.randomUUID(),bill,drawer,emptyBoard,activeBoard,
state:{branch:'A',ready:false,loading:true,refreshing:false,error:'',actor:'one',epoch:1,profile:'one',authReady:true,signedIn:true,terminal:null,sales:[bill('A'),bill('B')],drawer:[drawer('A'),drawer('B')],board:activeBoard},
patch(value){flushSync(()=>{this.state={...this.state,...value};for(const fn of this.listeners)fn()})}};
const Component=new URLSearchParams(location.search).get('page')==='board'?Board.options.component:Dashboard.options.component;
createRoot(document.getElementById('root')).render(<Component/>);
`);
  const names = ["@/lib/pos-store", "@/lib/pos-auth", "@/lib/use-report-sales", "@/lib/drawer-events", "@/lib/use-sponsorship-totals", "@tanstack/react-query", "@tanstack/react-router", "@/platforms/web/components/pos/AppShell", "./AppShell",
    "@/platforms/web/components/pos/HomeShortcuts", "@/lib/ui-visibility", "@/core/activation/terminal-platform", "@/core/local-db/local-db", "@/core/local-db/db-mode", "./session-epoch", "./external-supabase-config", "@/integrations/supabase/external-client",
    "@/lib/personal-appearance", "@/lib/pos-permissions", "@/lib/audit-log", "@/lib/notify"];
  const { createServer } = await import("vite"), react = (await import("@vitejs/plugin-react")).default, tailwind = (await import("@tailwindcss/vite")).default;
  const { popupRuntimeAliases } = await import(pathToFileURL(path.join(root, "scripts/popup-runtime-aliases.mjs")).href);
  let server, browser; const errors = [], remote = [];
  try {
    server = await createServer({ configFile: false, envDir: false, root, cacheDir: path.join(dir, ".vite"), plugins: [react(), tailwind()], resolve: { alias: [...names.map(find => ({ find, replacement: path.join(dir, "mock.tsx") })), ...popupRuntimeAliases(), { find: "@", replacement: path.join(root, "src") }] }, server: { host: "127.0.0.1", port: 0, fs: { allow: [root, fs.realpathSync(path.join(root, "node_modules"))] } }, logLevel: "error" });
    await server.listen(); const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-gpu"] });
    const open = async (kind, width) => {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => route.request().url().startsWith(origin) ? route.continue() : (remote.push(route.request().url()), route.abort()));
      await page.goto(`${origin}/.tmp/dashboard-activity-ui/index.html?page=${kind}`);
      await page.waitForFunction(() => Boolean(window.fixture)); return page;
    };
    const patch = (page, value) => page.evaluate(value => window.fixture.patch(value), value);
    const titles = ["Cashier review · today", "Cash drawer opens without a sale", "Split payments today"];
    const absent = async page => { for (const name of titles) assert.equal(await page.getByRole("heading", { name, exact: true }).count(), 0, `unexpected ${name}`); };
    for (const width of [1440, 390]) {
      const page = await open("dashboard", width); await page.getByRole("heading", { name: "Live dashboard · Shop A", exact: true }).waitFor();
      await absent(page); await page.evaluate(() => { window.fixture.shell = document.querySelector("[data-fixture-shell]"); window.fixture.token = window.fixture.documentToken; });
      await patch(page, { ready: true, loading: false, sales: [], drawer: [] }); await absent(page);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.evaluate(() => window.fixture.patch({ sales: [window.fixture.bill('A'), window.fixture.bill('B')], drawer: [window.fixture.drawer('A'), window.fixture.drawer('B')] }));
      for (const name of titles) await page.getByRole("heading", { name, exact: true }).waitFor();
      const reveal = await page.getByRole("heading", { name: titles[0], exact: true }).locator("xpath=ancestor::section[1]").evaluate(node => getComputedStyle(node).animationName);
      assert.notEqual(reveal, "none", "positive activity should use the existing reveal animation");
      await page.emulateMedia({ reducedMotion: "reduce" });
      assert.equal(await page.getByText("Count drawer B", { exact: true }).count(), 0);
      const search = page.getByLabel("Search bill number for Cashier A", { exact: true }); await search.fill("missing");
      await page.getByText("No bills match this number.", { exact: true }).waitFor(); await search.fill("");
      await page.getByRole("button", { name: "Open bill TEST-A", exact: true }).click(); await page.getByRole("dialog", { name: "Bill TEST-A", exact: true }).waitFor();
      await page.keyboard.press("Escape"); await page.getByRole("dialog", { name: "Bill TEST-A", exact: true }).waitFor({ state: "hidden" });
      const drawerPanel = page.getByRole("heading", { name: titles[1], exact: true }).locator("xpath=ancestor::section[1]");
      await drawerPanel.getByRole("button", { name: "Columns", exact: true }).click(); await page.getByRole("menu").waitFor(); await page.keyboard.press("Escape");
      await page.screenshot({ path: path.join(dir, `dashboard-activity-${width}.png`), fullPage: true });
      assert.equal(await page.evaluate(() => window.fixture.preferenceWrites), 0, "visibility must not change saved table preferences");
      await patch(page, { ready: false, loading: true, sales: [], drawer: [] }); for (const name of titles) assert.equal(await page.getByRole("heading", { name, exact: true }).count(), 1);
      await drawerPanel.getByRole("button", { name: "Columns", exact: true }).click(); await page.getByRole("menu").waitFor();
      await patch(page, { ready: true, loading: false, error: "Scoped report read refused" });
      assert.equal(await page.getByRole("menu").count(), 0, "departing empty panel left a portalled column menu behind");
      await page.getByRole("alert").filter({ hasText: "Scoped report read refused" }).waitFor();
      await page.getByText("Showing last confirmed activity; the sales refresh did not complete.", { exact: true }).waitFor();
      assert.equal(await page.getByRole("heading", { name: titles[0], exact: true }).count(), 1); assert.equal(await page.getByRole("heading", { name: titles[2], exact: true }).count(), 1);
      assert.equal(await page.getByRole("heading", { name: titles[1], exact: true }).count(), 0);
      await patch(page, { error: "", sales: [], drawer: [] }); await absent(page);
      await page.evaluate(() => window.fixture.patch({ sales: [window.fixture.bill('A')], drawer: [window.fixture.drawer('A')] }));
      await page.getByRole("button", { name: "Open bill TEST-A", exact: true }).click();
      await page.getByRole("dialog", { name: "Bill TEST-A", exact: true }).waitFor();
      await page.evaluate(() => window.fixture.patch({ branch: 'B', ready: false, loading: true, sales: [window.fixture.bill('A'),window.fixture.bill('B')], drawer: [window.fixture.drawer('A'),window.fixture.drawer('B')] }));
      await absent(page); assert.equal(await page.getByRole("dialog").count(), 0, "old receipt popup survived scope departure");
      await patch(page, { ready: true, loading: false }); for (const name of titles) await page.getByRole("heading", { name, exact: true }).waitFor();
      assert.equal(await page.getByText("Count drawer A", { exact: true }).count(), 0); assert.equal(await page.getByRole("button", { name: "Open bill TEST-A", exact: true }).count(), 0);
      await page.evaluate(() => window.fixture.patch({ actor:'two',epoch:2,ready:false,loading:true })); await absent(page);
      await page.evaluate(() => window.fixture.patch({ ready:true,loading:false,terminal:'A',branch:'B',sales:[window.fixture.bill('B')],drawer:[window.fixture.drawer('B')] })); await absent(page);
      assert(await page.evaluate(() => window.fixture.shell === document.querySelector('[data-fixture-shell]') && window.fixture.token === window.fixture.documentToken && performance.getEntriesByType('navigation').length === 1));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(dir, `dashboard-empty-${width}.png`), fullPage: true }); await page.close();

      const board = await open("board", width); await board.getByRole("heading", { name: "Live Business Board", exact: true }).waitFor();
      const categoryTitles = ["Top categories — all shops combined", "Top categories per shop"];
      const emptyCategories = async () => { for (const name of categoryTitles) assert.equal(await board.getByRole("heading", { name, exact: true }).count(), 0); };
      await emptyCategories(); await board.evaluate(() => window.fixture.patch({ ready: true, loading: false, board: window.fixture.emptyBoard })); await emptyCategories();
      await board.evaluate(() => window.fixture.patch({ board: window.fixture.activeBoard })); for (const name of categoryTitles) await board.getByRole("heading", { name, exact: true }).waitFor();
      assert.equal(await board.getByText("No category sales", { exact: true }).count(), 0);
      await board.getByRole("button", { name: /Shoes.*item/ }).first().click(); await board.getByRole("heading", { name: "Items in Shoes", exact: true }).waitFor();
      await board.screenshot({ path: path.join(dir, `board-category-activity-${width}.png`), fullPage: true });
      await patch(board, { error: "Board report refused" }); await board.getByText(/Board report refused/).first().waitFor();
      for (const name of categoryTitles) assert.equal(await board.getByRole("heading", { name, exact: true }).count(), 1);
      await board.getByRole("button", { name: "Retry", exact: true }).click(); assert.equal(await board.evaluate(() => window.fixture.retries), 1);
      await board.evaluate(() => window.fixture.patch({ error: '',board: window.fixture.emptyBoard })); await emptyCategories(); assert.equal(await board.getByRole("heading", { name: "Items in Shoes", exact: true }).count(), 0);
      assert.equal(await board.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await board.close();
      console.log(`PASS ${width}px mounted Dashboard/Board: unknown/empty hiding, live arrival/departure, scoped snapshots, truthful errors, receipt/columns actions and native branch lock`);
    }
    assert.deepEqual(errors, []); assert.deepEqual(remote, []);
    console.log("PASS mounted route activity panels; no remote requests, preference writes, document reloads or operator data.");
  } finally { await browser?.close(); await server?.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
