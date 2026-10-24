# Signed-in web and performance verification — 24 October 2026

Scope: beta PR #328, localhost web preview, existing administrator session.
This is a navigation/loading smoke check, not acceptance of every financial,
hardware, or account-management operation. No live business records, settings,
credentials, or permissions were changed by these checks.

## Changes and automated evidence

- Historical report ranges share a memory cache scoped to session, user,
  permissions, database, branch and date range. Fresh revisits reuse results;
  matching changes invalidate inactive ranges. Concurrent readers share work;
  the last reader leaving stops further abandoned pagination. Active refreshes
  still reconcile the authoritative range rather than promising row-only reads
  for every report.
- Electron historical queries pass validated, bound date predicates to local
  SQL Server while preserving branch and cursor predicates.
- Unrelated audit/notification traffic no longer invalidates in-flight primary
  business snapshots. Settings and authority changes still invalidate them.
- Day/hour formatter reuse removes repeated formatter construction.
- Report product metadata and legacy cost lookups now build one index per
  calculation instead of scanning the full catalogue for every sale line.
  The index is not retained between calculations, so changed product costs are
  read next time. First-match duplicate semantics, captured zero costs, returns,
  missing products, rounding and bill allocations are preserved.
- Full Vitest suite: 453 files / 2,751 tests passed. TypeScript, ESLint and beta
  Vite build passed. Cache regression tests cover revisits, invalidation,
  shared readers and abandonment; financial tests include 2,000 catalogue
  products and 1,000 legacy sale lines with bounded catalogue traversal.

## Web checks

| Area | Pages opened / checks |
| --- | --- |
| Overview | Dashboard, All Shops, Live Business Board; figures loaded |
| Selling | Selling workspace, Sales, Held Tickets, Shifts, bill-search route, Customer Display |
| Inventory | Inventory hub/catalogue, Stock Operations, Purchasing, Receiving, Requests, Transfers, Suppliers; request/transfer forms opened without submitting |
| Customers | Membership hub, Member Directory, membership portal, Verification Log |
| Services | Bookings; legacy booking workspace routes requested |
| Authority | Approvals, Staff, Operational policies; Edit account and Edit permissions opened and cancelled; subsequent clicks worked |
| Marketing | Marketing hub, Promotions, Coupons |
| Reports | Hub, Sales/Bills/Items/Payments, Stock, Voids, Edit History, Activity, Business, Catalog, Analytics, Notifications, Coupons, Audit, Alerts |
| Administration | Administration landing and Locations |
| Settings | All 45 source settings routes requested, including the legacy aliases listed below |

Catalogue search reduced the 1,217-product catalogue to matching products and
cleared successfully. Sales report tabs and filter open/close interactions
worked. Scope-loading messages were explicitly rechecked on pages that initially
showed them; appearing briefly is not itself a freeze.

Settings coverage: accounts, access, identity, region, tax, payment,
payment-methods, booking-rules, booking-slip, services, catalog, sku, numbering,
stock-numbering, printer, hardware, receipt-designer, lines, display, elements,
visibility, database, data-sync, sync, diagnostics, system, database-explorer,
terminals, admin-terminals, mobile-terminals, sessions, branch-telemetry,
updates, workspace, notifications, shift-alerts, security-alerts, whatsapp, qr,
rules, groups, inheritance, logic-health, type, plus the settings index.

The web-only `/settings/updates` 404 is intentional: the web route tree excludes
the native updater. Native Android/Windows builds retain it. Legacy connection
URLs lead to the shared connection page; legacy access/visibility URLs lead to
Staff policies; workspace leads to Settings. These aliases are not separate
configuration backends.

## Limits and remaining acceptance

The reported complete freeze was not reproduced in this browser session. No
captured browser errors were observed during these checks. That does not prove
the symptom is resolved on physical phones or packaged Electron installations.

Physical Android/iOS and packaged Electron were not exercised. Stock/receiving
detail records require an existing suitable fixture; real payments, stock
posting, account saves, approval PINs, printing and cash-drawer operations were
not performed against live data. Public token-specific flows and recovery were
not used to replace the signed-in session. Their source/automated checks do not
substitute for device acceptance.

Keep the preview running for owner checks. Native installers must not be
published without the separate explicit publication request. No production
promotion or connected-database migration is part of this verification.
