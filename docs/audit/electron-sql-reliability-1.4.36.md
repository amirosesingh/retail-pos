# Retail POS 1.4.36 — reliability fixes and route audit

This patch addresses confirmed database, synchronization, loading, numbering and notification defects. The previous purchase-finalization UUID ownership fix was merged in PR #211; this patch extends that work. It does not certify that every installed-app action is crash-free.

## Findings and fixes

| Affected pages or path | Confirmed problem | Fix in this patch |
|---|---|---|
| Purchase / receiving | A supplier invoice number in one branch blocked another branch | Scope duplicate checks and database uniqueness to `(store_id, po_number)`; keep the supplier's number unchanged |
| Electron synchronization / database startup | Automatic sync, bootstrap, repair and retention could overlap | One reentrant coordinator lease for all lifecycle work |
| Bootstrap / recovery | A late baseline could skip a local write; a refresh could replace an unuploaded local row | Capture the baseline before downloads and preserve pending journal rows inside the SQL transaction; match UUID keys independently of casing |
| Synchronization | Permanent failures retried repeatedly; one bad aggregate stopped unrelated work and prevented downloads | Classify retryable failures, isolate failed aggregate tables, preserve dependency ordering and continue downloads after non-auth upload failures |
| Retention | Local history cleanup could appear as a cloud deletion | Mark cleanup with the local-only Change Tracking context |
| All cloud-dependent pages | Requests could wait indefinitely | Thirty-second request deadlines; preserve caller cancellation |
| All data-dependent pages | Loading work lacked useful counts | Shared progress ledger for reads, commits and exports; count completed work, leave unknown totals indeterminate |
| Inventory / stock count / purchase / transfer | Repeated full catalogue searches grew quadratically | Indexed product lookup and one summary audit event after durable stock-count commit; retain detailed movement records |
| Promotions / coupons / shared selectors | Opening a product selector mounted the entire catalogue | Search all options while rendering at most 100 matches |
| Members | Every member rendered at once, with a sale scan for every member | Pagination and one indexed visit-count pass |
| Bookings | Unpaginated cards; history stopped at 500 bookings and 2,000 payments | Paginated cards, keyset booking reads, paged payments and targeted live reloads |
| Suppliers | Unpaginated rows, capped directory, failed save could populate cache, refresh failures hidden | Paged reads and display, cache after acknowledged save, visible errors |
| Goods receiving / held tickets | Unbounded registers; unhandled approval refresh | Paginate displayed records and handle approval read failure |
| Product picker / verification log | Rejected async reads could escape handling or leave loading active | Handle rejection and finish loading in `finally` |
| Root startup / reconnect | Unhandled secure-profile or refresh rejection | Handle profile errors and settle independent reconnect work separately |
| Analytics / business reports | Electron analytics used cloud despite local SQL; cloud views and bills stopped at one API page | SQL-side branch aggregates for Electron; ordered complete cloud pagination; visible report limits |
| Report pages | Work continued after leaving a report; live changes did not refresh older report rows | Check cancellation between pages and coalesce committed-sale refresh signals |
| Report export | Large CSV formatting blocked the UI and revoked its download URL immediately | Format in yielding batches with actual progress; defer URL cleanup |
| Notifications / alerts | Known faults could be suppressed; missing branch identity could accept targeted branch alerts | Show real failures and enforce branch/user audience matching with canonical UUID casing |
| Shared settings / shift pages | Some committed changes were invisible until polling or reopening | Refresh active queries and scoped settings, shifts, shift sessions and bookings from committed-change signals |
| Supabase Realtime | Operational, shift and held-ticket tables were absent from the publication | Add ten existing tables without changing RLS or grants |
| Warehouse allocation | Archived sub-warehouses contributed stock, duplicate/case-variant hierarchy IDs and fractional deductions were mishandled | Canonical active hierarchy, deduplicated primary/secondary allocation and finite fractional quantities |
| Receipt / stock / receiving / transfer / booking numbering | Platform/device counters could collide; native reservations were not awaited | Branch + WEB/WIN/AND + device namespace, serialized reservation and durable acknowledgement |
| Electron write boundaries | A renderer-selected sale label could bypass member administration checks; a general label could bypass sale authority | Main-owned permission checks and validated member accrual against locked current balances; require authority for direct batch writes |

