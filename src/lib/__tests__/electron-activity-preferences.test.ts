import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (file: string) => readFileSync(file, "utf8");

describe("Electron activity preferences", () => {
  it("uses the configured Supabase project directly instead of the hosted API", () => {
    const activity = source("src/lib/activity-events.ts");
    const electronBranch = activity.slice(
      activity.indexOf("async function syncClearedEntry"),
      activity.indexOf("export async function clearActivityEntry"),
    );

    expect(activity).toContain("listActivityEventPageDirect");
    expect(activity).toContain('supabaseExternal.from("activity_events")');
    expect(electronBranch).toContain('if (platformName() === "electron")');
    expect(electronBranch).toContain('supabaseExternal.rpc("set_activity_event_cleared"');
    expect(electronBranch).toContain('supabaseExternal.rpc("set_all_activity_events_cleared"');
  });

  it("keeps bulk clear authenticated, self-scoped, and branch-scoped", () => {
    const migration = source(
      "supabase/migrations/20260928082540_electron_direct_activity_preferences.sql",
    );

    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.set_all_activity_events_cleared()",
    );
    expect(migration).toContain("a.auth_user_id = (SELECT auth.uid())");
    expect(migration).toContain("public.has_perm('can_view_audit_trail')");
    expect(migration).toContain("v_role = 'admin'::public.app_role");
    expect(migration).toContain("REVOKE ALL ON FUNCTION");
    expect(migration).toContain("TO authenticated");
    expect(migration).not.toContain("p_user_id");
    expect(migration).not.toContain("p_store_id");
  });

  it("refreshes notification popups from durable local SQL commits", () => {
    const activity = source("src/lib/activity-events.ts");
    const bell = source("src/platforms/web/components/pos/ActivityBell.tsx");

    expect(activity).toContain("bridge?.onBusinessChanged");
    expect(activity).toContain("cleanups.push(bridge.onBusinessChanged(() => onChange()))");
    expect(activity).toContain("Local SQL notifications still work");
    expect(bell).toContain("toast.dismiss(`activity-${id}`)");
    expect(bell).toContain("toast.dismiss(`activity-${row.id}`)");
  });
});
