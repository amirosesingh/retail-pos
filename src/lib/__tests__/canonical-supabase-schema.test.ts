import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
// Keep assertions about SQL content identical on Windows (CRLF) and CI (LF).
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replaceAll("\r\n", "\n");

function sqlFiles(directory = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    if ([".git", "node_modules", ".output", ".wrangler"].includes(entry)) continue;
    const absolute = resolve(directory, entry);
    if (statSync(absolute).isDirectory()) files.push(...sqlFiles(absolute));
    else if (entry.endsWith(".sql")) files.push(relative(root, absolute).replaceAll("\\", "/"));
  }
  return files.sort();
}

describe("canonical Supabase SQL", () => {
  it("keeps one manual upgrade, its CLI migrations, the installer and deliberate reset", () => {
    expect(sqlFiles().filter((file) => file.startsWith("supabase/"))).toEqual([
      "supabase/membership/migrations/20261002183000_isolated_membership_project.sql",
      "supabase/membership/migrations/20261002183500_membership_lookup_scaling.sql",
      "supabase/membership/migrations/20261002184000_membership_event_consistency.sql",
      "supabase/membership/migrations/20261002184200_phone_membership_number.sql",
      "supabase/membership/migrations/20261002201500_email_otp_phone_membership.sql",
      "supabase/membership/migrations/20261003004500_document_rpc_only_membership_tables.sql",
      "supabase/membership/migrations/20261003093000_member_directory_delta.sql",
      "supabase/membership/migrations/20261003190000_member_directory_revision_overlap.sql",
      "supabase/migrations/20260925102835_fix_payment_transaction_idempotency.sql",
      "supabase/migrations/20260925105427_fix_pos_sale_commit_stock_alias.sql",
      "supabase/migrations/20260925105919_persist_pos_sale_payment_idempotency.sql",
      "supabase/migrations/20260925111049_repair_terminal_heartbeat_columns.sql",
      "supabase/migrations/20260925112228_harden_authorization_table_grants.sql",
      "supabase/migrations/20260925112800_repair_sync_contract_columns.sql",
      "supabase/migrations/20260925130000_fix_sale_member_dependency_order.sql",
      "supabase/migrations/20260926090000_add_missing_pos_store_approval_columns.sql",
      "supabase/migrations/20260926105538_allow_offline_shift_sync.sql",
      "supabase/migrations/20260927085119_fix_sale_item_aggregate_branch_guard.sql",
      "supabase/migrations/20260927085816_normalize_legacy_audit_log_branch.sql",
      "supabase/migrations/20260927090830_fix_sale_item_batch_branch_guard.sql",
      "supabase/migrations/20260927115034_secure_shift_approvals_realtime.sql",
      "supabase/migrations/20260927123117_consolidate_shift_transfer_security.sql",
      "supabase/migrations/20260927131448_dashboard_category_drilldown.sql",
      "supabase/migrations/20260927134916_fix_secure_shift_reads.sql",
      "supabase/migrations/20260927135206_harden_secure_shift_projection.sql",
      "supabase/migrations/20260927155845_enrich_shift_variance_alert_details.sql",
      "supabase/migrations/20260927162020_fix_shift_variance_conflict.sql",
      "supabase/migrations/20260927163225_fix_activity_event_conflict.sql",
      "supabase/migrations/20260927165001_add_shift_notifications.sql",
      "supabase/migrations/20260927233640_fix_cashier_store_access_rls.sql",
      "supabase/migrations/20260928025126_sync_activity_notification_history.sql",
      "supabase/migrations/20260928041000_bind_terminal_heartbeat_to_device.sql",
      "supabase/migrations/20260928042410_harden_public_data_api_access.sql",
      "supabase/migrations/20260928043000_harden_terminal_claim_recovery.sql",
      "supabase/migrations/20260928071500_restore_shift_notifications_sync_contract.sql",
      "supabase/migrations/20260928074557_online_approval_cloud_primary.sql",
      "supabase/migrations/20260928082540_electron_direct_activity_preferences.sql",
      "supabase/migrations/20260928125000_enforce_terminal_platform_contract.sql",
      "supabase/migrations/20260928150050_complete_authorization_workflow.sql",
      "supabase/migrations/20260928150213_harden_authorization_routine_access.sql",
      "supabase/migrations/20260928155105_repair_cashier_idle_and_activity_clear.sql",
      "supabase/migrations/20260928183500_sync_activity_notification_preferences.sql",
      "supabase/migrations/20260928194500_fix_manager_override_audit_history.sql",
      "supabase/migrations/20260928213000_complete_authorization_history.sql",
      "supabase/migrations/20260929001126_approval_route_audit_snapshot.sql",
      "supabase/migrations/20260929060000_local_first_authorization_rules.sql",
      "supabase/migrations/20260929062541_harden_scoped_settings_sync.sql",
      "supabase/migrations/20260929080000_change_history_stock_request_lifecycle.sql",
      "supabase/migrations/20260929080650_ignore_central_settings_push.sql",
      "supabase/migrations/20260929093220_optimize_sync_pull_index_lookups.sql",
      "supabase/migrations/20260929161909_ignore_stale_scoped_settings_push.sql",
      "supabase/migrations/20260929162248_restrict_terminal_settings_deletes.sql",
      "supabase/migrations/20260929170000_bound_sync_pull_page.sql",
      "supabase/migrations/20260929174500_stop_retrying_application_conflicts.sql",
      "supabase/migrations/20260930083000_repair_authenticated_sync_reads.sql",
      "supabase/migrations/20261001023622_restrict_sensitive_security_definers.sql",
      "supabase/migrations/20261001043000_prevent_equal_version_rule_overwrite.sql",
      "supabase/migrations/20261001090000_remove_trading_policy.sql",
      "supabase/migrations/20261001133000_define_terminal_active_guard.sql",
      "supabase/migrations/20261001160000_auto_archive_zero_stock_products.sql",
      "supabase/migrations/20261001170000_granular_product_permissions.sql",
      "supabase/migrations/20261001180000_retire_parallel_settings_api.sql",
      "supabase/migrations/20261002010743_enforce_zero_stock_catalog_lifecycle.sql",
      "supabase/migrations/20261002023000_admin_only_posted_record_corrections.sql",
      "supabase/migrations/20261002053711_close_review_integrity_gaps.sql",
      "supabase/migrations/20261002061927_close_coderabbit_review_edges.sql",
      "supabase/migrations/20261002062526_use_net_stock_for_catalog_lifecycle.sql",
      "supabase/migrations/20261002063556_align_net_stock_backfill.sql",
      "supabase/migrations/20261002064708_align_lifecycle_transition_default.sql",
      "supabase/migrations/20261002093000_secure_member_portal.sql",
      "supabase/migrations/20261002114036_global_sku_allocator_and_notification_retention.sql",
      "supabase/migrations/20261002141157_bind_phone_pairing_to_device_proof.sql",
      "supabase/migrations/20261002144305_configure_public_membership_domains.sql",
      "supabase/migrations/20261002152000_normalize_terminal_pairing_proof.sql",
      "supabase/migrations/20261002163000_member_profile_details.sql",
      "supabase/migrations/20261002164036_optimize_rls_and_foreign_keys.sql",
      "supabase/migrations/20261002170000_harden_member_and_barcode_edges.sql",
      "supabase/migrations/20261002184500_detach_pos_customer_auth.sql",
      "supabase/migrations/20261002191500_remove_membership_event_outbox.sql",
      "supabase/migrations/20261002192000_restore_staff_operational_policies.sql",
      "supabase/migrations/20261002200000_canonicalize_branch_identity.sql",
      "supabase/migrations/20261003002000_optimize_audit_ingestion.sql",
      "supabase/migrations/20261003005000_build_fk_indexes_concurrently.sql",
      "supabase/migrations/20261003010000_sync_member_profile_details.sql",
      "supabase/migrations/20261003011000_remove_legacy_unscoped_sync_rpcs.sql",
      "supabase/migrations/20261003093500_membership_directory_mirror.sql",
      "supabase/migrations/20261003183000_harden_membership_directory_identity.sql",
      "supabase/reset.sql",
      "supabase/schema.sql",
      "supabase/sql/payment_commit_upgrade.sql",
    ]);
  });

  it("syncs offline member profile details without exposing the Auth identity", () => {
    const migration = read(
      "supabase/migrations/20261003010000_sync_member_profile_details.sql",
    );
    const memberApply = migration.match(
      /CREATE OR REPLACE FUNCTION public\.sync_apply_members[\s\S]*?REVOKE ALL ON FUNCTION public\.sync_apply_members/,
    )?.[0];

    expect(memberApply).toContain('"country_code"');
    expect(memberApply).toContain('"postal_code"');
    expect(memberApply).not.toContain('"auth_user_id"');
    expect(migration).toContain(
      "WHEN 'members' THEN (SELECT to_jsonb(x) - ARRAY['auth_user_id']::text[]",
    );
    expect(migration).toContain(
      "jsonb_agg(to_jsonb(page.row_data) - ARRAY['auth_user_id']::text[]",
    );
    expect(read("supabase/schema.sql")).toContain(
      "FOR EACH STATEMENT EXECUTE FUNCTION public.sync_feed_audit_logs_insert()",
    );
  });

  it("builds production foreign-key indexes without blocking writes", () => {
    const migration = read(
      "supabase/migrations/20261003005000_build_fk_indexes_concurrently.sql",
    );

    expect(migration.startsWith("-- pg-delta: transaction=false")).toBe(true);
    expect(migration).toContain("not index_state.indisvalid");
    expect(migration).toContain("set lock_timeout = '2s'");
    expect(migration.match(/create index concurrently if not exists/gi)).toHaveLength(8);
  });

  it("adds the audit branch column before installing statement triggers", () => {
    const migration = read(
      "supabase/migrations/20261003002000_optimize_audit_ingestion.sql",
    );
    const addStoreId = migration.indexOf("add column if not exists store_id text");
    const firstTriggerFunction = migration.indexOf("sync_feed_audit_logs_insert()");

    expect(addStoreId).toBeGreaterThan(-1);
    expect(addStoreId).toBeLessThan(firstTriggerFunction);
  });

  it("installs the complete shift-notification sync contract", () => {
    const migration = read(
      "supabase/migrations/20260928071500_restore_shift_notifications_sync_contract.sql",
    );

    expect(migration).toContain("FUNCTION public.sync_apply_shift_notifications");
    expect(migration).toContain("FUNCTION public.sync_feed_shift_notifications");
    expect(migration).toContain(
      'CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."shift_notifications"',
    );
    for (const routine of [
      "pos_sync_push_batch",
      "pos_sync_push_aggregate",
      "pos_sync_pull",
      "pos_sync_bootstrap",
    ]) {
      const start = migration.indexOf(`FUNCTION public.${routine}`);
      expect(start, `${routine} must be replaced`).toBeGreaterThan(-1);
      expect(
        migration.slice(start, migration.indexOf("END $fn$;", start)),
        `${routine} must dispatch shift_notifications`,
      ).toContain("shift_notifications");
    }
  });

  it("keeps the optional zero-stock catalogue lifecycle in the canonical schema", () => {
    const migration = read(
      "supabase/migrations/20261002010743_enforce_zero_stock_catalog_lifecycle.sql",
    );
    const schema = read("supabase/schema.sql");
    for (const sql of [migration, schema]) {
      expect(sql).toContain("FUNCTION public.apply_zero_stock_catalog_lifecycle()");
      expect(sql).toContain(
        "BEFORE INSERT OR UPDATE OF stock_by_store, is_archived ON public.products",
      );
      expect(sql).toContain("FUNCTION public.backfill_zero_stock_catalog_lifecycle()");
      expect(sql).toContain("AFTER UPDATE OF integration_settings ON public.pos_settings");
      expect(sql).toContain("integration_settings ->> 'autoArchiveZeroStock'");
      expect(sql).toContain("COALESCE(integration_settings ->> 'autoArchiveZeroStock', 'true')");
      expect(sql).toContain("Reconcile products already present");
      expect(sql).toContain("AND NOT stock_state.has_stock");
      expect(sql).toContain("SET is_archived = true");
      expect(sql).not.toContain("SET is_archived = NOT stock_state.has_stock");
      expect(sql).toContain(
        "REVOKE ALL ON FUNCTION public.apply_zero_stock_catalog_lifecycle() FROM PUBLIC, anon, authenticated",
      );
      expect(sql).toContain(
        "REVOKE ALL ON FUNCTION public.backfill_zero_stock_catalog_lifecycle() FROM PUBLIC, anon, authenticated",
      );
    }
  });

  it("archives catalogue products without exposing permanent client deletion", () => {
    const migration = read("supabase/migrations/20261001170000_granular_product_permissions.sql");
    expect(migration).toContain('DROP POLICY IF EXISTS "Staff can delete"');
    expect(migration).not.toContain('CREATE POLICY "Staff can delete"');
  });

  it("preserves explicit granular catalogue permissions during schema backfill", () => {
    const schema = read("supabase/schema.sql");
    expect(schema).toMatch(
      /SET permissions = jsonb_build_object\([\s\S]*?'can_publish_product'[\s\S]*?\) \|\| permissions/,
    );
    expect(schema).not.toContain("SET permissions = permissions || jsonb_build_object(");
  });

  it("declares lifecycle state in the final product permission trigger", () => {
    const schema = read("supabase/schema.sql");
    const start = schema.lastIndexOf(
      "CREATE OR REPLACE FUNCTION public.enforce_product_price_permissions()",
    );
    const body = schema.slice(start, start + 5_000);
    expect(body).toMatch(/AS \$\$\s*DECLARE/);
    expect(body).toContain("automatic_lifecycle_change boolean := false");
  });

  it("keeps one authoritative POS settings runtime", () => {
    const migration = read("supabase/migrations/20261001180000_retire_parallel_settings_api.sql");
    const schema = read("supabase/schema.sql");
    for (const sql of [migration, schema]) {
      expect(sql).toContain(
        "REVOKE EXECUTE ON FUNCTION public.settings_upsert(text, text, jsonb) FROM anon, authenticated",
      );
      expect(sql).toContain("scoped product-price overrides only");
    }
  });

  it("contains the complete schema and enforces RLS on every app table", () => {
    const sql = read("supabase/schema.sql");
    const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS public\.([a-z0-9_]+)/gi)].map(
      (match) => match[1],
    );
    expect(tables.length).toBeGreaterThan(60);
    for (const table of tables) {
      expect(sql, `${table} must enable RLS`).toMatch(
        new RegExp(`ALTER TABLE(?: ONLY)? public\\.${table} ENABLE ROW LEVEL SECURITY`, "i"),
      );
    }
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.schema_inventory_deep()");
    expect(sql).toContain("Retail schema refused: RLS is disabled for");
    expect(sql).toContain("FUNCTION public.pos_sale_commit");
  });

  it("publishes PIN changes so every terminal replaces its local hash", () => {
    const sql = read("supabase/schema.sql");
    const setPin = sql.slice(
      sql.indexOf("CREATE OR REPLACE FUNCTION public.staff_account_set_pin"),
      sql.indexOf("CREATE OR REPLACE FUNCTION public.staff_account_upsert"),
    );
    expect(setPin).toContain("pin_hash = extensions.crypt(p_pin");
    expect(setPin).toContain("updated_at = now()");
    expect(sql).toContain(
      "CREATE TRIGGER app_users_bump_row_version BEFORE UPDATE ON public.app_users",
    );
    expect(sql).toContain("FUNCTION public.sync_feed_app_users()");
    expect(sql).toContain(
      'CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public."app_users"',
    );
  });

  it("enforces completed-sale tender corrections in the database", () => {
    const sql = read("supabase/schema.sql");
    const start = sql.indexOf("CREATE OR REPLACE FUNCTION public.enforce_sale_permissions()");
    const body = sql.slice(start, start + 1_800);
    expect(body).toContain("NEW.payment_type IS DISTINCT FROM OLD.payment_type");
    expect(body).toContain("NEW.payments IS DISTINCT FROM OLD.payments");
    expect(body).toContain("coalesce(v_role, '') <> 'admin'");
    expect(body).toContain("ADMIN_REQUIRED_TENDER_EDIT");
  });

  it("keeps closed-shift corrections append-only and service-role only", () => {
    const sql = read("supabase/migrations/20261002023000_admin_only_posted_record_corrections.sql");
    expect(sql).toContain("FUNCTION public.pos_admin_correct_closed_shift");
    expect(sql).toContain("'RECOUNT'");
    expect(sql).toContain("INSERT INTO public.record_edits");
    expect(sql).toContain("'SHIFT_CLOSE_CORRECTED'");
    expect(sql).toContain("p_client_key");
    expect(sql).toContain("TO service_role");
    expect(sql).toContain("FROM PUBLIC, anon, authenticated");
    expect(sql).toContain("ADMIN_REQUIRED_TENDER_EDIT");
    expect(sql).toContain('POLICY "server-only deny client access" ON public.user_sessions');
    expect(sql).not.toMatch(/\b(?:DELETE|TRUNCATE|DROP\s+TABLE)\b/i);
  });

  it("enforces and audits cross-user or cross-terminal shift closure in the database", () => {
    const sql = read("supabase/schema.sql");
    const start = sql.indexOf("CREATE OR REPLACE FUNCTION public.shift_close_start");
    const body = sql.slice(start, start + 3_000);
    expect(body).toContain("public.has_perm('can_manage_other_shifts')");
    expect(body).toContain("another employee or terminal shift");
    expect(body).toContain("'forced'");
    expect(body).toContain("'opened_by_staff_id'");
    expect(body).toContain("'opened_terminal_id'");
  });

  it("closes server-only tables and privileged routines after every definition", () => {
    const sql = read("supabase/schema.sql");
    const hardening = sql.indexOf("-- Final public-schema privilege hardening");
    expect(hardening).toBeGreaterThan(sql.lastIndexOf("CREATE OR REPLACE FUNCTION"));
    expect(sql).toContain("REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated");
    expect(sql).toMatch(
      /WHERE n\.nspname = 'public'[\s\S]*p\.prosecdef[\s\S]*REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon/,
    );

    for (const table of [
      "cashiers",
      "pin_attempts",
      "terminal_recovery_secrets",
      "sync_idempotency_receipts",
      "sync_change_feed",
    ]) {
      expect(sql).toContain(`REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated`);
      expect(sql).toMatch(
        new RegExp(
          `CREATE POLICY "server-only deny client access" ON public\\.${table}\\s+FOR ALL TO anon, authenticated USING \\(false\\) WITH CHECK \\(false\\)`,
        ),
      );
    }
    expect(sql).toContain("to_regclass('public.schema_migrations')");
    expect(sql).toContain(
      "ALTER FUNCTION public.pos_rules_defaults()\n  SET search_path TO 'public', 'pg_temp'",
    );
  });

  it("supports indexed, duplicate-safe catalogue imports", () => {
    const sql = read("supabase/schema.sql");
    expect(sql).toContain("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    expect(sql).toContain("products_barcode_normalized_uidx");
    expect(sql).toContain("products_name_trgm_idx");
    expect(sql).toContain("purchase_orders_store_status_entry_idx");
    expect(sql).toContain("FUNCTION public.product_lookup_batch(p_codes text[])");
    expect(sql).toContain("SECURITY INVOKER");
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.product_lookup_batch(text[]) FROM PUBLIC, anon",
    );
  });

  it("publishes catalogue and receiving changes for targeted live refresh", () => {
    const sql = read("supabase/schema.sql");
    expect(sql).toContain("'products', 'product_barcodes', 'members', 'promotions'");
    expect(sql).toContain("'purchase_orders', 'purchase_order_items'");
    expect(sql).toContain("ALTER PUBLICATION supabase_realtime ADD TABLE");
  });

  it("keeps the business board category-first view invoker-secured", () => {
    const sql = read("supabase/schema.sql");
    const migration = read("supabase/migrations/20260927131448_dashboard_category_drilldown.sql");
    for (const source of [sql, migration]) {
      expect(source).toContain("public.v_daily_item_sales");
      expect(source).toContain("security_invoker");
      expect(source).toContain("AS product_category");
      expect(source).toContain("REVOKE ALL ON TABLE public.v_daily_item_sales FROM anon");
    }
  });

  it("lets the database scheduler run the guarded security self-check", () => {
    const sql = read("supabase/schema.sql");
    expect(sql).toContain("session_user IN ('postgres', 'supabase_admin')");
  });

  it("resets data transactionally and restores RLS before commit", () => {
    const sql = read("supabase/reset.sql");
    expect(sql).toMatch(/BEGIN;[\s\S]*DISABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/DISABLE ROW LEVEL SECURITY[\s\S]*DELETE FROM/);
    expect(sql).toMatch(/DELETE FROM[\s\S]*ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/RLS was not restored[\s\S]*COMMIT;/);
    expect(sql).not.toMatch(/DROP (?:TABLE|SCHEMA|POLICY)/i);
  });
});
