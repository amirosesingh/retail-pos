// Disposable real React/Radix browser fixture. Never opens a user's browser or
// signs in; all auth, readiness and connectivity are synthetic and local.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");
const root = path.resolve(__dirname, "..");
const dir = path.join(root, "node_modules/.cache/offline-gate-portals-fixed");
fs.mkdirSync(dir, { recursive: true });
const save = (name, value) => fs.writeFileSync(path.join(dir, name), value);
save("index.html", '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>@keyframes fixture-indicator {from{opacity:.7}to{opacity:1}}</style><div id="root"></div><script type="module" src="./main.tsx"></script>');
save("health.ts", `
let current={state:new URLSearchParams(location.search).has('cold')?'offline':'online',issue:'timeout'};
const listeners=new Set();let retries=0;
export const connectivity=()=>current.state;
export const cloudDiagnosis=()=>({issue:current.issue});
export const cloudVerdict=()=>current.state==='online'?'verified':current.issue==='configuration'?'rejected':'unreachable';
export const subscribeConnectivity=fn=>{listeners.add(fn);return()=>listeners.delete(fn)};
export const emit=(state,issue)=>{current={state,issue};for(const fn of listeners)fn(state)};
export async function heartbeat(){retries++;emit('online','none');return 'online'};
export const getRetries=()=>retries;
export const useStartupGate=()=>({registration:'registered',loading:false,probing:false,cloudConfigured:true,verdict:cloudVerdict(),cloudConnected:current.state==='online'});
export const subscribeConfigReady=fn=>{fn({ready:true,state:'not-applicable',have:{supabaseUrl:false,supabaseKey:false,backendUrl:false}});return()=>{}};
`);
save("identity.ts", `
import {useSyncExternalStore} from 'react';
let snapshot={auth:{ready:true,authUserId:'fixture-auth',terminalUser:null,appUser:{is_active:true},user:{staffId:'fixture-person',storeId:'A',role:'cashier',roles:['staff'],permissions:{can_process_sale:true}}},pos:{ready:true,currentStore:{id:'A'}}};
const listeners=new Set();const subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn)};
export const useAuth=()=>useSyncExternalStore(subscribe,()=>snapshot,()=>snapshot).auth;
export const usePos=()=>useSyncExternalStore(subscribe,()=>snapshot,()=>snapshot).pos;
export const switchBranch=()=>{snapshot={...snapshot,pos:{ready:true,currentStore:{id:'B'}}};for(const fn of listeners)fn()};
export const rejectAccount=()=>{snapshot={...snapshot,auth:{...snapshot.auth,ready:false,user:null}};for(const fn of listeners)fn()};
`);
save("main.tsx", `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {createMemoryHistory,createRootRoute,createRoute,createRouter,RouterProvider} from '@tanstack/react-router';
import {OfflineGate} from '@/platforms/mobile/components/OfflineGate';
import {OfflineGateSnapshot} from '@/components/shared/OfflineGateSnapshot';
import {Dialog,DialogContent,DialogTitle,DialogDescription,DialogTrigger} from '@/components/ui/dialog';
import {AlertDialog,AlertDialogContent,AlertDialogTitle,AlertDialogDescription,AlertDialogTrigger,AlertDialogCancel,AlertDialogAction} from '@/components/ui/alert-dialog';
import {Sheet,SheetContent,SheetTitle,SheetDescription,SheetTrigger} from '@/components/ui/sheet';
import {Drawer,DrawerContent,DrawerTitle,DrawerDescription,DrawerTrigger} from '@/components/ui/drawer';
import {Popover,PopoverContent,PopoverTrigger} from '@/components/ui/popover';
import {DropdownMenu,DropdownMenuContent,DropdownMenuTrigger,DropdownMenuItem,DropdownMenuSub,DropdownMenuSubTrigger,DropdownMenuSubContent} from '@/components/ui/dropdown-menu';
import {ContextMenu,ContextMenuContent,ContextMenuTrigger,ContextMenuItem} from '@/components/ui/context-menu';
import {Menubar,MenubarMenu,MenubarTrigger,MenubarContent,MenubarItem} from '@/components/ui/menubar';
import {Tooltip,TooltipContent,TooltipProvider,TooltipTrigger} from '@/components/ui/tooltip';
import {Select,SelectTrigger,SelectContent,SelectItem,SelectValue} from '@/components/ui/select';
import {emit,getRetries} from '@/core/activation/connection-health';import {switchBranch,rejectAccount} from '@/lib/pos-auth';
import '@/styles.css';
const params=new URLSearchParams(location.search);const kind=params.get('popup')||'dialog';
if(params.has('desktop'))window.pos={};
const stats={changes:0,submits:0,actions:0,selected:'one'};
window.fixtureControl={offline:()=>emit('offline','timeout'),problem:issue=>emit('offline',issue),online:()=>emit('online','none'),switchBranch,rejectAccount,stats:()=>({...stats,retries:getRetries()})};
function FixtureSelect({nested=false}){const [value,setValue]=useState('one');return <Select value={value} onValueChange={next=>{stats.changes++;stats.selected=next;setValue(next)}}><SelectTrigger aria-label={nested?'Nested choice':'Fixture choice'}><SelectValue/></SelectTrigger><SelectContent data-testid={nested?'nested-popup':'popup'}><SelectItem value="one">Fixture one</SelectItem><SelectItem value="two">Fixture two</SelectItem></SelectContent></Select>}
function NestedDialog(){const [open,setOpen]=useState(false);return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><button type="button">Open nested dialog</button></DialogTrigger><DialogContent data-testid="middle-popup"><DialogTitle>Nested fixture</DialogTitle><DialogDescription>Synthetic only</DialogDescription><FixtureSelect nested/></DialogContent></Dialog>}
function Draft(){return <form onSubmit={event=>{event.preventDefault();stats.submits++}}><label>Draft note<input aria-label="Draft note" defaultValue="Unsaved fixture note" style={{display:'block',width:'100%',padding:10,border:'1px solid'}}/></label><label>Second note<input aria-label="Second note" defaultValue="Second unsaved note"/></label><span data-testid="fixture-finite-indicator" data-state="open" style={{animation:"fixture-indicator 80s linear 1"}}>Finite indicator</span><span data-testid="fixture-spinner" data-state="open" className="inline-block animate-spin">Loading indicator</span><button type="submit">Save fixture</button><FixtureSelect nested/><NestedDialog/></form>}
const action=()=>{stats.actions++};
function Popup(){const [open,setOpen]=useState(false);const trigger=<button>Open fixture popup</button>;
if(kind==='select')return <FixtureSelect/>;
if(kind==='alert-dialog')return <AlertDialog open={open} onOpenChange={setOpen}><AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger><AlertDialogContent data-testid="popup"><AlertDialogTitle>Fixture confirmation</AlertDialogTitle><AlertDialogDescription>Synthetic only</AlertDialogDescription><Draft/><AlertDialogCancel>Cancel fixture</AlertDialogCancel><AlertDialogAction onClick={action}>Confirm fixture</AlertDialogAction></AlertDialogContent></AlertDialog>;
if(kind==='sheet')return <Sheet open={open} onOpenChange={setOpen}><SheetTrigger asChild>{trigger}</SheetTrigger><SheetContent data-testid="popup"><SheetTitle>Fixture sheet</SheetTitle><SheetDescription>Synthetic only</SheetDescription><Draft/></SheetContent></Sheet>;
if(kind==='drawer')return <Drawer open={open} onOpenChange={setOpen} shouldScaleBackground={false}><DrawerTrigger asChild>{trigger}</DrawerTrigger><DrawerContent data-testid="popup"><DrawerTitle>Fixture drawer</DrawerTitle><DrawerDescription>Synthetic only</DrawerDescription><Draft/></DrawerContent></Drawer>;
if(kind==='popover')return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild>{trigger}</PopoverTrigger><PopoverContent data-testid="popup"><Draft/></PopoverContent></Popover>;
if(kind==='dropdown-menu')return <DropdownMenu open={open} onOpenChange={setOpen}><DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger><DropdownMenuContent data-testid="popup"><DropdownMenuItem onSelect={action}>Fixture action</DropdownMenuItem><DropdownMenuSub><DropdownMenuSubTrigger>More fixture actions</DropdownMenuSubTrigger><DropdownMenuSubContent data-testid="sub-popup"><DropdownMenuItem onSelect={action}>Nested fixture action</DropdownMenuItem></DropdownMenuSubContent></DropdownMenuSub></DropdownMenuContent></DropdownMenu>;
if(kind==='context-menu')return <ContextMenu><ContextMenuTrigger asChild>{trigger}</ContextMenuTrigger><ContextMenuContent data-testid="popup"><ContextMenuItem onSelect={action}>Fixture action</ContextMenuItem></ContextMenuContent></ContextMenu>;
if(kind==='menubar')return <Menubar value={open?'fixture':''} onValueChange={value=>setOpen(Boolean(value))}><MenubarMenu value="fixture"><MenubarTrigger>Open fixture popup</MenubarTrigger><MenubarContent data-testid="popup"><MenubarItem onSelect={action}>Fixture action</MenubarItem></MenubarContent></MenubarMenu></Menubar>;
if(kind==='tooltip')return <TooltipProvider delayDuration={0}><Tooltip open={open} onOpenChange={setOpen}><TooltipTrigger asChild><button onClick={()=>setOpen(true)}>Open fixture popup</button></TooltipTrigger><TooltipContent data-testid="popup">Fixture tooltip</TooltipContent></Tooltip></TooltipProvider>;
return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild>{trigger}</DialogTrigger><DialogContent data-testid="popup"><DialogTitle>Fixture dialog</DialogTitle><DialogDescription>Synthetic only</DialogDescription><Draft/></DialogContent></Dialog>}
function App(){const [mounted,setMounted]=useState(true);window.fixtureControl.unmount=()=>setMounted(false);const content=<main data-testid="runtime" style={{padding:24,minHeight:'100vh'}}><h1>Isolated synthetic popup fixture</h1><Popup/></main>;if(!mounted)return <p>Fixture unmounted</p>;return params.has('outside')?<>{content}<OfflineGate><OfflineGateSnapshot/></OfflineGate></>:<OfflineGate><OfflineGateSnapshot/>{content}</OfflineGate>}
const rootRoute=createRootRoute({component:App});const route=createRoute({getParentRoute:()=>rootRoute,path:'/'});
const router=createRouter({routeTree:rootRoute.addChildren([route]),history:createMemoryHistory({initialEntries:['/']})});
createRoot(document.getElementById('root')).render(<RouterProvider router={router}/>);
`);

