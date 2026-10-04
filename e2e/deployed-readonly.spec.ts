import { expect, test, type Page } from "@playwright/test";

const adminEmail = process.env.POS_E2E_ADMIN_EMAIL;
const adminPassword = process.env.POS_E2E_ADMIN_PASSWORD;
const branchUsername = process.env.POS_E2E_BRANCH_USERNAME;
const branchPassword = process.env.POS_E2E_BRANCH_PASSWORD;

const publicPaths = ["/", "/recovery"] as const;

const protectedPaths = [
  "/",
  "/sales",
  "/holds",
  "/shifts",
  "/receipts",
  "/display",
  "/promotions",
  "/coupons",
  "/bookings",
  "/pos/general-booking",
  "/pos/racket-service",
  "/inventory-hub",
  "/inventory",
  "/stock-operations",
  "/purchasing",
  "/receiving",
  "/requests",
  "/transfers",
  "/suppliers",
  "/verifications",
  "/approvals",
  "/customers",
  "/members",
  "/staff",
  "/admin",
  "/stores",
  "/all-shops",
  "/dashboard",
  "/analytics",
  "/audit",
  "/reports",
  "/reports/sales",
  "/reports/items",
  "/reports/stock",
  "/reports/payments",
  "/reports/voids",
  "/reports/history",
  "/reports/activity",
  "/reports/business",
  "/reports/catalog",
  "/reports/analytics",
  "/reports/notifications",
  "/reports/coupons",
  "/alerts",
  "/settings",
  "/settings/workspace",
  "/settings/display",
  "/settings/updates",
  "/settings/hardware",
  "/settings/terminals",
  "/settings/mobile-terminals",
  "/settings/sessions",
  "/settings/printer",
  "/settings/elements",
  "/settings/type",
  "/settings/lines",
  "/settings/receipt-designer",
  "/settings/qr",
  "/settings/identity",
  "/settings/groups",
  "/settings/tax",
  "/settings/rules",
  "/settings/sku",
  "/settings/numbering",
  "/settings/stock-numbering",
  "/settings/catalog",
  "/settings/region",
  "/settings/payment-methods",
  "/settings/payment",
  "/settings/accounts",
  "/settings/whatsapp",
  "/settings/booking-rules",
  "/settings/services",
  "/settings/booking-slip",
  "/settings/database",
  "/settings/shift-alerts",
  "/settings/notifications",
  "/settings/branch-telemetry",
  "/settings/system?tab=system",
  "/settings/system?tab=logic-health",
  "/settings/system?tab=security-alerts",
  "/settings/system?tab=inheritance",
  "/settings/access",
] as const;

function attachFailureCollectors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "unknown failure";
    failedRequests.push(`${request.method()} ${new URL(request.url()).pathname}: ${failure}`);
  });

  return { consoleErrors, pageErrors, failedRequests };
}

async function signInAsAdmin(page: Page) {
  if (!adminEmail || !adminPassword) {
    throw new Error("Set POS_E2E_ADMIN_EMAIL and POS_E2E_ADMIN_PASSWORD at runtime.");
  }
  await page.goto("/");
  await page.getByLabel("Email or username").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: /Open profile for/ }).first()).toBeVisible({ timeout: 30_000 });
}

async function signIn(page: Page, username: string | undefined, password: string | undefined) {
  if (!username || !password) throw new Error("Set the branch-user E2E credentials at runtime.");
  await page.goto("/");
  await page.getByLabel("Email or username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: /Open profile for/ }).first()).toBeVisible({ timeout: 30_000 });
}

test.describe("deployed read-only smoke", () => {
  test("public shell, recovery route, and security headers are healthy", async ({ page }) => {
    for (const path of publicPaths) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBeLessThan(400);
      await expect(page.locator("body"), path).not.toContainText("This page didn't load");
    }

    const response = await page.goto("/");
    expect(response?.headers()["content-security-policy"]).toContain("default-src 'self'");
    expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
    await expect(page.getByText("Back office sign in")).toBeVisible();
  });

  test("public member and voucher routes retain their narrow anonymous access", async ({ page }) => {
    await page.goto("/join", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /Join the rewards club|Member signup is (closed|unavailable)/ }),
    ).toBeVisible();

    await page.goto("/claim/e2e-invalid-campaign", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /Coupon unavailable|Voucher redemption is (closed|unavailable)/ }),
    ).toBeVisible();

    await page.goto("/c/e2e-invalid-voucher", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /Voucher not found|Voucher redemption is (closed|unavailable)/ }),
    ).toBeVisible();
  });

  test("admin can render every discovered static application route", async ({ page }) => {
    const failures = attachFailureCollectors(page);
    await signInAsAdmin(page);

    const routeFailures: string[] = [];
    for (const path of protectedPaths) {
      const response = await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(page.locator("body"), path).toBeVisible();
      const body = await page.locator("body").innerText();
      if ((response?.status() ?? 500) >= 400 || body.includes("This page didn't load")) {
        routeFailures.push(`${path}: HTTP ${response?.status() ?? "no response"}`);
      }
    }

    expect(routeFailures, "routes that failed to render").toEqual([]);
    expect(failures.pageErrors, "uncaught browser exceptions").toEqual([]);
    expect(failures.failedRequests, "network requests that failed before receiving HTTP").toEqual([]);
    expect(
      failures.consoleErrors.filter((message) => !message.includes("cloudflareinsights.com")),
      "browser console errors",
    ).toEqual([]);
  });

  test("branch user receives its configured permissions and keeps privileged administration blocked", async ({ page }) => {
    await signIn(page, branchUsername, branchPassword);
    await expect(page.locator("body")).not.toContainText("This page didn't load");

    // The deployed cashier account currently has no privileged administration
    // overrides. Confirm each sensitive screen enforces that live role state.
    for (const path of ["/stores", "/staff", "/settings/database"] as const) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: /Permission required|Hidden for your role/ })).toBeVisible();
      await expect(page.getByRole("link", { name: "Back to the register" })).toBeVisible();
    }
  });
});
