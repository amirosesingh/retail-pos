# Synchronized table scope classification

Audit date: 2026-09-29. This classification is the reviewed target for synchronization and RLS. `MIXED` means the row carries an explicit scope discriminator; it does not mean all rows may be downloaded.

| Scope | Tables | Required selection rule |
|---|---|---|
| GLOBAL / ORGANIZATION | `coupon_campaigns`, `integration_settings`, `members`, `membership_tiers`, `payment_types`, `pos_settings`, `product_categories`, `promotions`, `public_flags`, `secure_settings`, `security_findings`, `settings_locks`, `staff_roles`, `store_groups`, `stores`, `suppliers`, `uom_units` | organization membership and permission; shared records only |
| GLOBAL OR BRANCH | `products`, `product_barcodes` | shared products plus products visible/owned by the current branch; barcode inherits product visibility |
| BRANCH | `activity_events`, `app_users`, `audit_logs`, `bookings`, `booking_payments`, `cashiers`, `coupon_events`, `drawer_events`, `held_orders`, `issued_vouchers`, `item_activity_logs`, `member_verifications`, `offline_sync_audit_log`, `payment_transactions`, `purchase_orders`, `purchase_order_items`, `sales`, `sale_items`, `shift_sessions`, `shifts`, `sku_audit`, `stock_adjustments`, `stock_count_drafts`, `stock_delta_applied`, `sync_metadata`, `system_audit_logs`, `whatsapp_queue`, `pos_store_settings`, `authorization_requests`, `authorization_log`, `record_edits`, `shift_cash_counts`, `shift_close_events`, `shift_reconciliations`, `shift_variance_alerts`, `shift_notifications`, `entity_status_history` | `organization_id` plus current branch; children inherit their parent branch |
| CROSS-BRANCH | `stock_transfers`, `stock_transfer_items` | current branch is source or destination; child inherits transfer participation |
| TERMINAL | `branch_telemetry`, `terminal_commands`, `terminal_tokens`, `terminal_recovery_secrets` | current organization/branch and verified terminal, except authorized head-office management views |
| USER-SCOPED | `nav_pins`, `pin_attempts`, `user_roles` | current user, or explicit staff/security administration permission |
| MIXED SETTINGS | `settings_overrides`, `settings_scoped` | Global; matching Cluster; matching Branch; exact verified Terminal; exact current Private user |
| MIXED AUTHORIZATION | `authorization_actions`, `authorization_action_history` | Global; matching Cluster; matching Branch; history follows its rule scope |

## Cloud-only internal tables

| Tables | Classification |
|---|---|
| `sync_change_feed`, `sync_idempotency_receipts` | INTERNAL sync infrastructure; never exposed through ordinary RLS reads |
| `user_sessions` | INTERNAL authentication/session state; no client table access |

## SQL Server-only internal tables

| Tables | Classification |
|---|---|
| `schema_migrations`, `database_jobs` | LOCAL infrastructure |
| `sync_checkpoints`, `sync_change_journal`, `sync_conflicts`, `local_operation_receipts` | LOCAL durable synchronization state; retained instead of introducing an Outbox |

## Deployment notes

- The detailed classifications above override the registry's older coarse `branch` labels.
- The current one-organization project uses `organization_id = 'default'`; synchronization now validates that server-side. Supporting multiple organizations inside one Supabase project requires a separate compatible business-table migration.
- The product models its physical register as the stable terminal identity. Register-specific configuration uses terminal scope rather than accepting a second unverified client identifier.
- `settings_overrides` and `settings_scoped` now carry authoritative revisions and use compare-and-set cloud upserts.
- Production remains behind the repository migrations until the documented backup and reconciliation gates are completed.
