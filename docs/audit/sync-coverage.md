# Synchronization coverage and ownership matrix

Generated from `database/sqlserver/schema-registry.json` (69 synchronized tables). Do not edit by hand; run `npm run audit:sync`.

Electron operational reads and writes use local SQL Server. Supabase is the online synchronization peer. SQL Server Change Tracking detects ordinary row changes; `sync_change_journal` groups complete business transactions. No renderer/device outbox is used by Electron.

| Table | Scope | Owner/conflict authority | Direction | Detection | Delete | Approval | Dependencies | Offline behavior |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| activity_events | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | None | Read/write SQL Server; sync later |
| app_users | branch | Supabase | Supabase -> SQL Server | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | None | Read cached local copy; edit centrally |
| audit_logs | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | None | Read/write SQL Server; sync later |
| authorization_action_history | branch | Originating transaction | Bidirectional | SQL Change Tracking + cloud feed | none | Role/permission gate | None | Read/write SQL Server; sync later |
| authorization_actions | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Role/permission gate | None | Read/write SQL Server; sync later |
| authorization_log | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Role/permission gate | None | Read/write SQL Server; sync later |
| authorization_requests | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Role/permission gate | None | Read/write SQL Server; sync later |
| branch_telemetry | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | None | Read/write SQL Server; sync later |
| cashiers | branch | Supabase | Supabase -> SQL Server | SQL Change Tracking + cloud feed | tombstone | Role/permission gate | None | Read cached local copy; edit centrally |
| coupon_campaigns | organization | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | None | Read/write SQL Server; sync later |
| drawer_events | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | None | Read/write SQL Server; sync later |
| entity_status_history | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | None | Read/write SQL Server; sync later |
| held_orders | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | None | Read/write SQL Server; sync later |
| integration_settings | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Role/permission gate | None | Read/write SQL Server; sync later |
| membership_tiers | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | None | Read/write SQL Server; sync later |
| nav_pins | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | None | Read/write SQL Server; sync later |
| offline_sync_audit_log | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | None | Read/write SQL Server; sync later |
| payment_types | organization | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | None | Read/write SQL Server; sync later |
| pin_attempts | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Role/permission gate | None | Read/write SQL Server; sync later |
| pos_settings | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Role/permission gate | None | Read/write SQL Server; sync later |
| pos_store_settings | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Role/permission gate | None | Read/write SQL Server; sync later |
| product_categories | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | product_categories | Read/write SQL Server; sync later |
| public_flags | branch | Supabase | Supabase -> SQL Server | SQL Change Tracking + cloud feed | tombstone | Role/permission gate | None | Read cached local copy; edit centrally |
| record_edits | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | None | Read/write SQL Server; sync later |
| secure_settings | branch | Supabase | Supabase -> SQL Server | SQL Change Tracking + cloud feed | tombstone | Role/permission gate | None | Read cached local copy; edit centrally |
| security_findings | branch | Supabase | Supabase -> SQL Server | SQL Change Tracking + cloud feed | tombstone | Role/permission gate | None | Read cached local copy; edit centrally |
| settings_locks | branch | Supabase | Supabase -> SQL Server | SQL Change Tracking + cloud feed | tombstone | Role/permission gate | None | Read cached local copy; edit centrally |
| settings_overrides | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Role/permission gate | None | Read/write SQL Server; sync later |
| settings_scoped | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Role/permission gate | None | Read/write SQL Server; sync later |
| shift_sessions | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | None | Read/write SQL Server; sync later |
| shifts | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | None | Read/write SQL Server; sync later |
| sku_audit | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | None | Read/write SQL Server; sync later |
| staff_roles | organization | Supabase | Supabase -> SQL Server | SQL Change Tracking + cloud feed | tombstone | Role/permission gate | None | Read cached local copy; edit centrally |
| stock_count_drafts | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | None | Read/write SQL Server; sync later |
| stock_delta_applied | branch | Originating transaction | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | None | Read/write SQL Server; sync later |
| stock_transfers | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | stock_transfers | Read/write SQL Server; sync later |
| store_groups | organization | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | None | Read/write SQL Server; sync later |
| suppliers | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | None | Read/write SQL Server; sync later |
| sync_metadata | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | None | Read/write SQL Server; sync later |
| system_audit_logs | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | None | Read/write SQL Server; sync later |
| terminal_commands | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Role/permission gate | None | Read/write SQL Server; sync later |
| terminal_recovery_secrets | branch | Supabase | Supabase -> SQL Server | SQL Change Tracking + cloud feed | tombstone | Role/permission gate | None | Read cached local copy; edit centrally |
| uom_units | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | None | Read/write SQL Server; sync later |
| user_roles | branch | Supabase | Supabase -> SQL Server | SQL Change Tracking + cloud feed | tombstone | Role/permission gate | None | Read cached local copy; edit centrally |
| whatsapp_queue | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | None | Read/write SQL Server; sync later |
| members | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | membership_tiers | Read/write SQL Server; sync later |
| purchase_orders | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | suppliers | Read/write SQL Server; sync later |
| shift_cash_counts | branch | Originating transaction | Bidirectional | SQL Change Tracking + cloud feed | none | Normal feature permission | shifts | Read/write SQL Server; sync later |
| shift_close_events | branch | Originating transaction | Bidirectional | SQL Change Tracking + cloud feed | none | Normal feature permission | shifts | Read/write SQL Server; sync later |
| shift_notifications | branch | Originating transaction | Bidirectional | SQL Change Tracking + cloud feed | none | Normal feature permission | shifts | Read/write SQL Server; sync later |
| stores | organization | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | store_groups, stores | Read/write SQL Server; sync later |
| bookings | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | members | Read/write SQL Server; sync later |
| coupon_events | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | coupon_campaigns, members | Read/write SQL Server; sync later |
| issued_vouchers | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | coupon_campaigns, members | Read/write SQL Server; sync later |
| member_verifications | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | members | Read/write SQL Server; sync later |
| products | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | stores | Read/write SQL Server; sync later |
| sales | branch | Originating transaction | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | members | Read/write SQL Server; sync later |
| shift_reconciliations | branch | Originating transaction | Bidirectional | SQL Change Tracking + cloud feed | none | Normal feature permission | shifts, shift_cash_counts | Read/write SQL Server; sync later |
| terminal_tokens | branch | Supabase | Supabase -> SQL Server | SQL Change Tracking + cloud feed | tombstone | Role/permission gate | stores | Read cached local copy; edit centrally |
| booking_payments | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | bookings | Read/write SQL Server; sync later |
| item_activity_logs | branch | Originating transaction | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | products | Read/write SQL Server; sync later |
| payment_transactions | branch | Originating transaction | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | sales, bookings, members | Read/write SQL Server; sync later |
| product_barcodes | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | products | Read/write SQL Server; sync later |
| promotions | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | products | Read/write SQL Server; sync later |
| purchase_order_items | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | purchase_orders, products | Read/write SQL Server; sync later |
| sale_items | branch | Originating transaction | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | sales, products | Read/write SQL Server; sync later |
| shift_variance_alerts | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | shifts, shift_reconciliations | Read/write SQL Server; sync later |
| stock_adjustments | branch | Originating transaction | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | products | Read/write SQL Server; sync later |
| stock_transfer_items | branch | Version policy | Bidirectional | SQL Change Tracking + cloud feed | tombstone | Normal feature permission | stock_transfers, products | Read/write SQL Server; sync later |

## Local-only SQL Server infrastructure

- `schema_migrations`: local database operation/synchronization metadata; never uploaded as a business table.
- `sync_checkpoints`: local database operation/synchronization metadata; never uploaded as a business table.
- `sync_change_journal`: local database operation/synchronization metadata; never uploaded as a business table.
- `sync_conflicts`: local database operation/synchronization metadata; never uploaded as a business table.
- `database_jobs`: local database operation/synchronization metadata; never uploaded as a business table.
- `local_operation_receipts`: local database operation/synchronization metadata; never uploaded as a business table.

## Cloud-only synchronization infrastructure

- `sync_change_feed`: server-side feed/idempotency infrastructure; never treated as POS operational data.
- `sync_idempotency_receipts`: server-side feed/idempotency infrastructure; never treated as POS operational data.
- `user_sessions`: server-side feed/idempotency infrastructure; never treated as POS operational data.

## Verification meaning

- `SYNCED`: incremental push/pull completed and branch-scoped counts match.
- `VERIFIED`: a full branch-scoped data signature also matches. A count match alone is never labelled verified.
- `DIFFERENT`: count or signature differs; targeted repair is required.
