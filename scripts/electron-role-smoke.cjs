#!/usr/bin/env node

// Destructive live smoke: creates one small cash sale as the cashier and one
// as the administrator. Credentials are supplied only through process env.
const { _electron: electron } = require("@playwright/test");

const adminEmail = process.env.POS_E2E_ADMIN_EMAIL;
const adminPassword = process.env.POS_E2E_ADMIN_PASSWORD;
const cashierUsername = process.env.POS_E2E_BRANCH_USERNAME;
const cashierPin = process.env.POS_E2E_BRANCH_PASSWORD;
const cashierOnly = process.env.POS_E2E_CASHIER_ONLY === "1";
if (!adminEmail || !adminPassword || !cashierUsername || !cashierPin) {
  throw new Error("Set the POS_E2E admin and branch-user credentials at runtime.");
}

const baseURL = "http://127.0.0.1:8080";

async function localState(page) {
  return page.evaluate(async () => {
    const pos = window.pos;
    const [database, sync, sales, products] = await Promise.all([
      pos.database.getState(),
      pos.sync.getStatus(),
      pos.query("sales", {
        columns: "id,bill_number,total_amount,created_at,cashier_name,row_version",
        orderBy: { column: "created_at", ascending: false },
        limit: 5,
      }),
      pos.query("products", {
        columns: "id,name,sku,selling_price,stock_by_store,is_archived,deleted_at",
        orderBy: { column: "name", ascending: true },
        limit: 20,
      }),
    ]);
    return {
      database: {
        connected: database?.connected ?? false,
        tradingReady: database?.tradingReady ?? false,
        state: database?.state ?? null,
      },
      sync: {
        connected: sync?.connected ?? false,
        paused: sync?.paused ?? false,
        errorCode: sync?.errorCode ?? sync?.code ?? null,
        pending: sync?.pending ?? sync?.pendingCount ?? null,
      },
      sales: sales?.rows ?? [],
      products: products?.rows ?? [],
    };
  });
}

async function waitForProfile(page, roleLabel) {
  try {
    await page.getByRole("button", { name: /Open profile for/ }).waitFor({ state: "visible", timeout: 45_000 });
  } catch (error) {
    const visible = (await page.locator("body").innerText()).slice(0, 8_000);
    throw new Error(`${roleLabel} sign-in did not reach the profile menu. ${JSON.stringify({ visible, cause: error.message })}`);
  }
}

async function signOut(page) {
  await page.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" });
  const terminalSignIn = page.getByText("Terminal sign in", { exact: true });
  for (let attempt = 0; attempt < 3 && !(await terminalSignIn.isVisible()); attempt += 1) {
    const profile = page.getByRole("button", { name: /Open profile for/ });
    await profile.waitFor({ state: "visible", timeout: 15_000 });
    await profile.click();
    const item = page.getByRole("menuitem", { name: "Sign out", exact: true });
    await item.waitFor({ state: "visible", timeout: 10_000 });
    try { await item.click({ force: true, timeout: 10_000 }); } catch { /* navigation can detach it */ }
    try { await terminalSignIn.waitFor({ state: "visible", timeout: 10_000 }); } catch { /* retry */ }
  }
  await terminalSignIn.waitFor({ state: "visible", timeout: 30_000 });
}

async function signInCashier(page) {
  await page.getByLabel("Or enter a username").fill(cashierUsername);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  for (const digit of cashierPin) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  const explicitSignIn = page.getByRole("button", { name: "Sign in", exact: true });
  if (await explicitSignIn.count()) await explicitSignIn.click();
  await waitForProfile(page, "cashier");
}

async function signInAdmin(page) {
  const adminTab = page.getByRole("tab", { name: "Supervisor / Admin", exact: true });
  await adminTab.waitFor({ state: "visible", timeout: 15_000 });
  await adminTab.click();
  await page.getByLabel("Email or username").waitFor({ state: "visible", timeout: 15_000 });
  await page.getByLabel("Email or username").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await waitForProfile(page, "admin");
}

