# POS synchronization architecture audit

Audit date: 2026-09-29

This began as the required Phase 1 baseline and now records the completed incremental refactor in the repository. It is not a proposal for a replacement architecture. Production deployment remains gated by the backup and reconciliation checks below.

## Confirmed runtime path

```text
Electron renderer
  -> preload IPC
  -> Electron main process
  -> Microsoft SQL Server (normal POS reads and writes)
  -> SQL Server Change Tracking + sync_change_journal/checkpoints
  -> hosted POS sync relay (terminal token fixes the device branch)
  -> Supabase/PostgreSQL sync RPCs
  -> sync_change_feed
  -> incremental pull into the same local SQL Server database

Web/Admin
  -> authenticated server/API/RPC paths
  -> Supabase/PostgreSQL
  -> sync_change_feed
  -> next durable Electron pull
```

The Electron operational database is Microsoft SQL Server. SQLite is not used. Electron has one main-process synchronization worker. The browser/mobile compatibility queue is not the Electron persistence mechanism and must not be promoted into a second desktop architecture.

## Existing synchronization mechanisms

| Concern | Existing implementation | Decision |
|---|---|---|
| Local change detection | SQL Server Change Tracking and `sync_change_journal` | KEEP |
| Durable checkpoints | `sync_checkpoints`, per branch/domain | KEPT; branch and terminal scope are explicit |
| Retry/idempotency | local operation receipts and cloud `sync_idempotency_receipts` | KEEP |
| Incremental cloud pull | `sync_change_feed.cursor` and `pos_sync_pull` | KEPT; scope predicates corrected |
| Initial/resumable load | `pos_sync_bootstrap` with table cursors and history bounds | KEPT; scope predicates corrected |
| Background sync | Electron main-process timer; automatic retries and periodic verification | KEEP |
| Manual sync | IPC `sync:run-now` | REFACTORED; renderer-supplied branch identity is ignored |
| Startup sync | local lifecycle pushes pending work before bootstrap/pull | KEPT with version-safe shared data |
| Realtime | PostgreSQL change subscriptions wake refresh/sync code | KEPT as filtered hints only |
| Browser outbox | web/mobile fallback code under `src/lib/sync-outbox.ts` | KEEP outside Electron; do not make it the desktop design |
| Edge Functions | none deployed in the inspected Supabase project | N/A |
| Scheduled database work | daily `security_selfcheck()` only | KEEP; it is not a sync scheduler |

## Exact stale-overwrite cause

The failure is a combination of three existing behaviours:

1. `electron/sync/coordinator.cjs` uploads local changes before pulling central changes.
2. `electron/sync/pull-worker.cjs` preserves an unacknowledged local row while that row is pending upload.
3. Generated PostgreSQL `ON CONFLICT DO UPDATE` clauses are unconditional for synchronized tables that have no `row_version`.

For `settings_overrides` and `settings_scoped`, a stale SQL Server row can therefore be uploaded before the newer Web value arrives. Those tables also enter the change feed as `global`, because the generator only understands `store_id`, `branch_id`, and transfer endpoints. The result is both a conflict bug and an over-fetch bug.

Changing only push/pull order is insufficient: pending local journal entries would still make pull preserve the stale local copy. The safe correction is server-authoritative revisions plus compare-and-set upserts, correct scope-aware feed routing, and durable pull checkpoints.

## Branch and identity findings

- Terminal activation is stable and server verified. The relay validates the terminal token, derives its `location_id`, and rejects a different submitted branch.
- The current deployment is one organization per configured Supabase project. The sync contract uses `organization_id = 'default'` and now rejects every other organization value server-side instead of trusting the client. A future multi-organization-in-one-project deployment still requires an explicit schema migration.
- The existing product models the physical register as its stable terminal identity; it has no separate register entity. Register-specific settings/prices therefore use terminal scope instead of inventing an unreferenced parallel identifier.
- Sales, payments, shifts, purchasing, and most operational rows are branch-filtered in bootstrap/pull.
- Transfers correctly use source/destination participation predicates.
- `settings_overrides`, `settings_scoped`, and `authorization_actions` now route by Global/Cluster/Branch/Terminal scope.
- Terminal settings and change-feed entries use the verified terminal ID supplied by the relay, never a renderer-selected identity.

