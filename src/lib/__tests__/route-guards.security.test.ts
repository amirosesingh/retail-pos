import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROUTES_DIR = join(process.cwd(), "src/routes");
const APP_SHELL = readFileSync(join(process.cwd(), "src/platforms/web/components/pos/AppShell.tsx"), "utf8");
const NAV = readFileSync(join(process.cwd(), "src/platforms/web/components/pos/nav-config.ts"), "utf8");
const SUPABASE_SCHEMA = readFileSync(join(process.cwd(), "supabase/schema.sql"), "utf8");

const routeFiles = readdirSync(ROUTES_DIR).filter((f) => f.endsWith(".tsx") && !f.startsWith("__"));

/** Screens that must never render outside the permission-gated shell. */
/** Customer-facing screens: the display pole plus the member signup and
 *  voucher pages served on the member./redeem. subdomains. */
const PUBLIC_ROUTES = new Set([
  "display.tsx",
  "join.tsx",
  "membership.tsx",
  "claim.$campaignSlug.tsx",
  "c.$tokenSlug.tsx",
  // Emergency access: the connection-repair screen a till or phone opens when
  // it cannot reach the backend. It must not sit behind the shell, because the
  // shell needs the very connection this screen exists to fix. It carries only
  // the (non-secret) backend address and central database URL + publishable
  // key, and reads no business data.
  "recovery.tsx",
  // Startup recovery must be reachable before AppShell signs a cashier in.
  // It exposes no business data. Its local recovery wizard may run read-only
  // probes, while every configuration or migration write remains protected by
  // the main-process administrator IPC gate.
  "database-startup.tsx",
]);

/**
 * A redirect-only stub keeps an old bookmark working: it declares no
 * `component`, throws `redirect(...)` in `beforeLoad`, and so never renders a
 * page body. There is nothing to guard and nothing to leak — the destination
 * it forwards to carries the permission.
 */
