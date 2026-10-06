#!/usr/bin/env node

// Read-only configured-terminal diagnostic. It records the exact header status
// text alongside SQL Server health, recent database jobs and sync failures so
// a red badge can be attributed to local SQL, cloud sync or security posture.
const { _electron: electron } = require("@playwright/test");

const adminEmail = process.env.POS_E2E_ADMIN_EMAIL;
const adminPassword = process.env.POS_E2E_ADMIN_PASSWORD;
if (!adminEmail || !adminPassword) {
  throw new Error("Set the administrator E2E credentials at runtime.");
}

const baseURL = "http://127.0.0.1:8080";

async function signInIfNeeded(page) {
  const profile = page.getByRole("button", { name: /Open profile for/ });
  const terminalSignIn = page.getByText("Terminal sign in", { exact: true });
  await profile.or(terminalSignIn).first().waitFor({ state: "visible", timeout: 45_000 });
  if (await profile.isVisible()) {
    await profile.click();
    await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
    await terminalSignIn.waitFor({ state: "visible", timeout: 30_000 });
  }

  await page.getByRole("tab", { name: "Supervisor / Admin", exact: true }).click();
  await page.getByLabel("Email or username").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  try {
    await profile.waitFor({ state: "visible", timeout: 45_000 });
  } catch (error) {
    const visibleText = (await page.locator("body").innerText().catch(() => "")).slice(0, 1500);
    throw new Error(`Administrator sign-in did not reach the register. Visible screen: ${visibleText}`, { cause: error });
  }
}

async function popoverText(page, button) {
  await button.click();
  const popover = page.locator("[data-radix-popper-content-wrapper]").last();
  await popover.waitFor({ state: "visible", timeout: 10_000 });
  const text = await popover.innerText();
  await page.keyboard.press("Escape");
  return text;
}

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
    const page = await mainWindow(app);
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.waitForFunction(() => Boolean(window.pos), null, { timeout: 30_000 });
    await signInIfNeeded(page);
    await page.getByRole("button", { name: /Open profile for/ }).waitFor({
      state: "visible",
      timeout: 30_000,
    });

    const adoption = await page.evaluate(async () => {
      const [{ readCredentials }, { readTerminalConfig }] = await Promise.all([
        import("/src/lib/pos-credentials.ts"),
        import("/src/core/activation/terminal-tokens.ts"),
      ]);
      return window.sqlAdmin.adoptSession(await readCredentials(), readTerminalConfig());
    });
    const readyDeadline = Date.now() + 120_000;
    while (Date.now() < readyDeadline) {
      const state = await page.evaluate(() => window.pos.database.getState());
      if (state.state === "enabled_ready") break;
      await page.waitForTimeout(1_000);
    }
    const manualSync = await page.evaluate(() => window.pos.sync.runNow({ batchSize: 500 }));
    const activity = await page.evaluate(async () => {
      const pos = window.pos;
      const [database, health, schema, activeJob, recentJobs, sync, failures, sales, saleItems] = await Promise.all([
        pos.database.getState(),
        pos.database.health(),
        pos.database.schemaStatus(),
        pos.jobs.getActive(),
        pos.jobs.getHistory(10),
        pos.sync.getStatus(),
        pos.sync.getFailures(),
        pos.query("sales", {
          columns: "id,bill_number,store_id,branch_id,row_version,created_at,cashier_name",
          orderBy: { column: "created_at", ascending: false }, limit: 3,
        }),
        pos.query("sale_items", {
          columns: "id,sale_id,product_name,branch_id,row_version,created_at",
          orderBy: { column: "created_at", ascending: false }, limit: 5,
        }),
      ]);
      return { database, health, schema, activeJob, recentJobs, sync, failures, sales, saleItems };
    });

    const connection = page.locator('button[aria-label^="Connection:"]');
    const system = page.locator('button[aria-label^="System "]');
    const header = {
      connectionLabel: await connection.getAttribute("aria-label"),
      connectionTitle: await connection.getAttribute("title"),
      connectionDetails: await popoverText(page, connection),
      systemLabel: await system.getAttribute("aria-label"),
      systemTitle: await system.getAttribute("title"),
      systemDetails: await popoverText(page, system),
    };

    console.log(JSON.stringify({ ok: true, adoption, manualSync, header, activity, consoleErrors, pageErrors }, null, 2));
    if (consoleErrors.length || pageErrors.length) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message ?? String(error) }));
  process.exitCode = 1;
});