## Data-domain findings

| Domain | Completed repository protection | Deployment note |
|---|---|---|
| Sales / bill lines / payments | immutable/reversal conflict policies, global client transaction IDs, batch receipts | deploy unchanged business semantics |
| Inventory | movement rows, stable movement IDs, `stock_apply_delta`, applied-movement deduplication and replay tests | reconcile movement totals before deployment |
| Stock requests/transfers | both participating branches only; enforced lifecycle; append-only transition history; receipt posting once | validate open documents during preflight |
| Products/pricing | shared plus own-branch catalogue filtering; scoped Global/Cluster/Branch/Terminal price resolution | deploy schema first, then client |
| Settings | server revisions, compare-and-set upload, scoped feed routing, RLS and verified terminal identity | deploy schema first, then client |
| POS authorization | existing request/log/history system retained and scoped | deploy pending migrations before client |
| Audit/history | operational histories plus standardized append-only product/settings change history | retain according to production audit policy |

## Security findings from live Supabase

RLS is enabled on the inspected public tables, but permissive policies currently weaken isolation:

- `settings_overrides_read` and `settings_scoped_read` use `USING (true)`.
- `terminal_commands_staff_read/update/write` use unconditional predicates.
- `pos_store_settings` has a branch-aware policy and a second all-staff policy; PostgreSQL permissive policies are ORed, so the broader policy wins.
- The live database is behind the repository: `authorization_action_history` and the latest authorization revision columns are present in repository migrations but not in production.

No production DDL should be applied until backup, record-count, financial-total, inventory, held-bill, approval, transfer, request, and pending-local-change preflight checks have been captured.

## Direct-query audit

Direct `.select('*')` calls exist, but not all are defects. Each must be judged by ownership and RLS:

- branch operational screens generally add a branch predicate and must retain matching RLS;
- organization catalogue/configuration reads can legitimately be global;
- head-office telemetry and activity views require explicit multi-branch permission;
- no UI-only filter is accepted as a security boundary.

The Electron normal-operation path routes through local SQL Server. Direct Supabase access must remain limited to hosted/admin functions, activation, authentication, and intentional recovery paths.

## Incremental migration plan

1. **Phase 1 — repository complete:** architecture map, generated sync coverage, live schema/policy comparison, stale-overwrite root cause and table classification.
2. **Phase 2 — repository complete:** activated-branch IPC binding, server scope predicates, RLS and verified terminal identity.
3. **Phase 3 — repository complete:** authoritative revisions for mutable synchronized configuration/master rows, scoped change feed, append-only history and stale-write tests.
4. **Phase 4 — repository complete:** one Electron main-process synchronization framework retained; no desktop Outbox added.
5. **Phases 5–9 — repository complete:** settings/rules, products/pricing, inventory, financial transactions and remaining classified domains are covered by the scoped contract and tests.
6. **Phase 10 — repository complete:** compiler-proven unused code removed after reference checks; active browser/mobile compatibility paths retained.
7. **Production rollout — intentionally not executed:** run the gates below, apply migrations in order, deploy the compatible client, then reconcile.

## Production gates

Before applying any generated migration:

- create verified Supabase and SQL Server backups;
- record table counts, sales totals, tender totals and stock balances;
- record held bills, open shifts, pending approvals, requests and transfers;
- prove all local journals are either uploaded or intentionally retained;
- rehearse forward and rollback migrations on disposable databases;
- deploy server migration before clients that require its new RPC signature;
- compare and reconcile before enabling writes.
