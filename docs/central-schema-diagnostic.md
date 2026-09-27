# Central Schema Diagnostic — Phase 1 Report

Date: 2026-08-23 · App 1.3.38 · Central schema definition v1

## 1. Dependency map — every component that relies on central-schema knowledge

| Component                      | File                                                          | What it knows about the central schema                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authoritative definition (new) | `src/lib/central-schema.ts`                                   | The full central contract: 27 tables, exact PostgreSQL types, required/optional classification, natural keys, idempotency indexes, `CENTRAL_SCHEMA_VERSION` |
| Drift engine (rewritten)       | `src/lib/central-drift.ts`                                    | One-way compare: authoritative definition → actual central DB. Legacy extras are informational, never drift                                                 |
| Introspection + probe          | `src/lib/central-schema.functions.ts`                         | `fetchCentralSchema` (types + nullability), `probeCentralTables` (per-table read with exact error)                                                          |
| Relay metadata                 | `src/lib/pos-relay.server.ts`                                 | `cloudSchema` returns the PostgREST root document (type/format/nullable); `cloudProbe` reads one row per table                                              |
| Push contract                  | `electron/db/cloud-columns.json`                              | The exact per-table column allow-list the till's sync engine sends — 25 tables                                                                              |
| Local schema manager UI        | `src/components/database/SchemaPanel.tsx`                     | Local repair (unchanged) + Authoritative central schema card + Sync compatibility + Fetch diagnostics                                                       |
| Data comparison                | `src/lib/data-compare.ts`                                     | `COMPARE_TABLES` — report tables; every one is guaranteed present in the authoritative definition (tested)                                                  |
| Sync worker                    | `electron/sync/worker.cjs`                                    | Pushes queued rows per `cloud-columns.json`; parks rows on unrecoverable push errors                                                                        |
| Windows operational database   | `electron/db/`                                                  | Direct SQL Server repositories, controlled migrations, and change tracking                                                                                |

## 2. Why the old drift check lied

The previous engine derived "expected central columns" from the **local** master
schema narrowed by the push contract. The local schema carries till-only
bookkeeping (`is_synced`, `sync_status`, `last_error_at`, `branch_id`,
`updated_at`, …) and till-only tables (`sync_state`, `system_settings`,
`transfers`). Any mismatch in that narrowing raised
false "missing column" alarms, while genuinely wrong central types went
unnoticed. The comparison direction is now fixed: the authoritative central
definition is the only yardstick, and the local schema is never consulted for
central validation.

## 3. The six "unable to fetch" features

User-reported: **Held Orders, Stock Transfers, Cashiers, Stock Takes,
Terminal users, Transactions**.

Findings (verified by reading the code, not assumed):

- No literal "Unable to fetch …" string for these names exists anywhere in
  `src/` or `electron/`. The messages are produced at runtime by the generic
  error wrappers (`src/lib/notify.ts`, `src/lib/db-mode.ts`), which re-label
  any thrown `Failed to fetch` / network / PostgREST error.
- These screens read local-first through `src/lib/pos-db.ts` and fall back to
  the central relay. When the central side is the failure point, the raw
  PostgREST error (missing table → schema-cache error, permission → 401/403,
  connectivity → `Failed to fetch`) was swallowed into one generic toast.
- **Resolution shipped this round:** the Schema manager now has **Fetch
  diagnostics**, which reads every authoritative central table once and shows
  the exact per-table error (`HTTP 400 …`, `HTTP 401 …`, network), naming the
  failing table, so the failure point is visible instead of inferred.

## 4. The "situation" error

- A case-insensitive search of the full codebase (`src/`, `electron/`) finds
  **no `situation` literal** — the string does not originate in app code.
- Most likely origin: a raw error body from the central database (PostgREST or
  PostgreSQL detail text) surfaced verbatim by the generic toast path above.
- Status: **not reproducible from source alone**. Next occurrence: copy the
  full toast text or run Schema manager → Fetch diagnostics while it happens;
  the probe now preserves the exact server message (`HTTP <status>: <body>`).

## 5. Verification results

- The authoritative definition covers all 27 central tables (listed in §1).
- Every table the reports compare (`COMPARE_TABLES`) exists in the definition
  — tested, so no report can silently lose data.
- No definition column is a local-only sync-bookkeeping name; no till-only
  table appears — tested.
- `client_transaction_id` is required on `sales` and `payment_transactions`
  and absent from `held_orders`, matching the offline-sync idempotency
  contract; the payments idempotency index ships with the definition.
- Against the live central database the engine flags exactly the five genuine
  gaps (`payment_transactions.client_transaction_id`,
  `pos_settings.receipt_css`, `pos_store_settings.require_pin_terminal_reset`,
  `pos_store_settings.row_version`, `pos_store_settings.updated_by`) and
  reports a fully repaired database as clean — 18 tests, all passing.

## 6. Remaining blockers

- **Runtime trace of "situation":** needs one live reproduction (see §4).
- **Role-level fetch failures:** the probe runs with the service key, which
  bypasses row security. A failure that only hits the anonymous/authenticated
  role (RLS policy) needs the failing screen's own request — its network
  entry now carries the exact response body via the probe comparison.
- **Missing whole tables:** a column-only repair script cannot create tables
  with their grants and policies; that case is blocked by design and needs
  the authoritative central migration.
