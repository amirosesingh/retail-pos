# SQL Server migration — checkpoints 7–12

This report records the repository state after completing the requested work
through checkpoint 12. Windows `localDb` and `offlineFirst` feature flags remain
disabled pending live acceptance and the later rollout checkpoints.

## Completed repository checkpoints

| Checkpoint | Result | Evidence |
| --- | --- | --- |
| 7 — atomic business writes | Complete in source | Sale, payment, refund, shift, receiving, stock, transfer, booking, and held-order aggregates run in serializable SQL Server transactions. Stable operation receipts reject mismatched replay payloads, exact retries are idempotent, and failure injection proves rollback. Local change journals contain identifiers and metadata only. |
| 8 — durable bounded jobs | Complete in source | SQL-backed jobs persist cursors, row/byte totals, retries, status, failure details, and throttled progress. Adaptive pages stay within 100–2,000 rows and a 6 MiB target. Pause, resume, and restart continue from the last committed cursor. A test streams 1,000,000 rows while holding no more than 2,000 at once. |
| 9 — cloud sync contract | Complete in source | Generated Supabase functions cover all 67 keyed tables, composite keys, versioned tombstones, monotonic feed cursors, branch authorization, dependency ordering, stable batch receipts, and all-or-nothing aggregate application. Same-ID/different-payload replay is rejected. Cross-branch access requires explicit sync-management authority. Sensitive security tables are pull-only. |
| 10 — outbound sync | Complete in source | Outbound batches read current domain rows from SQL Server Change Tracking, preserve transaction boundaries, send parent-first, retry with the same batch ID after an uncertain acknowledgement, and advance checkpoints only after acknowledgement. Remote-origin changes are skipped. Change Tracking retention gaps and oversized indivisible transactions fail explicitly rather than skipping data. |
| 11 — inbound sync | Complete in source | A single monotonic cloud feed cursor is applied child-safe inside one serializable transaction with the cursor update. Tombstones, row versions, immutable-row correction rules, and stable conflict records are supported. Unacknowledged local changes are preserved and surfaced as conflicts. Injected apply failure proves rollback leaves the cursor unchanged. |
| 12 — bootstrap, retention, and reconciliation | Complete in source | Branch-scoped history bootstrap is dependency ordered, paged, transactional, and restartable. History choices have distinct durable jobs. Retention purges in 500-row child-first transactions while protecting current/open rows, unacknowledged changes, and unresolved conflicts. Final readiness follows sync, retention, and cloud/local count reconciliation. Retention-gap recovery starts a fresh scoped bootstrap. |

## Schema and safety properties

- The generated registry contains 67 domain tables and 1,033 columns.
- Foreign-key dependency order is generated from the actual relationships.
- The local journal stores metadata only; outbound payloads are read from the
  domain tables at delivery time.
- No production SQLite dependency, database-file fallback, SQL Browser lookup,
  UDP 1434 discovery, named-instance path, arbitrary renderer SQL channel, or
  network scan is present.
- Legacy generated Supabase clients are not imported by application code.
- The Windows rollout switches remain off until the later acceptance and
  release checkpoints.

## Automated validation

- JavaScript syntax validation for Electron CommonJS modules and generators.
- `npm run lint`.
- `npm test -- --run`, including rollback, replay, lost acknowledgement,
  conflict preservation, and the 1,000,000-row bounded-memory job.
- `npm run verify:sqlserver-schema` for all 67 mapped tables.
- `npm run verify:sync-registry` for all 67 sync decisions.
- `npm run build` production build.
- `git diff --check`.

## Live acceptance still required before enabling rollout

Repository verification cannot substitute for endpoints that are not
provisioned in this workspace. Before enabling the Windows flags, run the
acceptance suite against a non-production Windows SQL Server and Supabase
project: install and upgrade migrations, authentication variants, interrupted
bootstrap/restart, multi-terminal replay and conflict tests, retention-gap
recovery, million-row timed transfer, reconciliation, packaged Electron native
driver loading, and uninstall/reinstall recovery. These are environment
acceptance steps rather than missing fallback code; SQLite is not used.

Checkpoint 13 onward is recorded in `reports/checkpoints-13-16.md`.
