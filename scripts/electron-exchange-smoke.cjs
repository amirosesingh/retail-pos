#!/usr/bin/env node
// Destructive live smoke: completes one administrator exchange against the
// configured Electron SQL Server and leaves the resulting audit rows intact.
const { _electron: electron } = require("@playwright/test");

const adminEmail = process.env.POS_E2E_ADMIN_EMAIL;
const adminPassword = process.env.POS_E2E_ADMIN_PASSWORD;
const verifyOriginalBill = process.env.POS_E2E_EXCHANGE_VERIFY_BILL || "";
if (!adminEmail || !adminPassword) throw new Error("Set the administrator E2E credentials at runtime.");
const baseURL = "http://127.0.0.1:8080";

async function signOut(page) {
  const profile = page.getByRole("button", { name: /Open profile for/ });
  if (!(await profile.isVisible())) return;
  await profile.click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click({ force: true });
  await page.getByText("Terminal sign in", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
}

async function signInAdmin(page) {
  await page.getByRole("tab", { name: "Supervisor / Admin", exact: true }).click();
  await page.getByLabel("Email or username").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: /Open profile for/ }).waitFor({ state: "visible", timeout: 45_000 });
}

async function query(page, table, options) {
  const result = await page.evaluate(
    ({ table, options }) => window.pos.query(table, options),
    { table, options },
  );
  if (!result?.ok) throw new Error(`${table} query failed: ${result?.error || result?.code}`);
  return result.rows || [];
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
      if (message.type() === "error" && !message.text().includes("Silent print failed")) {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.waitForFunction(() => Boolean(window.pos), null, { timeout: 30_000 });
    await page.getByText("Terminal sign in", { exact: true })
      .or(page.getByRole("button", { name: /Open profile for/ }))
      .first().waitFor({ state: "visible", timeout: 45_000 });
    await signOut(page);
    await signInAdmin(page);

    const adoption = await page.evaluate(async () => {
      const [{ readCredentials }, { readTerminalConfig }] = await Promise.all([
        import("/src/lib/pos-credentials.ts"),
        import("/src/core/activation/terminal-tokens.ts"),
      ]);
      return window.sqlAdmin.adoptSession(await readCredentials(), readTerminalConfig());
    });
    if (!adoption?.ok) throw new Error(`Admin SQL authority was not adopted: ${JSON.stringify(adoption)}`);
    await page.evaluate(() => window.pos.sync.runNow({ batchSize: 500 }));

    if (verifyOriginalBill) {
      const exchanges = await query(page, "sales", {
        columns: "id,bill_number,store_id,total_amount,is_exchange,original_bill_number,created_at",
        match: { original_bill_number: verifyOriginalBill },
        orderBy: { column: "created_at", ascending: false },
        limit: 5,
      });
      const exchange = exchanges[0];
      if (!exchange) throw new Error(`No local exchange exists for ${verifyOriginalBill}.`);
      const [original] = await query(page, "sales", {
        columns: "id,bill_number,exchanged_to_bill_number,row_version",
        match: { bill_number: verifyOriginalBill },
        limit: 1,
      });
      const items = await query(page, "sale_items", {
        columns: "id,sale_id,product_id,product_name,unit_price,quantity,is_return",
        match: { sale_id: exchange.id },
        limit: 20,
      });
      const sync = await page.evaluate(() => window.pos.sync.runNow({ batchSize: 500 }));
      await page.waitForTimeout(3_000);
      const status = await page.evaluate(() => window.pos.sync.getStatus());
      console.log(JSON.stringify({ ok: true, verificationOnly: true, original, exchange, items, sync, status, consoleErrors, pageErrors }, null, 2));
      if (original?.exchanged_to_bill_number !== exchange.bill_number || items.length < 2 || consoleErrors.length || pageErrors.length)
        process.exitCode = 1;
      return;
    }

    const sales = await query(page, "sales", {
      columns: "id,bill_number,store_id,total_amount,is_refunded,is_exchange,original_bill_number,exchanged_to_bill_number,created_at",
      orderBy: { column: "created_at", ascending: false },
      limit: 100,
    });
    let original;
    let returnedItem;
    for (const candidate of sales) {
      if (candidate.is_refunded || candidate.exchanged_to_bill_number || candidate.is_exchange) continue;
      const items = await query(page, "sale_items", {
        columns: "id,sale_id,product_id,product_name,unit_price,quantity,discount_amount,is_return",
        match: { sale_id: candidate.id },
        limit: 50,
      });
      const eligible = items.find((item) => Number(item.quantity) > 0 && !item.is_return);
      if (eligible) {
        original = candidate;
        returnedItem = eligible;
        break;
      }
    }
    if (!original || !returnedItem) throw new Error("No recent unrefunded, unexchanged sale with a sold line is available.");

    const credit = Math.max(0, Number(returnedItem.unit_price) - Number(returnedItem.discount_amount || 0));
    const products = await query(page, "products", {
      columns: "id,name,sku,selling_price,stock_by_store,is_archived,deleted_at",
      orderBy: { column: "selling_price", ascending: false },
      limit: 500,
    });
    const replacement = products.find((product) => {
      if (product.is_archived || product.deleted_at || Number(product.selling_price) <= credit) return false;
      let stock = product.stock_by_store;
      try { if (typeof stock === "string") stock = JSON.parse(stock); } catch { return false; }
      return Number(stock?.[original.store_id] || 0) > 0;
    });
    if (!replacement) throw new Error(`No in-stock replacement priced above the ${credit} exchange credit is available.`);

    await page.goto(`${baseURL}/?sell=true`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Search products").waitFor({ state: "visible", timeout: 45_000 });
    await page.getByRole("button", { name: "Exchange", exact: true }).first().click();
    await page.getByRole("heading", { name: "Exchange item", exact: true }).waitFor({ state: "visible" });
    await page.getByPlaceholder("Scan or type original bill number…").fill(original.bill_number);
    await page.getByRole("button", { name: "Find", exact: true }).click();
    await page.getByText(original.bill_number, { exact: false }).waitFor({ state: "visible" });
    await page.getByLabel(`Exchange ${returnedItem.product_name}`, { exact: true }).check();
    await page.getByRole("button", { name: "Add credit to cart", exact: true }).click();

    const search = page.getByLabel("Search products");
    await search.fill(String(replacement.sku || replacement.name));
    await page.waitForTimeout(500);
    const productButton = page.locator("button").filter({ hasText: /in stock/i }).filter({ hasText: replacement.name }).first();
    await productButton.waitFor({ state: "visible", timeout: 15_000 });
    await productButton.click();

    const charge = page.getByRole("button", { name: /^Charge / }).first();
    const chargeText = await charge.innerText();
    const amount = chargeText.match(/([\d,.]+)\s*$/)?.[1]?.replaceAll(",", "");
    if (!amount || Number(amount) <= 0) throw new Error(`Expected a positive exchange balance, got: ${chargeText}`);
    await charge.click();
    await page.getByText("Take payment", { exact: false }).waitFor({ state: "visible", timeout: 15_000 });
    await page.getByText("Cash tendered", { exact: true }).locator("..").locator("input").fill(amount);
    await page.getByRole("button", { name: "Complete & print", exact: true }).click();
    await page.getByRole("button", { name: "Complete & print", exact: true }).waitFor({ state: "hidden", timeout: 60_000 });

    let exchange;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const rows = await query(page, "sales", {
        columns: "id,bill_number,store_id,total_amount,is_exchange,original_bill_number,created_at",
        match: { original_bill_number: original.bill_number },
        orderBy: { column: "created_at", ascending: false },
        limit: 5,
      });
      exchange = rows[0];
      if (exchange) break;
      await page.waitForTimeout(1_000);
    }
    if (!exchange) {
      const diagnostic = {
        body: (await page.locator("body").innerText()).slice(0, 12_000),
        database: await page.evaluate(() => window.pos.database.getState()),
        sync: await page.evaluate(() => window.pos.sync.getStatus()),
        recentSales: await query(page, "sales", {
          columns: "id,bill_number,total_amount,is_exchange,original_bill_number,exchanged_to_bill_number,created_at",
          orderBy: { column: "created_at", ascending: false },
          limit: 10,
        }),
      };
      throw new Error(`The completed exchange was not written to local SQL. ${JSON.stringify(diagnostic)}`);
    }

    const [originalAfter] = await query(page, "sales", {
      columns: "id,bill_number,exchanged_to_bill_number,row_version",
      match: { id: original.id },
      limit: 1,
    });
    const exchangeItems = await query(page, "sale_items", {
      columns: "id,sale_id,product_id,product_name,unit_price,quantity,is_return",
      match: { sale_id: exchange.id },
      limit: 20,
    });
    if (originalAfter?.exchanged_to_bill_number !== exchange.bill_number)
      throw new Error("Original bill was not linked to the replacement bill.");
    if (!exchangeItems.some((item) => item.is_return && Number(item.quantity) < 0))
      throw new Error("Exchange return line was not persisted.");
    if (!exchangeItems.some((item) => !item.is_return && Number(item.quantity) > 0))
      throw new Error("Exchange replacement line was not persisted.");

    const sync = await page.evaluate(() => window.pos.sync.runNow({ batchSize: 500 }));
    await page.waitForTimeout(3_000);
    const status = await page.evaluate(() => window.pos.sync.getStatus());
    console.log(JSON.stringify({
      ok: true,
      original: { id: original.id, bill: original.bill_number, linkedTo: originalAfter.exchanged_to_bill_number },
      exchange: { id: exchange.id, bill: exchange.bill_number, total: exchange.total_amount },
      returned: returnedItem.product_name,
      replacement: replacement.name,
      itemRows: exchangeItems.length,
      paymentRows: "verify in cloud after synchronization",
      sync: { result: sync, pending: status?.pending ?? status?.pendingCount ?? null, error: status?.lastError ?? status?.errorCode ?? null },
      consoleErrors,
      pageErrors,
    }, null, 2));
    if (consoleErrors.length || pageErrors.length) process.exitCode = 1;
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
