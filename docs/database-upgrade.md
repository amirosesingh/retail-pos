# Retail POS database setup

Use these two complete POS setup files:

| Database | File | Where to run |
| --- | --- | --- |
| Supabase PostgreSQL | `supabase/schema.sql` | Supabase Dashboard → SQL Editor, in the intended POS project |
| Local Microsoft SQL Server | `database/sqlserver/retail-pos-local-database.sql` | SQL Server Management Studio, connected to the local SQL Server instance |

## Supabase setup

Run the entire `supabase/schema.sql` as the database owner for a fresh POS project. It includes the operational tables, store groups, branches, inventory, purchasing, sales, payments, shifts, staff permissions, settings, synchronization routines, indexes, triggers, grants and row-level security. Later definitions in the file complete and harden earlier definitions: do not run selected sections alone.

The script targets the project selected in the Dashboard. It does not create or select a database by name. It does not configure the application's connection or create your first staff account.

For an existing production Supabase project, use the versioned migration workflow described in `supabase/sql/README.md`. The full schema contains historical transformations and is not a verified universal production upgrader. Back up and test on a restored copy before considering a full-schema replay.

## Event-driven synchronization upgrade for an existing Supabase project

After the normal POS schema migrations are current, run `supabase/sql/trigger_sync_upgrade.sql` in that project's SQL Editor as the database owner. This additive upgrade is already included in the full fresh-install schema. Rebuild and install the updated Electron application too; changing SQL alone does not update existing applications.

Cloud writes from desktop, web or mobile enter the existing durable change feed. A private Realtime notification wakes terminals for that branch; global changes wake all subscribed branches, and terminal-specific changes wake that terminal. Notifications contain only a table name. The scoped delta API still authorizes and transfers records using saved checkpoints. Active authenticated staff or terminal sessions are required for the private subscriptions.

Local business writes wake sync promptly. Pure activity batches wait up to two minutes; mixed sale/activity transactions stay together. A quiet two-minute recovery pass catches missed notifications and reconnects. A new terminal still bootstraps its branch data before continuing from checkpoints.

Closing Electron first saves buffered activity, drains accepted local writes and requests a final sync including activity. The window stays open if offline, paused, timed out, awaiting authorization, or still awaiting cloud acknowledgement. Shift-close synchronization also reports offline work as pending. Reconcile compares counts; it is not a substitute for transaction acknowledgement.

## Local SQL Server setup or upgrade

For an **existing local database**, close the POS application, take a backup, select your configured POS database in SSMS, and run the whole `database/sqlserver/retail-pos-local-update.sql`. This generated file uses the same wrapper as Settings downloads. It never switches databases, rejects system and unrelated populated databases, skips recorded migrations, and stops on the first error with rollback of the failing batch. Earlier successful batches remain applied and the update can be rerun. No business rows are deleted. Width repairs reject oversized values instead of truncating them. Archive flags are intentionally repaired according to the automatic archive setting.

For a **fresh POS_Local installation**, run the whole `database/sqlserver/retail-pos-local-database.sql` in SSMS with an account allowed to create a database and modify its schema. Keep the `GO` batch separators.

It creates and selects **POS_Local**, installs the 70 domain tables and local infrastructure, applies all numbered local upgrades, repairs missing store-group parents before enforcing their foreign key, and verifies all 1,183 domain columns, three local member-verification compatibility columns, and migration versions. It also includes change tracking, synchronization state and the local staff/member directory support. Existing group names are preserved; missing group placeholders are refreshed by cloud synchronization.

For a different database name, create and select that empty database, then run `retail-pos-local-update.sql`. Use the same database name in the application's connection settings. These scripts are for Microsoft SQL Server, not SQLite or Supabase.

Check every execution error and the final table, column and migration results. A later validation result does not override an earlier failed batch.

## Source files and maintenance

Only the two files above are needed for POS setup. Electron automatic upgrades and Settings → Download latest database update SQL both read `database/sqlserver/retail-pos-local-database.sql` from the installed application. They use the selected/configured database without executing the installer's `USE master` / `USE POS_Local` header, check that the target is empty or managed by Retail POS, apply the current additive definitions, skip recorded migrations and run the installer validation. Exported updates stop on the first error; failed transactional batches roll back. Successful earlier batches remain and are safe to resume. Never treat a partial run as completed.

Keep `schema.sql` and the numbered migrations as generator sources and history. Desktop release builds regenerate and verify the consolidated file before packaging. An installed older application only knows its bundled SQL; install the new application to obtain the latest update. Supabase migrations preserve the production upgrade history. Standalone repair and verification SQL are maintenance tools, not additional setup steps.

### Purchase order column widths

Migration `014_repair_purchase_order_key_widths.sql` repairs older local databases where `purchase_orders.po_number` and `store_id` remain `nvarchar(450)` instead of `nvarchar(128)`. It is included in the consolidated installer and the Settings update download. It preserves `po_number NOT NULL`, `store_id NULL`, and branch-scoped invoice uniqueness. It checks stored byte lengths under a table lock before resizing and rolls back on failure; it never truncates identifiers. Values exceeding 128 UTF-16 code units stop the upgrade with error 51014 and need review before retrying.

### Automatic archive and reactivation

With Catalogue settings → Automatically archive zero-stock products enabled, net company stock determines status: zero or negative stock is archived, and positive stock is active. Disable this setting to manage archive status manually. Existing stocked products stuck in the archive are repaired by local migration `015_restore_stocked_products_automatically.sql` and cloud migration `20261009052645_restore_stocked_products_automatically.sql`. The local upgrade is included in the consolidated installer and Settings download; apply the cloud migration to existing Supabase installations. The fresh Supabase schema includes the same behavior. Deleted rows are not restored, and malformed stock JSON is left unchanged by database repairs.

Regenerate the local installer after changing the cloud schema or local migrations:

```powershell
node scripts/supabase-registry-report.cjs
node scripts/generate-sqlserver-schema.cjs
node scripts/verify-sqlserver-schema.cjs
node scripts/verify-sync-registry.cjs
node scripts/audit-supabase-install-order.cjs
```

The isolated membership service has its own Supabase project and SQL in `supabase/membership/migrations`. Apply those only to that project; combining them with POS setup would mix separate authentication and data boundaries.

`supabase/reset.sql` deletes business data. It is never part of installation or upgrade.

After database setup, enter the Supabase URL and publishable key through **Settings → Database & Cloud Connection** on devices. The existing vault/Keystore configuration and `supabaseConfig()` resolver remain the connection authority.

Company name, logo, tax/registration numbers, company phone/website and receipt header/footer are shared globally. A fresh Electron installation asks only for its terminal name; setup downloads shared settings before processing other pending uploads or the full catalogue. Old branch/terminal copies of those identity fields no longer override the global identity. Printer and receipt layout preferences remain scoped separately. After installing this application update, reconnect through Database & Cloud Connection to refresh an older terminal's shared settings automatically; no extra SQL migration is required for this identity fix.

