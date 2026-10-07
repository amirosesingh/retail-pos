#!/usr/bin/env node

// Live warehouse smoke: signs in through the visible Electron UI, creates a
// uniquely named stocked product, and raises/approves/dispatches a one-unit
// transfer from the main warehouse to its ground-floor sub-warehouse.
const { _electron: electron } = require("@playwright/test");

const username = process.env.POS_E2E_WAREHOUSE_USERNAME;
const pin = process.env.POS_E2E_WAREHOUSE_PASSWORD;
if (!username || !pin) throw new Error("Set the warehouse E2E credentials at runtime.");

const baseURL = process.env.POS_E2E_BASE_URL || "http://127.0.0.1:8080";

async function mainWindow(app) {
  await app.firstWindow({ timeout: 30_000 });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const page = app.windows().find((candidate) => {
      try { return new URL(candidate.url()).pathname !== "/display"; }
      catch { return false; }
    });
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The main Electron window did not open.");
}

async function signOut(page) {
  const profile = page.getByRole("button", { name: /Open profile for/ });
  if (!(await profile.isVisible())) return;
  await profile.click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click({ force: true });
  await page.getByText("Terminal sign in", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
}

async function signIn(page) {
  await page.getByLabel("Or enter a username").fill(username);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  for (const digit of pin) await page.getByRole("button", { name: digit, exact: true }).click();
  const explicitSignIn = page.getByRole("button", { name: "Sign in", exact: true });
  if (await explicitSignIn.count()) await explicitSignIn.click();
  await page.getByRole("button", { name: /Open profile for/ }).waitFor({ state: "visible", timeout: 45_000 });
  // AppShell records the new operator identity before allowing a protected
  // deep link. Let that effect settle so the first route is not intentionally
  // returned to the workspace as a stale page from the previous operator.
  await page.waitForTimeout(1_000);
}

async function query(page, table, options) {
  const result = await page.evaluate(({ table, options }) => window.pos.query(table, options), { table, options });
  if (!result?.ok) throw new Error(`${table} query failed: ${result?.error || result?.code}`);
  return result.rows || [];
}

async function openInventoryLink(page, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const link = page.getByRole("link", { name: new RegExp(`^${escaped}`) });
  if (!(await link.isVisible())) {
    await page.getByRole("link", { name: "Inventory", exact: true }).click();
  }
  try {
    await link.waitFor({ state: "visible", timeout: 10_000 });
  } catch (error) {
    const body = (await page.locator("body").innerText().catch(() => "")).slice(0, 5_000);
    throw new Error(`Inventory section did not expose ${name}. ${JSON.stringify({ url: page.url(), body })}`, { cause: error });
  }
  await link.click();
}

function fieldInput(dialog, label) {
  return dialog.getByText(label, { exact: typeof label === "string" }).locator("..").locator("input").first();
}

async function waitForAutomaticSync(page) {
  let status = null;
  for (let attempt = 0; attempt < 45; attempt += 1) {
    status = await page.evaluate(() => window.pos.sync.getStatus());
    const pending = Number(status?.pending ?? status?.pendingCount ?? 0);
    if (!status?.running && pending === 0 && !status?.lastError) return status;
    await page.waitForTimeout(1_000);
  }
  return status;
}

async function main() {
  const marker = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const productName = `SMOKE Warehouse Product ${marker}`;
  const sku = `SMKWH${marker}`;
  const consoleErrors = [];
  const pageErrors = [];
  const network = [];
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [".", "--disable-gpu", "--no-sandbox"],
    cwd: process.cwd(),
    env: { ...process.env, VITE_DEV_SERVER_URL: baseURL },
  });
  try {
    const page = await mainWindow(app);
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("Silent print failed")) consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("request", (request) => {
      if (request.method() !== "GET") network.push({ phase: "request", method: request.method(), url: request.url() });
    });
    page.on("response", (response) => {
      if (response.request().method() !== "GET") network.push({ phase: "response", status: response.status(), url: response.url() });
    });
    await page.waitForFunction(() => Boolean(window.pos), null, { timeout: 30_000 });
    try {
      await page.getByText("Terminal sign in", { exact: true })
        .or(page.getByRole("button", { name: /Open profile for/ }))
        .first().waitFor({ state: "visible", timeout: 45_000 });
    } catch (error) {
      const body = (await page.locator("body").innerText().catch(() => "")).slice(0, 8_000);
      throw new Error(`Warehouse terminal did not reach sign-in or an active profile. ${JSON.stringify({ url: page.url(), body, consoleErrors, pageErrors })}`, { cause: error });
    }
    await signOut(page);
    await signIn(page);

    await openInventoryLink(page, "Inventory Catalog");
    try {
      await page.getByRole("button", { name: "New product", exact: true }).waitFor({ state: "visible", timeout: 45_000 });
    } catch (error) {
      const diagnostic = {
        url: page.url(),
        body: (await page.locator("body").innerText().catch(() => "")).slice(0, 8_000),
        database: await page.evaluate(() => window.pos.database.getState()).catch(() => null),
        sync: await page.evaluate(() => window.pos.sync.getStatus()).catch(() => null),
      };
      throw new Error(`Warehouse inventory did not become actionable. ${JSON.stringify(diagnostic)}`, { cause: error });
    }
    await page.getByRole("button", { name: "New product", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "New product", exact: true }).waitFor({ state: "visible" });
    await fieldInput(dialog, "Name").fill(productName);
    const skuInput = fieldInput(dialog, "SKU");
    // Use the supported manual override for this destructive smoke record so
    // the later transfer can find one deterministic code. Auto-SKU is covered
    // separately by the signed lease relay regression.
    if (!(await skuInput.isEditable())) {
      await dialog.getByRole("button", { name: "Override this code", exact: true }).click();
    }
    await skuInput.fill(sku);
    await fieldInput(dialog, "Price").fill("10");
    await fieldInput(dialog, /^Stock ·/).fill("5");
    await dialog.getByRole("button", { name: "Save product", exact: true }).click();
    try {
      await dialog.waitFor({ state: "hidden", timeout: 20_000 });
    } catch (error) {
      const diagnostic = {
        url: page.url(),
        dialog: (await dialog.innerText().catch(() => "")).slice(0, 5_000),
        body: (await page.locator("body").innerText().catch(() => "")).slice(-5_000),
        toasts: await page.locator("[data-sonner-toast]").allInnerTexts().catch(() => []),
        localProducts: await query(page, "products", {
          columns: "id,name,sku,owner_store_id,stock_by_store,row_version",
          match: { name: productName },
          limit: 5,
        }).catch((queryError) => [{ queryError: queryError.message }]),
        database: await page.evaluate(() => window.pos.database.getState()).catch(() => null),
        activeJob: await page.evaluate(() => window.pos.jobs.getActive()).catch(() => null),
        locks: await page.evaluate(() => navigator.locks?.query?.()).catch(() => null),
        network: network.slice(-30),
        consoleErrors,
        pageErrors,
      };
      throw new Error(`Warehouse product save did not complete. ${JSON.stringify(diagnostic)}`, { cause: error });
    }

    const [product] = await query(page, "products", {
      columns: "id,name,sku,owner_store_id,stock_by_store,row_version",
      match: { name: productName },
      limit: 1,
    });
    if (!product) throw new Error("The new warehouse product was not written to local SQL.");

    await openInventoryLink(page, "Stock Transfers");
    await page.getByRole("link", { name: "New transfer", exact: true }).click();
    const picker = page.getByLabel("Scan or search products");
    await picker.waitFor({ state: "visible", timeout: 45_000 });
    await picker.fill(product.sku);
    await picker.press("Enter");
    await page.getByText(productName, { exact: true }).last().waitFor({ state: "visible", timeout: 15_000 });

    const destination = page.getByRole("combobox").first();
    await destination.click();
    await page.getByRole("option", { name: /Warehouse 1 .* Ground Floor/i }).click();
    const transferNote = `Automated warehouse smoke ${marker}`;
    await page.getByLabel("Note").fill(transferNote);
    const submit = page.getByRole("button", { name: /^(Raise transfer|Send for approval)/ }).first();
    await submit.click();
    const authorizationDialog = page.getByRole("dialog", { name: /Authorise stock transfer/i });
    const authorizationRequired = await authorizationDialog
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (authorizationRequired) {
      await authorizationDialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await authorizationDialog.waitFor({ state: "hidden", timeout: 30_000 });
      const sync = await waitForAutomaticSync(page);
      console.log(JSON.stringify({
        ok: true,
        product: { id: product.id, name: product.name, sku: product.sku, rowVersion: product.row_version },
        transfer: { skipped: true, reason: "approval_required", destination: "ground-floor" },
        sync: { phase: sync?.phase ?? null, pending: sync?.pending ?? sync?.pendingCount ?? null, failed: sync?.failed ?? null, lastError: sync?.lastError ?? null },
        consoleErrors,
        pageErrors,
      }, null, 2));
      if (consoleErrors.length || pageErrors.length) process.exitCode = 1;
      return;
    }
    let transfer = null;
    for (let attempt = 0; attempt < 30 && !transfer; attempt += 1) {
      [transfer] = await query(page, "stock_transfers", {
        columns: "id,ref,from_store_id,to_store_id,status,row_version,created_at,note",
        match: { note: transferNote },
        limit: 1,
      });
      if (!transfer) await page.waitForTimeout(1_000);
    }
    if (!transfer) {
      throw new Error(`The warehouse transfer was not written to local SQL. ${JSON.stringify({ url: page.url(), body: (await page.locator("body").innerText()).slice(-6_000), toasts: await page.locator("[data-sonner-toast]").allInnerTexts().catch(() => []), network: network.slice(-30), consoleErrors, pageErrors })}`);
    }
    const transferId = transfer.id;
    if (!new URL(page.url()).pathname.endsWith(`/${transferId}`)) {
      await page.goto(`${baseURL}/transfers/${transferId}`, { waitUntil: "domcontentloaded" });
    }

    [transfer] = await query(page, "stock_transfers", {
      columns: "id,ref,from_store_id,to_store_id,status,row_version,created_at",
      match: { id: transferId },
      limit: 1,
    });

    if (transfer.status === "awaiting_approval") {
      await page.getByRole("button", { name: "Approve", exact: true }).click();
      const approveDialog = page.getByRole("dialog");
      await approveDialog.getByRole("button", { name: /^Approve ·/ }).click();
      await approveDialog.waitFor({ state: "hidden", timeout: 30_000 });
    }
    await page.getByRole("button", { name: "Dispatch", exact: true }).waitFor({ state: "visible", timeout: 30_000 });
    await page.getByRole("button", { name: "Dispatch", exact: true }).click();
    const dispatchDialog = page.getByRole("dialog");
    await dispatchDialog.getByRole("button", { name: /^Dispatch ·/ }).click();
    await dispatchDialog.waitFor({ state: "hidden", timeout: 30_000 });

    [transfer] = await query(page, "stock_transfers", {
      columns: "id,ref,from_store_id,to_store_id,status,row_version,created_at,dispatched_at",
      match: { id: transferId },
      limit: 1,
    });
    const items = await query(page, "stock_transfer_items", {
      columns: "id,transfer_id,product_id,quantity,quantity_dispatched,row_version",
      match: { transfer_id: transferId },
      limit: 10,
    });
    const sync = await waitForAutomaticSync(page);
    console.log(JSON.stringify({
      ok: true,
      product: { id: product.id, name: product.name, sku: product.sku, rowVersion: product.row_version },
      transfer,
      items,
      sync: {
        phase: sync?.phase ?? null,
        pending: sync?.pending ?? sync?.pendingCount ?? null,
        failed: sync?.failed ?? null,
        lastError: sync?.lastError ?? null,
      },
      consoleErrors,
      pageErrors,
    }, null, 2));
    if (transfer?.status !== "dispatched" || items.length !== 1 || consoleErrors.length || pageErrors.length) process.exitCode = 1;
  } finally {
    const closed = await Promise.race([
      app.close().then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 10_000)),
    ]);
    if (!closed) app.process().kill();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, code: error?.code || "EFAILED", error: error?.message || String(error) }));
  process.exitCode = 1;
});
