#!/usr/bin/env node

// Browser regression for administrator email/password sign-in when the
// origin's localStorage is already full. Credentials are accepted only from
// process env and are never printed.
const { chromium } = require("@playwright/test");

const email = process.env.POS_E2E_ADMIN_EMAIL;
const password = process.env.POS_E2E_ADMIN_PASSWORD;
const baseURL = process.env.POS_E2E_BASE_URL || "http://127.0.0.1:8080";
if (!email || !password) throw new Error("Set the admin E2E credentials at runtime.");

async function authRecordPresent(page) {
  return page.evaluate(() =>
    new Promise((resolve) => {
      const request = indexedDB.open("retail-pos-auth", 1);
      request.onerror = () => resolve(false);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("tokens")) {
          request.result.createObjectStore("tokens");
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        const read = db.transaction("tokens", "readonly").objectStore("tokens").get("sb-external-auth-token");
        read.onerror = () => { db.close(); resolve(false); };
        read.onsuccess = () => { db.close(); resolve(typeof read.result === "string" && read.result.length > 0); };
      };
    }),
  );
}

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    const uncaught = [];
    page.on("pageerror", (error) => uncaught.push(error.message));
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      // Leave enough headroom for normal small preferences, but not for the
      // former localStorage-backed Supabase session.
      const block = "x".repeat(256 * 1024);
      for (let index = 0; index < 32; index += 1) {
        try { localStorage.setItem(`pos.quota-smoke.${index}`, block); }
        catch { break; }
      }
      localStorage.removeItem("sb-external-auth-token");
    });

    const adminTab = page.getByRole("tab", { name: "Supervisor / Admin", exact: true });
    await adminTab.waitFor({ state: "visible", timeout: 20_000 });
    await adminTab.click();
    try {
      await page.getByLabel("Email or username").waitFor({ state: "visible", timeout: 20_000 });
    } catch (error) {
      throw new Error(`Admin login form did not appear. ${JSON.stringify({ url: page.url(), body: (await page.locator("body").innerText()).slice(0, 6_000) })}`, { cause: error });
    }
    await page.getByLabel("Email or username").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: /Open profile for/ }).waitFor({ state: "visible", timeout: 45_000 });

    const result = await page.evaluate(() => ({
      legacyLocalToken: localStorage.getItem("sb-external-auth-token") !== null,
      quotaBytes: Array.from({ length: localStorage.length }, (_, i) => localStorage.getItem(localStorage.key(i) || "")?.length || 0)
        .reduce((sum, size) => sum + size, 0),
    }));
    result.indexedDbToken = await authRecordPresent(page);
    result.uncaught = uncaught;
    result.ok = result.indexedDbToken && !result.legacyLocalToken && uncaught.length === 0;
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }));
  process.exitCode = 1;
});
