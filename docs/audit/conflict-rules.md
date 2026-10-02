# Conflict and deletion rules

Generated from the packaged synchronization registry. Financial records are corrected with reversal/correction records; they are not casually overwritten.

| Table | Insert | Update | Delete | Conflict rule |
| --- | --- | --- | --- | --- |
| activity_events | idempotent_upsert | versioned | tombstone | highest_version |
| app_users | idempotent_upsert | versioned | tombstone | highest_version |
| audit_logs | idempotent_upsert | versioned | tombstone | highest_version |
| authorization_action_history | idempotent_upsert | append_only | none | immutable_reversal |
| authorization_actions | idempotent_upsert | versioned | tombstone | highest_version |
| authorization_log | idempotent_upsert | versioned | tombstone | highest_version |
| authorization_requests | idempotent_upsert | versioned | tombstone | highest_version |
| branch_telemetry | idempotent_upsert | versioned | tombstone | highest_version |
| cashiers | idempotent_upsert | versioned | tombstone | highest_version |
| change_history | idempotent_upsert | versioned | tombstone | highest_version |
| coupon_campaigns | idempotent_upsert | versioned | tombstone | highest_version |
| drawer_events | idempotent_upsert | versioned | tombstone | highest_version |
| entity_status_history | idempotent_upsert | versioned | tombstone | highest_version |
| held_orders | idempotent_upsert | versioned | tombstone | highest_version |
| integration_settings | idempotent_upsert | versioned | tombstone | highest_version |
| membership_tiers | idempotent_upsert | versioned | tombstone | highest_version |
| nav_pins | idempotent_upsert | versioned | tombstone | highest_version |
| offline_sync_audit_log | idempotent_upsert | versioned | tombstone | highest_version |
| payment_types | idempotent_upsert | versioned | tombstone | highest_version |
| pin_attempts | idempotent_upsert | versioned | tombstone | highest_version |
| pos_settings | idempotent_upsert | versioned | tombstone | highest_version |
| pos_store_settings | idempotent_upsert | versioned | tombstone | highest_version |
| product_categories | idempotent_upsert | versioned | tombstone | highest_version |
| public_flags | idempotent_upsert | versioned | tombstone | highest_version |
| record_edits | idempotent_upsert | versioned | tombstone | highest_version |
| secure_settings | idempotent_upsert | versioned | tombstone | highest_version |
| security_findings | idempotent_upsert | versioned | tombstone | highest_version |
| settings_locks | idempotent_upsert | versioned | tombstone | highest_version |
| settings_overrides | idempotent_upsert | versioned | tombstone | highest_version |
| settings_scoped | idempotent_upsert | versioned | tombstone | highest_version |
| shift_sessions | idempotent_upsert | versioned | tombstone | highest_version |
| shifts | idempotent_upsert | versioned | tombstone | highest_version |
| sku_audit | idempotent_upsert | versioned | tombstone | highest_version |
| staff_roles | idempotent_upsert | versioned | tombstone | highest_version |
| stock_count_drafts | idempotent_upsert | versioned | tombstone | highest_version |
| stock_delta_applied | idempotent_upsert | versioned | tombstone | movement_delta |
| stock_transfers | idempotent_upsert | versioned | tombstone | highest_version |
| store_groups | idempotent_upsert | versioned | tombstone | highest_version |
| suppliers | idempotent_upsert | versioned | tombstone | highest_version |
| sync_metadata | idempotent_upsert | versioned | tombstone | highest_version |
| system_audit_logs | idempotent_upsert | versioned | tombstone | highest_version |
| terminal_commands | idempotent_upsert | versioned | tombstone | highest_version |
| terminal_recovery_secrets | idempotent_upsert | versioned | tombstone | highest_version |
| uom_units | idempotent_upsert | versioned | tombstone | highest_version |
| user_roles | idempotent_upsert | versioned | tombstone | highest_version |
| whatsapp_queue | idempotent_upsert | versioned | tombstone | highest_version |
| members | idempotent_upsert | versioned | tombstone | highest_version |
| purchase_orders | idempotent_upsert | versioned | tombstone | highest_version |
| shift_cash_counts | idempotent_upsert | append_only | none | immutable_reversal |
| shift_close_events | idempotent_upsert | append_only | none | immutable_reversal |
| shift_notifications | idempotent_upsert | append_only | none | immutable_reversal |
| stores | idempotent_upsert | versioned | tombstone | highest_version |
| bookings | idempotent_upsert | versioned | tombstone | highest_version |
| coupon_events | idempotent_upsert | versioned | tombstone | highest_version |
| issued_vouchers | idempotent_upsert | versioned | tombstone | highest_version |
| member_verifications | idempotent_upsert | versioned | tombstone | highest_version |
| products | idempotent_upsert | versioned | tombstone | highest_version |
| sales | idempotent_upsert | versioned | tombstone | immutable_reversal |
| shift_reconciliations | idempotent_upsert | append_only | none | immutable_reversal |
| terminal_tokens | idempotent_upsert | versioned | tombstone | highest_version |
| booking_payments | idempotent_upsert | versioned | tombstone | highest_version |
| item_activity_logs | idempotent_upsert | versioned | tombstone | movement_delta |
| payment_transactions | idempotent_upsert | versioned | tombstone | immutable_reversal |
| product_barcodes | idempotent_upsert | versioned | tombstone | highest_version |
| promotions | idempotent_upsert | versioned | tombstone | highest_version |
| purchase_order_items | idempotent_upsert | versioned | tombstone | highest_version |
| sale_items | idempotent_upsert | versioned | tombstone | immutable_reversal |
| shift_variance_alerts | idempotent_upsert | versioned | tombstone | highest_version |
| stock_adjustments | idempotent_upsert | versioned | tombstone | movement_delta |
| stock_transfer_items | idempotent_upsert | versioned | tombstone | highest_version |

Cloud-applied SQL Server changes use `CHANGE_TRACKING_CONTEXT`, so the push worker recognizes them as remote changes and does not echo them back. Stable primary keys and server idempotency receipts make retries safe.