const isRedirectOnly = (src: string) =>
  !/\bcomponent\s*:/.test(src) && /\bredirect\(/.test(src) && /beforeLoad/.test(src);

const redirectOnly = new Set(
  routeFiles.filter((f) => isRedirectOnly(readFileSync(join(ROUTES_DIR, f), "utf8"))),
);

describe("route guards", () => {
  it("every screen renders inside AppShell, which enforces login + permissions", () => {
    const unguarded = routeFiles.filter((f) => {
      if (PUBLIC_ROUTES.has(f)) return false;
      if (redirectOnly.has(f)) return false;
      const src = readFileSync(join(ROUTES_DIR, f), "utf8");
      // SectionHub, SettingsFrame and SettingsShell all render inside AppShell.
      return (
        !src.includes("AppShell") &&
        !src.includes("SettingsFrame") &&
        !src.includes("SettingsShell") &&
        !src.includes("SectionHub")
      );
    });
    expect(unguarded).toEqual([]);
  });

  it("AppShell still blocks anonymous access and gates admin paths", () => {
    // Matched on structure, not exact spelling: the guard may be wrapped over
    // several lines, but it must still short-circuit to the sign-in screen.
    expect(APP_SHELL).toMatch(/if\s*\(!user\)[\s\S]{0,600}?<TerminalLogin\s*\/>/);
    expect(APP_SHELL).toContain("routePermissionForPath");
    for (const path of ["/staff", "/promotions", "/audit"]) {
      expect(NAV).toContain(`to: "${path}"`);
    }
    expect(NAV).toContain('"/settings": "can_access_pos_settings"');
  });

  it("uses one route permission registry instead of a second AppShell map", () => {
    expect(APP_SHELL).toContain("routePermissionForPath");
    expect(APP_SHELL).not.toContain("ROUTE_PERMISSIONS");
    expect(NAV).toContain("ROUTE_PERMISSION_OVERRIDES");
    expect(NAV).toContain("NAV_ROUTE_PERMISSIONS");
  });

  it("does not hide operational modules based on the access device", () => {
    expect(NAV).not.toContain("desktopHidden");
    expect(APP_SHELL).not.toContain("item.desktopHidden");
    expect(APP_SHELL).not.toContain("DESKTOP_BLOCKED");
    expect(readFileSync(join(ROUTES_DIR, "promotions.tsx"), "utf8")).toContain('can("can_manage_promotions")');
    expect(readFileSync(join(ROUTES_DIR, "coupons.tsx"), "utf8")).toContain('can("can_manage_promotions")');
    expect(readFileSync(join(ROUTES_DIR, "stores.tsx"), "utf8")).toContain('can("can_manage_locations")');
    expect(readFileSync(join(ROUTES_DIR, "audit.tsx"), "utf8")).toContain('can("can_view_audit_trail")');
  });

  it("enforces matching permissions in Supabase for opened management pages", () => {
    for (const flag of [
      "can_manage_promotions",
      "can_manage_locations",
      "can_view_audit_trail",
      "can_manage_staff",
      "can_access_pos_settings",
    ]) {
      expect(SUPABASE_SCHEMA).toContain(`public.has_perm('${flag}')`);
    }
  });

  /** The two screens that change stock by hand and expose member contact
   *  history must never be reachable on the fail-closed default alone. */
  it("stock operations and the verification log declare their permission", () => {
    expect(NAV).toMatch(/to: "\/stock-operations"[\s\S]{0,220}?flag: "can_adjust_stock"/);
    expect(NAV).toMatch(/to: "\/verifications"[\s\S]{0,220}?flag: "can_view_member_history"/);
    expect(NAV).toMatch(/to: "\/reports\/history"[\s\S]{0,220}?flag: "can_view_audit_trail"/);
    expect(NAV).toMatch(/to: "\/reports\/activity"[\s\S]{0,220}?flag: "can_view_audit_trail"/);
    expect(NAV).toMatch(/to: "\/reports\/notifications"[\s\S]{0,220}?flag: "can_view_audit_trail"/);
  });

  it("permission-gates every stock transfer lifecycle action in the detail pages", () => {
    const transfer = readFileSync(join(ROUTES_DIR, "transfers.$id.tsx"), "utf8");
    const request = readFileSync(join(ROUTES_DIR, "requests.$id.tsx"), "utf8");

    expect(transfer).toMatch(/const canApprove =[\s\S]{0,180}?can\("can_approve_transfer"\)/);
    expect(transfer).toMatch(/const canDispatch =[\s\S]{0,180}?can\("can_create_transfer"\)/);
    expect(transfer).toMatch(/const canReceive =[\s\S]{0,180}?can\("can_receive_transfer"\)/);
    expect(transfer).toMatch(/const canVerify =[\s\S]{0,180}?can\("can_receive_transfer"\)/);
    expect(transfer).toMatch(/const canReject =[\s\S]{0,220}?can\("can_approve_transfer"\)/);
    expect(request).toMatch(/const canReject =[\s\S]{0,240}?can\("can_approve_transfer"\)/);
    const requestRejectGate = request.slice(
      request.indexOf("const canReject ="),
      request.indexOf("return (", request.indexOf("const canReject =")),
    );
    expect(requestRejectGate).not.toContain('can("can_receive_transfer")');
  });

  /** A missing map entry must fail closed, and access must be decided before
   *  the page body renders — a post-render redirect leaks protected data. */
  it("denies unmapped routes instead of falling through to open access", () => {
    expect(APP_SHELL).toContain('const PUBLIC_ROUTES = new Set(["/", "/display"])');
    expect(APP_SHELL).toContain('return routePermissionForPath(pathname) ?? "unknown"');
    // The denial screen (which names the missing permission) renders instead
    // of the page body.
    expect(APP_SHELL).toContain("<PermissionDenied");
    // The old post-render redirect guard must not come back.
    expect(APP_SHELL).not.toContain("useNavigate");
  });

  it("every report screen requires the sales-reports permission in the sidebar", () => {
    // Entries span several lines, so check each `{ ... }` block that points at
    // a report screen. `hubTo` is the section landing page, not an entry.
    const entries = NAV.split("{").filter(
      (block) => /\bto: "\/reports/.test(block) && !/hubTo:/.test(block.split("\n")[0] ?? ""),
    );
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      const gated =
        entry.includes('flag: "can_view_sales_reports"') ||
        entry.includes('flag: "can_view_audit_trail"');
      expect(gated, entry).toBe(true);
    }
  });

  it("lets audit-only staff open the reports centre without exposing sales reports", () => {
    expect(APP_SHELL).toContain('location.pathname === "/reports"');
    expect(APP_SHELL).toMatch(
      /reportsHome[\s\S]{0,500}?can\("can_view_sales_reports"\) \|\| can\("can_view_audit_trail"\)/,
    );
    expect(readFileSync(join(ROUTES_DIR, "reports.index.tsx"), "utf8")).toContain(
      '<SectionHub groupId="reports" />',
    );
  });

  it("permission-gates every report export entry point", () => {
    const reportKit = readFileSync(
      join(process.cwd(), "src/platforms/web/components/pos/report-kit.tsx"),
      "utf8",
    );
    const analytics = readFileSync(join(ROUTES_DIR, "analytics.tsx"), "utf8");
    const notifications = readFileSync(join(ROUTES_DIR, "reports.notifications.tsx"), "utf8");

    expect(reportKit).toContain('can("can_export_reports")');
    expect(reportKit).toMatch(/onExport && canExport/);
    expect(analytics).toContain('const canExport = can("can_export_reports")');
    expect(analytics).toMatch(/\{canExport && \([\s\S]{0,180}?Export CSV/);
    expect(notifications).toMatch(
      /\{can\("can_export_reports"\) && \([\s\S]{0,220}?Export CSV/,
    );
  });
});

describe("secret hygiene", () => {
  it("no service-role key or raw secret is referenced from client code", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        if (/\.server\.tsx?$/.test(entry.name)) continue;
        if (/\.test\.tsx?$/.test(entry.name)) continue;
        const src = readFileSync(full, "utf8");
        if (/SERVICE_ROLE|service_role_key/i.test(src)) offenders.push(full);
      }
    };
    walk(join(process.cwd(), "src"));
    expect(offenders).toEqual([]);
  });
});