async function main() {
  const { createServer } = await import("vite");
  const react = (await import("@vitejs/plugin-react")).default;
  const tailwind = (await import("@tailwindcss/vite")).default;
  const { popupRuntimeAliases } = await import("./popup-runtime-aliases.mjs");
  let server, browser;
  let currentScenario = "startup";
  const results = [], externalRequests = [], errors = [];
  try {
    server = await createServer({ configFile: false, root, envDir: dir, envPrefix: "ISOLATED_FIXTURE_", cacheDir: path.join(dir, ".vite"), plugins: [react(), tailwind()],
      optimizeDeps: { include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "@tanstack/react-router", "@radix-ui/react-dialog", "@radix-ui/react-alert-dialog", "@radix-ui/react-popover", "@radix-ui/react-select", "@radix-ui/react-dropdown-menu", "@radix-ui/react-context-menu", "@radix-ui/react-menubar", "@radix-ui/react-tooltip", "@radix-ui/react-slot", "vaul", "lucide-react", "class-variance-authority", "clsx", "tailwind-merge"] },
      resolve: { dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-query", "@supabase/supabase-js"], alias: [
        ...popupRuntimeAliases(),
        { find: "@/lib/pos-auth", replacement: path.join(dir, "identity.ts") },
        { find: "@/lib/pos-store", replacement: path.join(dir, "identity.ts") },
        ...["@/core/activation/connection-health", "@/core/activation/registration-status", "@/lib/platform-config-ready"].map(find => ({ find, replacement: path.join(dir, "health.ts") })),
        { find: "@", replacement: path.join(root, "src") },
      ] }, server: { host: "127.0.0.1", port: 0, fs: { allow: [root] } }, logLevel: "error" });
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({ channel: "chrome", headless: true });
    async function pageFor(width, popup = "dialog", extra = "") {
      const ios = extra.includes("ios");
      const page = await browser.newPage({ viewport: { width, height: 900 }, ...(ios ? { isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" } : {}) });
      if (ios) await page.addInitScript(() => Object.defineProperty(navigator, "platform", { get: () => "iPhone" }));
      page.setDefaultTimeout(6000);
      await page.route("**/*", route => {
        const url = route.request().url();
        if (url.startsWith(origin + "/") || url.startsWith("data:")) return route.continue();
        externalRequests.push(url); return route.abort();
      });
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => { if (message.type() === "error") errors.push(`${currentScenario}: ${message.text()}`); });
      await page.exposeFunction("fixtureReportError", message => errors.push(`${currentScenario}: ${message}`));
      await page.addInitScript(() => window.addEventListener("error", event => window.fixtureReportError(event.message)));
      await page.goto(`${origin}/node_modules/.cache/offline-gate-portals-fixed/index.html?popup=${popup}${extra}`, { timeout: 30000 });
      await page.waitForFunction(() => Boolean(window.fixtureControl));
      if (!extra.includes("cold")) await page.getByTestId("runtime").waitFor();
      return page;
    }
    async function open(page, popup = "dialog") {
      if (popup === "select") await page.getByRole("combobox").click();
      else if (popup === "menubar") await page.getByRole("menuitem", { name: "Open fixture popup", exact: true }).click();
      else await page.getByRole("button", { name: "Open fixture popup", exact: true }).click({ button: popup === "context-menu" ? "right" : "left" });
      await page.getByTestId("popup").waitFor({ state: "visible" });
      await page.getByTestId("popup").evaluate(node => { window.originalPopup = node; });
    }
    async function paused(page, keyboard = false) {
      await page.waitForFunction(() => Boolean(document.querySelector('[data-testid="runtime"]')?.closest("[inert]")));
      await page.getByTestId("popup").waitFor({ state: "hidden" });
      await page.waitForFunction(() => getComputedStyle(document.body).pointerEvents !== "none");
      const facts = await page.evaluate(() => { const node = window.originalPopup; return ({
        inside: Boolean(node.closest("[data-offline-gate-portals]")), inert: Boolean(node.closest("[inert]")),
        connected: node.isConnected, pointerBlocked: getComputedStyle(document.body).pointerEvents === "none",
      }); });
      assert.deepEqual(facts, { inside: true, inert: true, connected: false, pointerBlocked: false });
      await page.waitForFunction(() => document.activeElement?.closest("[data-offline-gate-recovery]"));
      if (keyboard) {
        await page.keyboard.press("Tab");
        assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest("[inert]"))), false);
      }
    }
    async function touchBlocked(page, selector) {
      return page.evaluate(targetSelector => {
        const target = document.querySelector(targetSelector);
        const touch = y => new Touch({ identifier: 1, target, clientX: 10, clientY: y });
        const start = touch(10), moved = touch(20);
        target.dispatchEvent(new TouchEvent("touchstart", { touches: [start], targetTouches: [start], changedTouches: [start], bubbles: true, cancelable: true }));
        const event = new TouchEvent("touchmove", { touches: [moved], targetTouches: [moved], changedTouches: [moved], bubbles: true, cancelable: true });
        target.dispatchEvent(event);
        return event.defaultPrevented;
      }, selector);
    }
    const popups = ["dialog", "alert-dialog", "sheet", "drawer", "popover", "dropdown-menu", "context-menu", "menubar", "tooltip", "select"];
    for (const width of [390, 1440]) {
      for (const popup of popups) {
        currentScenario = `${width}-${popup}-pause-retry`;
        const page = await pageFor(width, popup); await open(page, popup);
        const ordinaryEntrance = popup === "dialog" ? await page.getByTestId("popup").evaluate(node => getComputedStyle(node).animationName) : null;
        const draft = page.getByLabel("Draft note");
        if (await draft.count()) await draft.fill("Keep this unsaved synthetic draft");
        if (popup === "dialog") await page.getByLabel("Second note").fill("Restore focus to the second input");
        await page.getByTestId("popup").evaluate(node => { window.originalPopup = node; });
        await page.evaluate(() => window.fixtureControl.offline()); await paused(page, popup === "dialog");
        assert.deepEqual(await page.evaluate(() => window.fixtureControl.stats()), { actions: 0, changes: 0, submits: 0, selected: "one", retries: 0 });
        if (popup === "dialog") await page.screenshot({ path: path.join(dir, `${width}-paused-dialog.png`) });
        await page.getByRole("button", { name: "Try again", exact: true }).click();
        await page.getByTestId("popup").waitFor({ state: "visible" });
        // A tooltip normally closes/reopens on the restored trigger's focus;
        // editable and action surfaces retain their existing DOM and drafts.
        if (popup !== "tooltip") assert.equal(await page.getByTestId("popup").evaluate(node => node === window.originalPopup), true);
        if (await draft.count()) assert.equal(await draft.inputValue(), "Keep this unsaved synthetic draft");
        if (popup === "dialog") await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Second note");
        if (popup === "dialog") assert.deepEqual(await page.getByTestId("fixture-spinner").evaluate(node => ({
          restored: node.hasAttribute("data-offline-gate-restored"), iterations: getComputedStyle(node).animationIterationCount,
        })), { restored: false, iterations: "infinite" });
        if (popup === "dialog") assert.deepEqual(await page.getByTestId("fixture-finite-indicator").evaluate(node => ({
          restored: node.hasAttribute("data-offline-gate-restored"), name: getComputedStyle(node).animationName,
        })), { restored: false, name: "fixture-indicator" });
        await page.keyboard.press("Escape");
        await page.getByTestId("popup").waitFor({ state: "hidden" });
        if (popup === "dialog") {
          await open(page, popup);
          assert.equal(await page.getByTestId("popup").evaluate(node => node.hasAttribute("data-offline-gate-restored")), false);
          assert.equal(await page.getByTestId("popup").evaluate(node => getComputedStyle(node).animationName), ordinaryEntrance);
          await page.keyboard.press("Escape"); await page.getByTestId("popup").waitFor({ state: "hidden" });
        }
        results.push({ width, popup, scenario: "pause-retry-draft-escape", passed: true }); await page.close();
      }
      const pointer = await pageFor(width, "select"); await open(pointer, "select");
      currentScenario = `${width}-pointerup-after-outage`;
      const box = await pointer.getByRole("option", { name: "Fixture two" }).boundingBox(); assert(box);
      await pointer.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await pointer.mouse.down();
      await pointer.evaluate(() => window.fixtureControl.offline()); await paused(pointer); await pointer.mouse.up();
      assert.equal((await pointer.evaluate(() => window.fixtureControl.stats())).changes, 0);
      results.push({ width, scenario: "pointerup-after-outage", passed: true }); await pointer.close();

      for (const issue of ["configuration", "authentication", "permission", "scope", "account"]) {
        currentScenario = `${width}-${issue}-refusal`;
        const page = await pageFor(width); await open(page); await page.evaluate(() => window.fixtureControl.offline());
        if (issue === "scope") await page.evaluate(() => window.fixtureControl.switchBranch());
        else if (issue === "account") await page.evaluate(() => window.fixtureControl.rejectAccount());
        else await page.evaluate(value => window.fixtureControl.problem(value), issue);
        await page.waitForFunction(() => Boolean(document.querySelector('[data-testid="runtime"]')?.closest("[hidden][inert]")));
        await page.getByTestId("popup").waitFor({ state: "hidden" });
        assert.equal(await page.evaluate(() => !window.originalPopup.isConnected && Boolean(window.originalPopup.closest("[inert]"))), true);
        if (issue === "configuration") await page.screenshot({ path: path.join(dir, `${width}-configuration-hidden.png`) });
        results.push({ width, scenario: `${issue}-refusal`, passed: true }); await page.close();
      }
      currentScenario = `${width}-nested-popup-retry`;
      const nested = await pageFor(width); await open(nested);
      await nested.getByRole("combobox", { name: "Nested choice" }).click(); await nested.getByTestId("nested-popup").waitFor();
      await nested.evaluate(() => window.fixtureControl.offline()); await paused(nested);
      await nested.getByTestId("nested-popup").waitFor({ state: "hidden" });
      await nested.getByRole("button", { name: "Try again", exact: true }).click(); await nested.getByTestId("popup").waitFor();
      await nested.getByTestId("nested-popup").waitFor();
      await nested.keyboard.press("Escape"); await nested.getByTestId("nested-popup").waitFor({ state: "hidden" });
      assert.equal(await nested.getByTestId("popup").getAttribute("data-state"), "open");
      await nested.keyboard.press("Escape"); await nested.getByTestId("popup").waitFor({ state: "hidden" });
      await nested.waitForFunction(() => getComputedStyle(document.body).pointerEvents !== "none");
      results.push({ width, scenario: "nested-popup-retry", passed: true }); await nested.close();

      currentScenario = `${width}-three-level-two-cycle-flap`;
      const deep = await pageFor(width); await open(deep);
      await deep.getByLabel("Draft note").fill("Three-level retained draft");
      await deep.getByRole("button", { name: "Open nested dialog" }).click(); await deep.getByTestId("middle-popup").waitFor();
      await deep.getByTestId("middle-popup").getByRole("combobox").click(); await deep.getByTestId("nested-popup").waitFor();
      for (let cycle = 0; cycle < 2; cycle++) {
        await deep.evaluate(() => window.fixtureControl.offline()); await paused(deep);
        await deep.getByRole("button", { name: "Try again", exact: true }).click();
        for (const testId of ["popup", "middle-popup", "nested-popup"]) await deep.getByTestId(testId).waitFor();
        assert.equal(await deep.getByLabel("Draft note").inputValue(), "Three-level retained draft");
      }
      await deep.evaluate(() => window.fixtureControl.offline());
      await deep.waitForFunction(() => !window.originalPopup.isConnected);
      await deep.evaluate(() => window.fixtureControl.online());
      for (const testId of ["popup", "middle-popup", "nested-popup"]) await deep.getByTestId(testId).waitFor();
      await deep.keyboard.press("Escape"); await deep.getByTestId("nested-popup").waitFor({ state: "hidden" });
      assert.equal(await deep.getByTestId("middle-popup").getAttribute("data-state"), "open");
      assert.equal(await deep.getByTestId("popup").getAttribute("data-state"), "open");
      await deep.keyboard.press("Escape"); await deep.getByTestId("middle-popup").waitFor({ state: "hidden" });
      assert.equal(await deep.getByTestId("popup").getAttribute("data-state"), "open");
      await deep.keyboard.press("Escape"); await deep.getByTestId("popup").waitFor({ state: "hidden" });
      await deep.waitForFunction(() => getComputedStyle(document.body).pointerEvents !== "none");
      results.push({ width, scenario: "three-level-two-cycle-flap", passed: true }); await deep.close();

      currentScenario = `${width}-unmount-while-paused`;
      const unmounted = await pageFor(width); await open(unmounted); await unmounted.evaluate(() => window.fixtureControl.offline()); await paused(unmounted);
      await unmounted.evaluate(() => window.fixtureControl.unmount());
      await unmounted.getByText("Fixture unmounted", { exact: true }).waitFor();
      assert.equal(await unmounted.locator("[data-offline-gate-portals]").count(), 0);
      await unmounted.waitForFunction(() => getComputedStyle(document.body).pointerEvents !== "none");
      results.push({ width, scenario: "unmount-while-paused", passed: true }); await unmounted.close();

      currentScenario = `${width}-outside-context-unchanged`;
      const outside = await pageFor(width, "dialog", "&outside=1"); await open(outside);
      assert.equal(await outside.getByTestId("popup").evaluate(node => Boolean(node.closest("[data-offline-gate-portals]"))), false);
      await outside.evaluate(() => window.fixtureControl.offline());
      assert.equal(await outside.getByTestId("popup").isVisible(), true);
      results.push({ width, scenario: "outside-context-unchanged", passed: true }); await outside.close();

      currentScenario = `${width}-desktop-offline-bypass`;
      const desktop = await pageFor(width, "dialog", "&desktop=1"); await open(desktop); await desktop.evaluate(() => window.fixtureControl.offline());
      assert.equal(await desktop.getByTestId("popup").isVisible(), true);
      assert.equal(await desktop.getByTestId("popup").evaluate(node => Boolean(node.closest("[inert]"))), false);
      results.push({ width, scenario: "desktop-offline-bypass", passed: true }); await desktop.close();

      currentScenario = `${width}-cold-start-gated`;
      const cold = await pageFor(width, "dialog", "&cold=1");
      assert.equal(await cold.getByTestId("runtime").count(), 0); assert.equal(await cold.getByTestId("popup").count(), 0);
      results.push({ width, scenario: "cold-start-gated", passed: true }); await cold.close();
    }

    currentScenario = "iPhone-like-drawer-root-cleanup";
    const iosDrawer = await pageFor(390, "drawer", "&ios=1"); await open(iosDrawer, "drawer");
    await iosDrawer.getByLabel("Draft note").fill("Retain iPhone-like drawer draft");
    await iosDrawer.waitForFunction(() => document.body.style.position === "fixed");
    for (let cycle = 0; cycle < 2; cycle++) {
      await iosDrawer.evaluate(() => window.fixtureControl.offline()); await paused(iosDrawer);
      await iosDrawer.waitForFunction(() => document.body.style.position !== "fixed");
      assert.equal(await touchBlocked(iosDrawer, "[data-offline-gate-recovery]"), false);
      await iosDrawer.getByRole("button", { name: "Try again", exact: true }).click(); await iosDrawer.getByTestId("popup").waitFor();
      assert.equal(await iosDrawer.getByLabel("Draft note").inputValue(), "Retain iPhone-like drawer draft");
    }
    await iosDrawer.evaluate(() => window.fixtureControl.offline()); await paused(iosDrawer);
    await iosDrawer.evaluate(() => window.fixtureControl.unmount()); await iosDrawer.getByText("Fixture unmounted", { exact: true }).waitFor();
    assert.equal(await iosDrawer.evaluate(() => document.body.style.position), "");
    assert.equal(await touchBlocked(iosDrawer, "body"), false);
    results.push({ scenario: "iPhone-like-drawer-root-cleanup", passed: true }); await iosDrawer.close();

    currentScenario = "iPhone-like-outside-drawer-unchanged";
    const iosOutside = await pageFor(390, "drawer", "&ios=1&outside=1"); await open(iosOutside, "drawer");
    await iosOutside.waitForFunction(() => document.body.style.position === "fixed");
    await iosOutside.evaluate(() => window.fixtureControl.offline());
    assert.equal(await iosOutside.getByTestId("popup").isVisible(), true);
    assert.equal(await iosOutside.evaluate(() => document.body.style.position), "fixed");
    assert.equal(await touchBlocked(iosOutside, "body"), true);
    results.push({ scenario: "iPhone-like-outside-drawer-unchanged", passed: true }); await iosOutside.close();
    save("results.json", JSON.stringify({ results, externalRequests, errors }, null, 2));
    assert.deepEqual(externalRequests, []); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ scenarios: results.length, passed: results.length, externalRequests: externalRequests.length, errors, artifacts: dir }, null, 2));
  } catch (error) {
    const page = browser?.contexts().at(-1)?.pages().at(-1);
    let state = null;
    if (page) {
      await page.screenshot({ path: path.join(dir, "failure.png") }).catch(() => {});
      state = await page.evaluate(() => ({ text: document.body.innerText, stats: window.fixtureControl?.stats() })).catch(() => null);
    }
    save("failure.json", JSON.stringify({ currentScenario, completed: results, state, errors }, null, 2));
    throw new Error(`${currentScenario}: ${error.message}`, { cause: error });
  } finally { if (browser) await browser.close(); if (server) await server.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