## Verification

- 1,452 tests across 219 files passed, including branch scope, permissions, aggregate rollback/replay, sync checkpoints and new reliability regressions.
- TypeScript, ESLint, merge-readiness, SQL Server schema and 70-table synchronization-registry checks run for this patch.
- Web, Electron renderer and offline phone bundle builds run for this patch. Windows installer and APK packaging are verified by GitHub release workflows after merge.
- Synthetic reads cover 100,000 catalogue rows with bounded page concurrency; selectors search the last of 100,000 entries while rendering a bounded window. The SQL snapshot test uses a mocked SQL driver, not an installed SQL Server performance benchmark.
- Beta Supabase: the three new migrations were applied. Post-checks confirmed branch-scoped purchase-number uniqueness, all ten additional publications and enabled RLS on the affected business tables.
- Source sweep parsed all 118 route files (100 pages/layouts and 18 API routes), plus the shared source modules. The existing logic scanner reported no additional candidates; this heuristic result is not proof that all functionality is correct.

## Remaining validation and limits

- Authenticated browser route tests were not run: this environment has no POS E2E test-account credentials.
- Installed Windows / native SQL Server and Android performance tests remain necessary for real hardware, device integration, memory use, offline recovery and sustained 100,000-product workloads.
- A 100,000-product catalogue is a different workload from one 100,000-line financial transaction. Native atomic writes retain the 2,000-row-per-operation and 6 MiB safety limits. Oversized writes fail visibly before committing; this patch does not introduce partially committed bulk stock-count jobs.
- Electron PIN-only sessions receive local changes immediately and remote committed changes through the existing worker, with a five-second healthy polling fallback. This is eventual synchronization, not a guarantee of instant cloud delivery while offline.
- Dependency audit passed the high-severity gate. It reports three moderate transitive entries for the unpatched `sprintf-js` advisory through `tedious`/`mssql`; no upstream fix is available. This patch does not claim those dependencies are vulnerability-free.
- CodeRabbit review is deferred at the user's request. No CodeRabbit result is claimed.

## Per-route source coverage

The inventory below records source coverage. “Source sweep” means parsing/static checks and inclusion in production compilation; it does not mean authenticated end-to-end execution of every button. API routes require their own authenticated runtime checks as well.

