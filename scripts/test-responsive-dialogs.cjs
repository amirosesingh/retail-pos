const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("@playwright/test");
async function main() {
  const root = process.cwd();
  const dir = path.join(root, "work", "responsive-dialog-test");
  fs.mkdirSync(dir, {recursive:true});
  fs.writeFileSync(path.join(dir, "index.html"), '<div id="root"></div><script type="module" src="/work/responsive-dialog-test/main.tsx"></script>');
  fs.writeFileSync(path.join(dir, "main.tsx"), `
import React from "react";
import {createRoot} from "react-dom/client";
import {Dialog,DialogContent,DialogTitle,DialogDescription} from "@/components/ui/dialog";
import {Table,TableHeader,TableHead,TableBody,TableRow,TableCell} from "@/components/ui/table";
import "@/styles.css";
createRoot(document.getElementById("root")).render(<Dialog open><DialogContent className="sm:max-w-lg"><DialogTitle>Stock details</DialogTitle><DialogDescription>Responsive stock view</DialogDescription><Table><TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Quantity</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell className="whitespace-nowrap"><span>{"Long product identifier ".repeat(10)}</span></TableCell><TableCell>120</TableCell><TableCell><button>Open product</button></TableCell></TableRow></TableBody></Table></DialogContent></Dialog>);
`);
  const {createServer} = await import("vite");
  const react = (await import("@vitejs/plugin-react")).default;
  const tailwind = (await import("@tailwindcss/vite")).default;
  let server, browser;
  try {
    server = await createServer({configFile:false,root,cacheDir:path.join(dir,".vite"),plugins:[react(),tailwind()],resolve:{alias:{"@":path.join(root,"src")}},server:{host:"127.0.0.1",port:0},logLevel:"error"});
    await server.listen();
    browser = await chromium.launch({channel:"chrome",headless:true,args:["--disable-gpu"]});
    for (const width of [320,390,768,1440]) {
      const page = await browser.newPage({viewport:{width,height:800}});
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/work/responsive-dialog-test/index.html`);
      await page.locator('[role="dialog"]').waitFor();
      await page.waitForTimeout(400);
      const result = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        const region = document.querySelector('.responsive-table-region');
        const bounds = dialog.getBoundingClientRect();
        return {left:bounds.left,right:bounds.right,width:bounds.width,overflow:dialog.scrollWidth > dialog.clientWidth + 1,regionOverflow:region.scrollWidth > region.clientWidth + 1,card:getComputedStyle(document.querySelector('tbody tr')).display};
      });
      assert(result.left >= 0 && result.right <= width + 1, JSON.stringify(result));
      assert(!result.overflow, JSON.stringify(result));
      if (width < 640) { assert.equal(result.card,"block"); assert(!result.regionOverflow,JSON.stringify(result)); }
      if (width === 1440) assert(result.width > 1200,JSON.stringify(result));
      if (width === 1440) {
        await page.evaluate(() => document.querySelector('table').remove());
        const compactWidth = await page.locator('[role="dialog"]').evaluate(dialog => dialog.getBoundingClientRect().width);
        assert(compactWidth <= 520, `Compact dialog expanded to ${compactWidth}px`);
      }
      console.log(`Responsive dialog passed at ${width}px`);
      await page.close();
    }
  } finally { if(browser) await browser.close(); if(server) await server.close(); }
}
main().catch(error => {console.error(error);process.exitCode=1;});
