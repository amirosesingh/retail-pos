// Isolated synthetic fixture only. No app profile, credentials or backend requests.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { chromium } from "@playwright/test";
assert.deepEqual(process.argv.slice(2), ["--run"]);
const root = process.cwd(), fixture = resolve(root, ".tmp/trading-chart-browser");
await mkdir(fixture, { recursive: true });
await writeFile(resolve(fixture, "money.ts"), `export const money=(value:number)=>'B$'+value.toFixed(2);`);
await writeFile(resolve(fixture, "index.html"), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/fixture.tsx"></script></body></html>`);
await writeFile(resolve(fixture, "fixture.tsx"), `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import '${resolve(root, "src/styles.css").replaceAll("\\", "/")}';
import{ShopComparisonCharts}from'@/platforms/web/components/pos/ShopComparisonCharts';
import{TradingRangePresets}from'@/platforms/web/components/pos/TradingRangePresets';
import{useConfirmedPresentation}from'@/lib/use-confirmed-presentation';
const stores=[{id:'A',name:'Airport'},{id:'B',name:'Town'}];
const day=(id,revenue,cost)=>({store_id:id,sale_day:'2026-11-06',sale_month:'2026-11',bills:2,revenue,cost,profit:revenue-cost,discount:0,foc_value:0,units:2});
const hours=[{store_id:'A',hour:8,bills:2,revenue:90,cost:40,profit:50},{store_id:'B',hour:9,bills:4,revenue:120,cost:150,profit:-30}];
function Fixture(){const[scope,S]=useState('A'),[ready,R]=useState(false),[zero,Z]=useState(false),[cost,C]=useState(true),[error,E]=useState(false),[hour,H]=useState(true),[range,T]=useState({from:'2026-11-01',to:'2026-11-06'});
const rows=zero?[]:[day('A',90,40),day('B',120,150)];
const data=useConfirmedPresentation(scope+'|'+cost+'|'+range.from+'|'+range.to,{rows,hours},ready&&!error);
return <main className="mx-auto max-w-7xl space-y-4 p-4"><h1>Trading chart acceptance fixture</h1><div className="flex flex-wrap gap-2">{[
['Load',()=>{R(true);Z(false);E(false)}],['Refreshing',()=>{R(false);Z(true)}],['Failure',()=>{R(false);E(true)}],['Scope B',()=>{S('B');R(false);E(false)}],
['Zero',()=>{R(true);Z(true)}],['Deny cost',()=>{C(false);R(false)}],['Allow cost',()=>{C(true);R(false)}],['Missing hours',()=>H(false)]
].map(([label,run])=><button className="rounded border p-2" key={label} onClick={run}>{label}</button>)}</div>
<TradingRangePresets today="2026-11-06" from={range.from} to={range.to} onChange={(next)=>{T(next);R(false)}}/><p data-range>{range.from} / {range.to}</p>
<p role="status">{error?'Refresh failed; showing last confirmed values':!ready?'Loading current report':'Confirmed report'}</p>
{data&&<ShopComparisonCharts rows={data.rows} directory={stores} selectedIds={[scope]} showProfit={cost} scopeLabel={scope==='A'?'Airport':'Town'} range={range}
financialRows={data.rows.map(row=>({id:row.store_id,name:stores.find(s=>s.id===row.store_id).name,...row,marginPct:row.revenue?row.profit/row.revenue*100:0}))}
transactionHours={data.hours} profitHours={hour?data.hours:null} hourlyError={hour?undefined:'The hourly read failed; no zero substitution.'}/>}
</main>};createRoot(document.getElementById('root')).render(<Fixture/>);`);
let server, browser;
try {
  server = await createServer({ configFile: false, envDir: false, root: fixture,
    cacheDir: resolve(fixture, "vite-cache"), plugins: [tailwind(), react()],
    resolve: { alias: [{ find: "@/lib/pos-store", replacement: resolve(fixture, "money.ts") }, { find: "@", replacement: resolve(root, "src") }] },
    server: { host: "127.0.0.1", port: 0, fs: { allow: [resolve(root, "../.."), root, fixture] } },
  });
  await server.listen(); const url = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const errors = [], unexpected = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (!request.url().startsWith(url) && !request.url().startsWith("data:")) unexpected.push(request.url()); });
  await page.goto(url); await page.getByRole("button", { name: "Load", exact: true }).waitFor();
  const cards = page.locator('[data-trading-chart-card="fixed"]');
  assert.equal(await cards.count(), 0, "unknown report must not flash seeded cards");
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await cards.first().waitFor(); assert.equal(await cards.count(), 5);
  await page.locator(".recharts-surface").first().waitFor();
  const measure = () => page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-trading-chart-card="fixed"]')].map(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    const plots = [...document.querySelectorAll('[data-trading-chart-plot="fixed"]')].map(node => node.getBoundingClientRect().height);
    const region = document.querySelector('[role="region"]');
    return { cards, plots, scrollHeight: region.scrollHeight, clientHeight: region.clientHeight,
      scrollbar: getComputedStyle(region).scrollbarWidth, horizontal: document.documentElement.scrollWidth > innerWidth };
  });
  let sizes = await measure();
  assert(sizes.cards.every(card => card.height === 448)); assert(sizes.plots.every(height => height === 256));
  assert.equal(sizes.cards[0].y, sizes.cards[1].y); assert(sizes.cards[1].x > sizes.cards[0].x);
  assert(sizes.scrollHeight > sizes.clientHeight); assert.equal(sizes.scrollbar, "none"); assert(!sizes.horizontal);
  await page.screenshot({ path: resolve(fixture, "desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); sizes = await measure();
  assert(sizes.cards.every(card => card.height === 448 && card.x === sizes.cards[0].x));
  assert(sizes.cards[1].y > sizes.cards[0].y); assert(sizes.plots.every(height => height === 256)); assert(!sizes.horizontal);
  const region = page.locator('[role="region"][tabindex="0"]'); await region.focus(); await page.keyboard.press("PageDown");
  await page.waitForFunction(() => document.querySelector('[role="region"]').scrollTop > 0);
  await region.evaluate(async node => {
    let previous = -1, stable = 0;
    for (let frame = 0; frame < 60 && stable < 3; frame++) {
      await new Promise(requestAnimationFrame); stable = node.scrollTop === previous ? stable + 1 : 0; previous = node.scrollTop;
    }
    node.scrollTo({ top: 0, behavior: "instant" });
    await new Promise(requestAnimationFrame);
  });
  await page.screenshot({ path: resolve(fixture, "phone.png"), fullPage: true });
  await page.getByRole("button", { name: "Refreshing", exact: true }).click(); assert.equal(await cards.count(), 5);
  await page.getByRole("button", { name: "Failure", exact: true }).click(); assert.equal(await cards.count(), 5);
  assert(await page.getByText("Refresh failed; showing last confirmed values", { exact: true }).isVisible());
  await page.getByRole("button", { name: "Scope B", exact: true }).click(); assert.equal(await cards.count(), 0);
  await page.getByRole("button", { name: "Load", exact: true }).click(); assert.equal(await cards.count(), 5);
  assert(await page.getByRole("heading", { name: "Gross profit trend", exact: true }).count(), "negative profit remains meaningful");
  await page.getByLabel("Shop comparison chart", { exact: true }).selectOption("bar");
  await page.getByLabel("Shop chart grouping", { exact: true }).selectOption("monthly");
  assert.equal(await cards.count(), 5);
  await page.getByRole("button", { name: "Deny cost", exact: true }).click(); assert.equal(await cards.count(), 0);
  await page.getByRole("button", { name: "Load", exact: true }).click(); assert.equal(await cards.count(), 3);
  assert.equal(await page.getByRole("heading", { name: /Gross profit/ }).count(), 0);
  assert.deepEqual(await page.getByLabel("Financial chart measure").locator("option").allTextContents(), ["Revenue"]);
  await page.getByRole("button", { name: "Allow cost", exact: true }).click();
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await page.getByRole("button", { name: "Missing hours", exact: true }).click(); assert.equal(await cards.count(), 4);
  assert(await page.getByText(/Hourly gross profit unavailable/).isVisible());
  await page.getByRole("button", { name: "Zero", exact: true }).click(); assert.equal(await cards.count(), 1, "transactions still exist independently of zero financial rows");
  await page.getByRole("button", { name: "15 days", exact: true }).click(); assert.equal(await cards.count(), 0);
  assert.equal(await page.locator("[data-range]").textContent(), "2026-10-23 / 2026-11-06");
  await page.getByRole("button", { name: "20 days", exact: true }).click();
  assert.equal(await page.locator("[data-range]").textContent(), "2026-10-18 / 2026-11-06");
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  console.log("PASS actual Chrome charts: 1440px/390px equal heights, fixed plots, 2/1 columns, keyboard vertical scroll, hidden bar, no horizontal overflow, confirmed loading/refresh/error/scope, negative/cost denial, in-place controls and date presets.");
} finally { await browser?.close(); await server?.close(); }