| Route file | Surface | Source status | Runtime status |
|---|---|---|---|
| [__root.tsx](../../src/routes/__root.tsx) | Layout | Source sweep | Installed/authenticated execution pending |
| [admin.tsx](../../src/routes/admin.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [alerts.tsx](../../src/routes/alerts.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [all-shops.tsx](../../src/routes/all-shops.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [analytics.tsx](../../src/routes/analytics.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [api/cashier-login.ts](../../src/routes/api/cashier-login.ts) | API | Source sweep | Installed/authenticated execution pending |
| [api/public/cashier-login.ts](../../src/routes/api/public/cashier-login.ts) | API | Source sweep | Installed/authenticated execution pending |
| [api/public/desktop-session.ts](../../src/routes/api/public/desktop-session.ts) | API | Source sweep | Installed/authenticated execution pending |
| [api/public/health-metadata.ts](../../src/routes/api/public/health-metadata.ts) | API | Source sweep | Installed/authenticated execution pending |
| [api/public/idle-timeout.ts](../../src/routes/api/public/idle-timeout.ts) | API | Source sweep | Installed/authenticated execution pending |
| [api/public/pos-rules.save.ts](../../src/routes/api/public/pos-rules.save.ts) | API | Source sweep | Installed/authenticated execution pending |
| [api/public/pos-rules.ts](../../src/routes/api/public/pos-rules.ts) | API | Source sweep | Installed/authenticated execution pending |
| [api/public/security-alerts.ts](../../src/routes/api/public/security-alerts.ts) | API | Source sweep | Installed/authenticated execution pending |
| [api/public/staff-idle-timeout.ts](../../src/routes/api/public/staff-idle-timeout.ts) | API | Source sweep | Installed/authenticated execution pending |
| [api/public/sync-health.ts](../../src/routes/api/public/sync-health.ts) | API | Source sweep | Installed/authenticated execution pending |
| [api/public/sync.ts](../../src/routes/api/public/sync.ts) | API | Source sweep | Installed/authenticated execution pending |
| [api/public/terminal-pairing.ts](../../src/routes/api/public/terminal-pairing.ts) | API | Source sweep | Installed/authenticated execution pending |
| [api/public/terminal-staff.ts](../../src/routes/api/public/terminal-staff.ts) | API | Source sweep | Installed/authenticated execution pending |
| [api/v1/pos/activity-preferences.ts](../../src/routes/api/v1/pos/activity-preferences.ts) | API | Source sweep | Installed/authenticated execution pending |
| [api/v1/pos/authorization.ts](../../src/routes/api/v1/pos/authorization.ts) | API | Source sweep | Installed/authenticated execution pending |
| [api/v1/pos/ipc-adopt.ts](../../src/routes/api/v1/pos/ipc-adopt.ts) | API | Source sweep | Installed/authenticated execution pending |
| [api/v1/pos/ipc-authorize.ts](../../src/routes/api/v1/pos/ipc-authorize.ts) | API | Source sweep | Installed/authenticated execution pending |
| [api/v1/pos/sync.ts](../../src/routes/api/v1/pos/sync.ts) | API | Source sweep | Installed/authenticated execution pending |
| [approvals.tsx](../../src/routes/approvals.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [audit.tsx](../../src/routes/audit.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [bookings.tsx](../../src/routes/bookings.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [c.$tokenSlug.tsx](../../src/routes/c.$tokenSlug.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [claim.$campaignSlug.tsx](../../src/routes/claim.$campaignSlug.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [coupons.tsx](../../src/routes/coupons.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [customers.tsx](../../src/routes/customers.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [dashboard.tsx](../../src/routes/dashboard.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [database-startup.tsx](../../src/routes/database-startup.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [display.tsx](../../src/routes/display.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [holds.tsx](../../src/routes/holds.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [index.tsx](../../src/routes/index.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [inventory-hub.tsx](../../src/routes/inventory-hub.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [inventory.tsx](../../src/routes/inventory.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [join.tsx](../../src/routes/join.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [members.tsx](../../src/routes/members.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [membership.tsx](../../src/routes/membership.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [pos.general-booking.tsx](../../src/routes/pos.general-booking.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [pos.racket-service.tsx](../../src/routes/pos.racket-service.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [promotions.tsx](../../src/routes/promotions.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [purchasing.tsx](../../src/routes/purchasing.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [receipts.tsx](../../src/routes/receipts.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [receiving.$id.tsx](../../src/routes/receiving.$id.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [receiving.index.tsx](../../src/routes/receiving.index.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [recovery.tsx](../../src/routes/recovery.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [reports.activity.tsx](../../src/routes/reports.activity.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [reports.analytics.tsx](../../src/routes/reports.analytics.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [reports.business.tsx](../../src/routes/reports.business.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [reports.catalog.tsx](../../src/routes/reports.catalog.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [reports.coupons.tsx](../../src/routes/reports.coupons.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [reports.history.tsx](../../src/routes/reports.history.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [reports.index.tsx](../../src/routes/reports.index.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [reports.items.tsx](../../src/routes/reports.items.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [reports.notifications.tsx](../../src/routes/reports.notifications.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [reports.payments.tsx](../../src/routes/reports.payments.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [reports.sales.tsx](../../src/routes/reports.sales.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [reports.stock.tsx](../../src/routes/reports.stock.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [reports.voids.tsx](../../src/routes/reports.voids.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [requests.$id.tsx](../../src/routes/requests.$id.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [requests.index.tsx](../../src/routes/requests.index.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [requests.new.tsx](../../src/routes/requests.new.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [sales.tsx](../../src/routes/sales.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.access.tsx](../../src/routes/settings.access.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.accounts.tsx](../../src/routes/settings.accounts.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.booking-rules.tsx](../../src/routes/settings.booking-rules.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.booking-slip.tsx](../../src/routes/settings.booking-slip.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.branch-telemetry.tsx](../../src/routes/settings.branch-telemetry.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.catalog.tsx](../../src/routes/settings.catalog.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.data-sync.tsx](../../src/routes/settings.data-sync.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.database-explorer.tsx](../../src/routes/settings.database-explorer.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.database.tsx](../../src/routes/settings.database.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.diagnostics.tsx](../../src/routes/settings.diagnostics.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.display.tsx](../../src/routes/settings.display.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.elements.tsx](../../src/routes/settings.elements.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.groups.tsx](../../src/routes/settings.groups.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.hardware.tsx](../../src/routes/settings.hardware.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.identity.tsx](../../src/routes/settings.identity.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.index.tsx](../../src/routes/settings.index.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.inheritance.tsx](../../src/routes/settings.inheritance.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.lines.tsx](../../src/routes/settings.lines.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.logic-health.tsx](../../src/routes/settings.logic-health.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.mobile-terminals.tsx](../../src/routes/settings.mobile-terminals.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.notifications.tsx](../../src/routes/settings.notifications.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.numbering.tsx](../../src/routes/settings.numbering.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.payment-methods.tsx](../../src/routes/settings.payment-methods.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.payment.tsx](../../src/routes/settings.payment.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.printer.tsx](../../src/routes/settings.printer.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.qr.tsx](../../src/routes/settings.qr.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.receipt-designer.tsx](../../src/routes/settings.receipt-designer.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.region.tsx](../../src/routes/settings.region.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.rules.tsx](../../src/routes/settings.rules.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.security-alerts.tsx](../../src/routes/settings.security-alerts.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.services.tsx](../../src/routes/settings.services.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.sessions.tsx](../../src/routes/settings.sessions.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.shift-alerts.tsx](../../src/routes/settings.shift-alerts.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.sku.tsx](../../src/routes/settings.sku.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.stock-numbering.tsx](../../src/routes/settings.stock-numbering.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.sync.tsx](../../src/routes/settings.sync.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.system.tsx](../../src/routes/settings.system.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.tax.tsx](../../src/routes/settings.tax.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.terminals.tsx](../../src/routes/settings.terminals.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.type.tsx](../../src/routes/settings.type.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.updates.tsx](../../src/routes/settings.updates.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.visibility.tsx](../../src/routes/settings.visibility.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.whatsapp.tsx](../../src/routes/settings.whatsapp.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [settings.workspace.tsx](../../src/routes/settings.workspace.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [shifts.tsx](../../src/routes/shifts.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [staff.tsx](../../src/routes/staff.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [stock-operations.tsx](../../src/routes/stock-operations.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [stores.tsx](../../src/routes/stores.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [suppliers.tsx](../../src/routes/suppliers.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [transfers.$id.tsx](../../src/routes/transfers.$id.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [transfers.index.tsx](../../src/routes/transfers.index.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [transfers.new.tsx](../../src/routes/transfers.new.tsx) | Page | Source sweep | Installed/authenticated execution pending |
| [verifications.tsx](../../src/routes/verifications.tsx) | Page | Source sweep | Installed/authenticated execution pending |