async function completeSmallCashSale(page, roleLabel) {
  const before = await localState(page);
  const beforeIds = new Set(before.sales.map((sale) => String(sale.id)));
  await page.goto(`${baseURL}/?sell=true`, { waitUntil: "domcontentloaded" });
  const search = page.getByLabel("Search products");
  await search.waitFor({ state: "visible", timeout: 45_000 });

  const wanted = before.products.find((product) => {
    if (product.is_archived || product.deleted_at) return false;
    let stock = product.stock_by_store;
    try { if (typeof stock === "string") stock = JSON.parse(stock); } catch { return false; }
    return Object.values(stock ?? {}).some((value) => Number(value) > 0);
  });
  if (!wanted) throw new Error(`${roleLabel}: local SQL has no active in-stock product in the diagnostic page.`);
  await search.fill(String(wanted.sku || wanted.name));
  await page.waitForTimeout(500);
  const candidates = page.locator("button").filter({ hasText: /in stock/i });
  const count = await candidates.count();
  let selected = null;
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    const text = await candidate.innerText();
    const stock = Number(text.match(/([\d.]+)\s+in stock/i)?.[1] ?? 0);
    if (stock > 0 && (await candidate.isEnabled())) {
      selected = { locator: candidate, text };
      break;
    }
  }
  if (!selected) {
    const visible = (await page.locator("body").innerText()).slice(0, 8_000);
    throw new Error(`${roleLabel}: no in-stock product was available for the smoke sale. ${JSON.stringify({ before, visible })}`);
  }
  const overlay = page.locator("vite-error-overlay");
  if (await overlay.count()) {
    const overlayText = await overlay.evaluate((element) => element.shadowRoot?.textContent ?? element.textContent ?? "Unknown Vite error");
    throw new Error(`${roleLabel}: Vite runtime overlay blocked the register. ${overlayText}`);
  }
  await selected.locator.click();

  const charge = page.getByRole("button", { name: /^Charge / }).first();
  const chargeText = await charge.innerText();
  await charge.click();
  await page.getByText(/Take payment/).waitFor({ state: "visible", timeout: 15_000 });
  const amount = chargeText.match(/([\d,.]+)\s*$/)?.[1]?.replaceAll(",", "") ?? "1000";
  const cashLabel = page.getByText("Cash tendered", { exact: true });
  const cashInput = cashLabel.locator("..").locator("input");
  await cashInput.fill(amount);
  await page.getByRole("button", { name: "Complete & print", exact: true }).click();
  await page.getByRole("button", { name: "Complete & print", exact: true }).waitFor({ state: "hidden", timeout: 60_000 });

  let after;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    after = await localState(page);
    if (after.sales.some((sale) => !beforeIds.has(String(sale.id)))) break;
    await page.waitForTimeout(1_000);
  }
  const created = after.sales.find((sale) => !beforeIds.has(String(sale.id)));
  if (!created) throw new Error(`${roleLabel}: the completed sale did not appear in local SQL.`);
  return { role: roleLabel, product: selected.text, localSale: created, state: after };
}

async function main() {
  const consoleErrors = [];
  const pageErrors = [];
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [".", "--disable-gpu", "--no-sandbox"],
    cwd: process.cwd(),
    env: { ...process.env, VITE_DEV_SERVER_URL: baseURL },
  });
  try {
    const page = await app.firstWindow({ timeout: 30_000 });
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.waitForFunction(() => Boolean(window.pos), null, { timeout: 30_000 });
    const existingProfile = page.getByRole("button", { name: /Open profile for/ });
    const terminalSignIn = page.getByText("Terminal sign in", { exact: true });
    await terminalSignIn.or(existingProfile).first().waitFor({ state: "visible", timeout: 45_000 });
    if (await existingProfile.isVisible()) await signOut(page);
    await terminalSignIn.waitFor({ state: "visible", timeout: 30_000 });

    await signInAdmin(page);
    const adoption = await page.evaluate(async () => {
      const [{ readCredentials }, { readTerminalConfig }] = await Promise.all([
        import("/src/lib/pos-credentials.ts"),
        import("/src/core/activation/terminal-tokens.ts"),
      ]);
      const result = await window.sqlAdmin.adoptSession(await readCredentials(), readTerminalConfig());
      return { result, status: await window.sqlAdmin.status() };
    });
    const settingsAccess = {};
    for (const route of ["/settings", "/settings/updates", "/settings/database"]) {
      await page.goto(`${baseURL}${route}`, { waitUntil: "domcontentloaded" });
      settingsAccess[route] = !(await page.locator("body").innerText()).includes("Permission required");
    }
    const syncAttempt = await page.evaluate(() => window.pos.sync.runNow({ batchSize: 500 }));
    let afterInitialSync = await localState(page);
    let repair = null;
    if (!afterInitialSync.products.length) {
      repair = await page.evaluate(() => window.pos.sync.reconcile({ deep: false, repair: true }));
      await page.waitForTimeout(3_000);
      afterInitialSync = await localState(page);
    }
    if (!afterInitialSync.products.length) {
      throw new Error(`Initial sync left the local catalogue empty. ${JSON.stringify({ adoption, syncAttempt, repair, afterInitialSync })}`);
    }
    const admin = cashierOnly ? null : await completeSmallCashSale(page, "admin");
    await signOut(page);

    await signInCashier(page);
    const cashier = await completeSmallCashSale(page, "cashier");
    const reconciliation = await page.evaluate(() => window.pos.sync.reconcile({ deep: false }));
    await page.waitForTimeout(3_000);
    const finalState = await localState(page);

    const result = { admin, cashier, settingsAccess, adoption, syncAttempt, repair, afterInitialSync, reconciliation, finalState, consoleErrors, pageErrors };
    console.log(JSON.stringify({ ok: true, result }, null, 2));
    if (
      !cashier.state.database.connected ||
      (admin && !admin.state.database.connected) ||
      !Object.values(settingsAccess).every(Boolean) ||
      consoleErrors.length ||
      pageErrors.length
    ) process.exitCode = 1;
  } finally {
    const closed = await Promise.race([
      app.close().then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 10_000)),
    ]);
    if (!closed) app.process().kill();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, code: error?.code ?? "EFAILED", error: error?.message ?? String(error) }));
  process.exitCode = 1;
});
