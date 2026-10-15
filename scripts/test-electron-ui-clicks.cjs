const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("@playwright/test");

async function main() {
  const watchdog = setTimeout(() => { console.error("UI click regression timed out."); process.exit(1); }, 60000);
  const root = process.cwd();
  const fixtureDir = path.join(root, "work", "ui-click-regression");
  fs.mkdirSync(fixtureDir, { recursive: true });
  fs.writeFileSync(path.join(fixtureDir, "index.html"), '<!doctype html><html><body><div id="root"></div><script type="module" src="/work/ui-click-regression/main.tsx"></script></body></html>');
  fs.writeFileSync(path.join(fixtureDir, "main.tsx"), `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import "@/styles.css";
const dismissed: string[] = [];
window.clickHarness = { dismissed, show() {
  for (let n = 0; n < 3; n++) {
    const id = "notice-" + n;
    toast.info("Notification " + n, { id, description: "Stock has synchronized successfully.", duration: Infinity,
      closeButton: true, position: "top-right", className: "activity-notification-toast !w-[min(20rem,calc(100vw-1rem))] !gap-2 !p-3",
      onDismiss: () => dismissed.push(id) });
  }
} };
function Fixture() {
  const [actions, setActions] = useState(0);
  const [doubleActions, setDoubleActions] = useState(0);
  return <><main className="app-drag pos-scaled" style={{ padding: 48 }}>
    <button id="action" onClick={() => setActions(n => n + 1)}>Perform action</button>
    <button id="double-action" onDoubleClick={() => setDoubleActions(n => n + 1)}>Double-click action</button>
    <input id="entry" placeholder="Type a product" />
    <output id="actions">{actions}</output><output id="double-actions">{doubleActions}</output>
  </main><Toaster position="top-right" closeButton /></>;
}
createRoot(document.getElementById("root")).render(<Fixture />);
`);
  const { createServer } = await import("vite");
  const react = (await import("@vitejs/plugin-react")).default;
  const tailwind = (await import("@tailwindcss/vite")).default;
  let server;
  let browser;
  try {
    console.log("Preparing the isolated notification test page…");
    server = await createServer({ configFile: false, root,
      cacheDir: path.join(fixtureDir, ".vite"), plugins: [react(), tailwind()],
      resolve: { alias: { "@": path.join(root, "src") } },
      server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
    await server.listen();
    console.log("Launching headless Chrome…");
    const port = server.httpServer.address().port;
    browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-gpu", "--no-sandbox"] });
    const results = [];
    for (const profile of [
      { dpr: 1, font: 16, width: 1440, height: 900 },
      { dpr: 1.25, font: 20, width: 1280, height: 800 },
      { dpr: 1.5, font: 23, width: 1024, height: 768 },
      { dpr: 2, font: 26, width: 900, height: 700 },
    ]) {
      console.log("Checking display scale", profile.dpr, "and text size", profile.font);
      const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: profile.dpr });
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${port}/work/ui-click-regression/index.html`);
      await page.waitForFunction(() => !!window.clickHarness);
      await page.evaluate(font => { document.documentElement.style.fontSize = font + "px"; window.clickHarness.show(); }, profile.font);
      const toasts = page.locator('[data-sonner-toast][data-mounted="true"]');
      await page.waitForFunction(() => document.querySelectorAll('[data-sonner-toast][data-mounted="true"]').length === 3);
      await page.waitForFunction(() => [...document.querySelectorAll('[data-sonner-toast]')].every(node => node.getAttribute('data-expanded') === 'true'));
      for (let n = 0; n < 3; n++) {
        await page.waitForTimeout(450);
        const title = await toasts.first().locator("[data-title]").textContent();
        const card = page.locator("[data-sonner-toast]").filter({ hasText: title });
        const close = card.locator('[data-close-button]');
        const glyph = close.locator('svg');
        const before = await glyph.boundingBox();
        const point = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
        await page.mouse.move(point.x, point.y);
        await page.waitForTimeout(260);
        const after = await glyph.boundingBox();
        assert.ok(Math.abs(before.y - after.y) < 1, 'Close icon moved when hovered');
        assert.equal(await page.evaluate(({x,y}) => document.elementFromPoint(x,y)?.matches('[data-close-button]'), point), true, 'Visible cross is not the actual click target');
        await page.mouse.click(point.x, point.y);
        await card.waitFor({ state: "detached" });
      }
      assert.equal(await page.evaluate(() => window.clickHarness.dismissed.length), 3);
      await page.locator('#action').click();
      assert.equal(await page.locator('#actions').textContent(), '1');
      await page.locator('#double-action').dblclick();
      assert.equal(await page.locator('#double-actions').textContent(), '1');
      await page.locator('#entry').fill('Product 123');
      assert.equal(await page.locator('#entry').inputValue(), 'Product 123');
      assert.equal(await page.locator('main').evaluate(node => getComputedStyle(node).getPropertyValue('-webkit-app-region')), 'no-drag');
      results.push({ ...profile, closeButtons: '3/3', singleClick: true, doubleClick: true, typing: true });
      await context.close();
    }
    console.log(JSON.stringify({ ok: true, profiles: results }, null, 2));
  } finally {
    if (browser) await browser.close();
    if (server) await server.close();
    clearTimeout(watchdog);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
