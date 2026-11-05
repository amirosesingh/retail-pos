# Synchronization table coverage — 5 November 2026

This is a read-only source/evidence audit, not an all-table end-to-end acceptance report. Registry and shared runtime were inspected at `0d2dcf45699baf350cda16efdece03cf4b108c98` in `codex/single-sync-lane-beta` (PR399). This document is recorded separately in the recovery worktree, whose starting HEAD was `91d46bcd1813611297b885b9ab60ea2fd38ca8a3`. Uncommitted recovery additions in that worktree are a separate implementation/test scope and are not declared verified by this inventory. No database, registration, permission, queue, checkpoint, enabled-table or runtime change was performed by this audit.

## What the registry actually establishes

`database/sqlserver/schema-registry.json` contains **70 tables: 60 bidirectional, 10 pull-only; 62 branch-labelled, 8 organization-labelled**. Registry scope is a classification, not an authorization grant. Actual admission, branch/cluster visibility, privacy, relation ownership and management capabilities still depend on the relay, database routines and native read/write predicates. A table being registered does not mean every user may read/write it or that its current database deployment matches the repository.

Every table has primary-key metadata, dependency ordering and conflict/delete decisions. All 70 `testName` values are metadata strings: none is referenced as an executable test name in the bounded test search below. Do not report “70 decisions verified” as 70 successful synchronization workflows.

## Shared paths and recovery legend

- **U:** `electron/sync/push-worker.cjs` drains SQL transaction journals/financial evidence, then scans eligible registry tables using `ChangeReader.changedIds`. Pull-only tables are explicitly skipped. Locally generated/remote context, stable receipts, current proof, author checks and domain guards still apply. Pure activity work can be deferred; mixed business transactions retain their original atomic group. This is not one independent sync engine per table.
- **D:** `electron/sync/pull-worker.cjs` consumes the shared incremental feed. Parent-first upserts and reverse dependency tombstones are applied in a local transaction with its committed cursor. Pending local work is preserved; a failed page must not advance. `CloudClient.applyLocalBatch` additionally applies typed conflict, privacy and no-op-write rules.
- **B:** `electron/jobs/bootstrap.cjs` obtains scoped, bounded pages, commits each page and durable job cursor together, and records the completed snapshot baseline. Bootstrap may intentionally fetch existing scoped rows after an expired feed/history window; no-op row application is distinct from eliminating HTTP downloads.
- **R:** ordinary expired-Change-Tracking recovery in `electron/jobs/lifecycle.cjs` refreshes the affected scoped table after durable journal upload, preserving pending rows, before advancing the captured push baseline. This is a source path, not evidence that every legacy table survives a long-offline gap. Every applicable writer must also prove atomic durable pending evidence; raw/old SQL edits are not automatically protected by a registry entry.
- **R-P:** centrally managed pull-only table refresh. No local business upload is authorized by registration in the registry.
- **R-S:** six-table shift graph recovery. `shift-gap-recovery.cjs`, `shift-graph.cjs` and `ChangeReader` require exact complete graph/provenance and pending-work checks; ambiguous retained work stays review-required. Original closings and authorized later corrections cannot be resolved by newest timestamp/version alone. The new legacy recovery implementation is tracked/tested separately.
- **R-H:** specialized bounded/resumable `change_history` recovery via `electron/sync/history-recovery.cjs`; preserves committed page progress and source scope.
- **HOLD:** existing Membership tables/paths remain registered but Membership is ON HOLD. This audit does not activate, redesign, alter, or authorize new tests/writes against Membership. Shared checkout/member references and the existing membership-directory cursor are dependencies, not permission to expand this batch.

All sync-data HTTP calls through the Main `CloudClient` use the new single fair in-memory request lane in PR399. Its ordering queue is transient; **SQL Server remains Electron's only durable pending business store**. Health/admission/authentication control requests remain independent. This does not imply one physical PostgreSQL connection.

## Evidence status

All rows have **STR** structural metadata/schema tests. The group labels below identify additional existing focused test sources inspected; they do not mean every operation in the group was executed against both real databases. **GAP** means no literal table-name reference was found in the bounded search of `src/lib/__tests__/**/*.test.ts` and top-level `scripts/test-*.cjs` / `scripts/test-*.mjs`. Indirect generic fixtures may still cover structure; absence of a literal is not a confirmed defect. No table is marked installed/deployed E2E verified by this audit. Tests were inspected, not rerun here.

| Table | Direction | Registry scope | Primary key | Registry delete | Paths / recovery | Evidence group |
| --- | --- | --- | --- | --- | --- | --- |
| `activity_events` | Both | branch | `id` | tombstone | U/D/B/R | STR; HISTORY |
| `app_users` | Pull | branch | `id` | tombstone | D/B/R-P | STR; PULL |
| `audit_logs` | Both | branch | `id` | tombstone | U/D/B/R | STR; HISTORY |
| `authorization_action_history` | Both | branch | `id` | none | U/D/B/R | STR; AUTHZ |
| `authorization_actions` | Both | branch | `id` | tombstone | U/D/B/R | STR; AUTHZ |
| `authorization_log` | Both | branch | `id` | tombstone | U/D/B/R | STR; AUTHZ |
| `authorization_requests` | Both | branch | `id` | tombstone | U/D/B/R | STR; AUTHZ |
| `booking_payments` | Both | branch | `id` | tombstone | U/D/B/R | STR; SALE |
| `bookings` | Both | branch | `id` | tombstone | U/D/B/R | STR; SALE |
| `branch_telemetry` | Both | branch | `terminal_id` | tombstone | U/D/B/R | STR; HISTORY |
| `cashiers` | Pull | branch | `id` | tombstone | D/B/R-P | STR; PULL |
| `change_history` | Both | branch | `id` | tombstone | U/D/B/R-H | STR; HISTORY |
| `coupon_campaigns` | Both | organization | `id` | tombstone | U/D/B/R | STR; COUPON |
| `coupon_events` | Both | branch | `id` | tombstone | U/D/B/R | STR; COUPON |
| `drawer_events` | Both | branch | `id` | tombstone | U/D/B/R | STR; SALE |
| `entity_status_history` | Both | branch | `id` | tombstone | U/D/B/R | STR; HISTORY |
| `held_orders` | Both | branch | `id` | tombstone | U/D/B/R | STR; SALE |
| `integration_settings` | Both | branch | `id` | tombstone | U/D/B/R | STR; CONFIG |
| `issued_vouchers` | Both | organization | `id` | none | U/D/B/R | STR; COUPON |
| `item_activity_logs` | Both | branch | `id` | tombstone | U/D/B/R | STR; STOCK |
| `member_verifications` | Both | branch | `id` | tombstone | U/D/B/R; HOLD | STR; HOLD; GAP |
| `members` | Both | organization | `id` | tombstone | U/D/B/R; HOLD | STR; HOLD |
| `membership_tiers` | Both | organization | `id` | tombstone | U/D/B/R; HOLD | STR; HOLD |
| `nav_pins` | Both | branch | `id` | tombstone | U/D/B/R | STR; CONFIG; GAP |
| `offline_sync_audit_log` | Both | branch | `id` | tombstone | U/D/B/R | STR; HISTORY; GAP |
| `payment_transactions` | Both | branch | `id` | tombstone | U/D/B/R | STR; SALE |
| `payment_types` | Both | organization | `id` | tombstone | U/D/B/R | STR; CONFIG |
| `pin_attempts` | Both | branch | `key` | tombstone | U/D/B/R | STR; PIN |
| `pos_settings` | Both | branch | `id` | tombstone | U/D/B/R | STR; CONFIG |
| `pos_store_settings` | Both | branch | `store_id` | tombstone | U/D/B/R | STR; CONFIG |
| `product_barcodes` | Both | branch | `id` | tombstone | U/D/B/R | STR; STOCK |
| `product_categories` | Both | branch | `id` | tombstone | U/D/B/R | STR; STOCK |
| `products` | Both | branch | `id` | tombstone | U/D/B/R | STR; STOCK |
| `promotions` | Both | branch | `id` | tombstone | U/D/B/R | STR; STOCK |
| `public_flags` | Pull | branch | `key` | tombstone | D/B/R-P | STR; PULL |
| `purchase_order_items` | Both | branch | `id` | tombstone | U/D/B/R | STR; PURCHASE |
| `purchase_orders` | Both | branch | `id` | tombstone | U/D/B/R | STR; PURCHASE |
| `record_edits` | Both | branch | `id` | tombstone | U/D/B/R | STR; HISTORY |
| `sale_items` | Both | branch | `id` | tombstone | U/D/B/R | STR; SALE |
| `sales` | Both | branch | `id` | tombstone | U/D/B/R | STR; SALE |
| `secure_settings` | Pull | branch | `key` | tombstone | D/B/R-P | STR; PULL |
| `security_findings` | Pull | branch | `id` | tombstone | D/B/R-P | STR; PULL; GAP |
| `settings_locks` | Pull | branch | `section` | tombstone | D/B/R-P | STR; PULL |
| `settings_overrides` | Both | branch | `scope, scope_id, section` | tombstone | U/D/B/R | STR; CONFIG |
| `settings_scoped` | Both | branch | `scope, scope_id, key` | tombstone | U/D/B/R | STR; CONFIG |
| `shift_cash_counts` | Both | branch | `id` | none | U/D/B/R-S | STR; SHIFT |
| `shift_close_events` | Both | branch | `id` | none | U/D/B/R-S | STR; SHIFT |
| `shift_notifications` | Both | branch | `id` | none | U/D/B/R-S | STR; SHIFT |
| `shift_reconciliations` | Both | branch | `id` | none | U/D/B/R-S | STR; SHIFT |
| `shift_sessions` | Both | branch | `id` | tombstone | U/D/B/R | STR; SALE |
| `shift_variance_alerts` | Both | branch | `id` | tombstone | U/D/B/R-S | STR; SHIFT |
| `shifts` | Both | branch | `id` | tombstone | U/D/B/R-S | STR; SHIFT |
| `sku_audit` | Both | branch | `id` | tombstone | U/D/B/R | STR; HISTORY; GAP |
| `staff_roles` | Pull | organization | `slug` | tombstone | D/B/R-P | STR; PULL |
| `stock_adjustments` | Both | branch | `id` | tombstone | U/D/B/R | STR; STOCK |
| `stock_count_drafts` | Both | branch | `id` | tombstone | U/D/B/R | STR; STOCK |
| `stock_delta_applied` | Both | branch | `movement_id` | tombstone | U/D/B/R | STR; STOCK |
| `stock_transfer_items` | Both | branch | `id` | tombstone | U/D/B/R | STR; TRANSFER |
| `stock_transfers` | Both | branch | `id` | tombstone | U/D/B/R | STR; TRANSFER |
| `store_groups` | Both | organization | `id` | tombstone | U/D/B/R | STR; CONFIG |
| `stores` | Both | organization | `id` | tombstone | U/D/B/R | STR; CONFIG |
| `suppliers` | Both | branch | `id` | tombstone | U/D/B/R | STR; PURCHASE |
| `sync_metadata` | Both | branch | `id` | tombstone | U/D/B/R | STR; HISTORY; GAP |
| `system_audit_logs` | Both | branch | `id` | tombstone | U/D/B/R | STR; HISTORY |
| `terminal_commands` | Both | branch | `id` | tombstone | U/D/B/R | STR; HISTORY; GAP |
| `terminal_recovery_secrets` | Pull | branch | `terminal_token_id` | tombstone | D/B/R-P | STR; PULL |
| `terminal_tokens` | Pull | branch | `id` | tombstone | D/B/R-P | STR; PULL |
| `uom_units` | Both | branch | `id` | tombstone | U/D/B/R | STR; CONFIG |
| `user_roles` | Pull | branch | `id` | tombstone | D/B/R-P | STR; PULL |
| `whatsapp_queue` | Both | branch | `id` | tombstone | U/D/B/R | STR; HISTORY; GAP |

## Focused evidence and limits by group

- **STR:** `sqlserver-schema-registry.test.ts` loops all 70 tables for generated schema/type/key/dependency requirements; `verify-sync-registry.cjs` checks text markers. These are useful structural tests, not SQL Server → relay → PostgreSQL → second-terminal round trips.
- **PULL / PIN:** `native-sync-scope-parity.test.ts` executes generated promotion/PIN predicates in isolated PGlite; `sync-noop-updates.test.ts` checks the `app_users` column allowlist path; terminal/login/privacy tests cover several authentication cases. `pin_attempts` preserves native `electron:` and approval lockout rows separately from mirrored server rows. This does not prove full refresh/tombstone/revocation round trips for all ten pull-only tables. Secrets/roles must never become terminal-authoritative uploads.
- **CONFIG:** `native-settings-shifts.test.ts`, `sync-reconciliation.test.ts`, `store-sync-ownership.security.test.ts` and `sqlserver-checkpoints-7-12.test.ts` cover selected denial, scoped count, parent recovery and transactional settings behavior. Composite scoped keys and global/cluster/terminal inheritance need per-key denied-delete/retry/expiry acceptance, not only schema checks. Pending offline edits require verified user authorization; `settings_locks` remains pull-only.
- **SALE:** `scripts/test-sync-pipeline.cjs` executes actual workers with mocked transports/transactions for lost acknowledgement, pending retention and cursor ordering. `checkout-e2e.test.ts`, `atomic-sale-contract.test.ts`, financial-operation/history and receipt tests exercise selected business contracts. Several SQL Server and PostgreSQL financial scripts exist, but their presence is not installed checkout/offline/reconnect acceptance. Sales, lines and payments must remain atomic/idempotent with causal financial history; booking/deposit attribution remains its separately tracked business correction.
- **STOCK:** `stock-count-sync.test.ts`, `native-catalogue-cluster.test.ts`, `native-sync-scope-parity.test.ts`, `sync-noop-updates.test.ts`, `scripts/test-product-owner-sync.mjs` and `scripts/test-sync-noop-sqlserver.cjs` cover selected product ownership, movement identity and value-equality paths. The latter uses an owned disposable SQL Server fixture, not all production tables. Stable movements prevent double deductions; product absolute quantities are not a substitute for movement evidence. Existing archive/cluster and same-cluster availability rules remain necessary.
- **TRANSFER:** parent grouping tests and native transfer approval/dispatch relay/SQL fixtures cover requested, approved, dispatch receipt, branch denial and concurrency cases. This does not prove every old-client offline lifecycle plus tombstone/recovery combination for both tables. Shared request/transfer parentage and source/destination authorization must remain intact.
- **PURCHASE:** `purchase-order-sync-recovery.test.ts` tests selected legacy unowned-header recovery, branch denial, UUID/date normalization and delete-phase propagation; `push-aggregate-parents.test.ts` checks dependency grouping. Supplier deletion tests cover durability. Full large receiving + lost acknowledgement + long-expired-history inventory reconciliation across two PCs remains distinct acceptance.
- **SHIFT:** strongest specialized coverage exists: `shift-gap-recovery-sqlserver.test.ts`, `shift-protocol-cross-boundary.test.ts`, `current-shift-graph-upload.test.ts`, author/causal/financial graph tests, and isolated native/PostgreSQL scripts. These cover complete six-table groups and exact values, permissions, retries and selected long-offline scenarios. They do not make unknown legacy closings safe to overwrite; ambiguous retained graphs must still be classified and reviewed. Newly prepared legacy recovery has its own exact-source and isolated test gates.
- **AUTHZ:** `electron-governance-sync.security.test.ts`, `local-first-authorization-rules.test.ts`, `rls-policy-regression.test.ts`, and approval tests exercise current-user permission/branch decisions and selected audit paths. A registered table is not an offline approval grant. Full acknowledgement/replay/expiry combinations across all four authorization tables remain unproven here.
- **HISTORY:** `scripts/test-sync-pipeline.cjs`, `scripts/test-event-sync.cjs`, `scoped-sync-pull-sql.test.ts`, bounded feed/history/PostgREST suites, and notification tests cover selected audit/activity feed/ack/privacy and paging contracts. Some scripts execute real isolated PostgreSQL/PostgREST; this audit did not rerun them. History retention, privacy projection, recovery and append-only semantics differ by domain; one successful audit page is not every table's E2E proof.
- **COUPON:** coupon reporting/security tests reference the three tables and selected branch/access invariants. No full offline issuance/redemption/conflict/expiry/tombstone cross-terminal acceptance was established here.
- **HOLD:** Membership remains excluded from this implementation batch. Existing member/tier/directory/checkout references are left unchanged. Do not interpret the HOLD label as removing cached Membership rows or altering shared loaders.

## Specific verification gaps

1. **Eleven tables skipped by marker verification.** `verify-sync-registry.cjs` filters tables having a column named `id`, rather than all registry primary keys. Its per-table marker loop skips: `branch_telemetry`, `pin_attempts`, `public_flags`, `secure_settings`, `settings_locks`, `settings_overrides`, `staff_roles`, `stock_delta_applied`, `terminal_recovery_secrets`, `pos_store_settings`, `settings_scoped`. The final log still prints 70. Existing schema tests do cover key metadata; the script's success is only its narrower assertion set. Add approved execution-based composite/non-id key tests before claiming complete sync coverage.
2. **Eight direct-reference gaps.** The bounded test-source search found no literal table reference for: `member_verifications`, `offline_sync_audit_log`, `security_findings`, `sku_audit`, `sync_metadata`, `terminal_commands`, `whatsapp_queue`, `nav_pins`. This is absence of located evidence, not proof of a runtime bug. Trace actual writer/read usage and build allowed/denied insert/update/tombstone/bootstrap/resume/long-offline cases where applicable. Do not enable a disabled/server-only/held feature merely to make a test matrix green.
3. **No uniform 70-table round-trip harness found.** `scoped-sync-pull-sql.test.ts` creates minimal tables from the full registry, then exercises product-feed paging/tombstone and branch-denial cases; creating all schemas is not exercising all table rows. Current native lifecycle/worker tests mostly use representative registries/fixtures. `e2e/deployed-readonly.spec.ts` is page/route visibility smoke, not mutable offline sync acceptance. Isolated renderer tests stub native SQL; they must not be called real SQL Server round trips.
4. **Authority labels are incomplete evidence.** Registry `highest_version` does not describe every current conflict path: five configuration tables use timestamp plus deterministic version tie-breaking in `CloudClient`, shift actions use protected causal evidence, and movement/financial data have domain-specific validators. Highest version or newest wall-clock time alone never authorizes overwriting offline work or admin corrections.
5. **Recovery must be proved against durable writer behavior.** Ordinary R relies on completed durable-journal upload and pending checks. Per-table tests must include a writer saving both business rows and outbox evidence in the same SQL transaction, long-offline CT expiry, lost response, local acknowledgement failure, restart halfway through snapshot and a concurrent edit. For legacy/raw SQL edits, evidence may be unavailable; do not reset a baseline simply to remove a warning.
6. **Delete is not universal.** Registry delete `none` applies to `issued_vouchers`, `authorization_action_history`, `shift_cash_counts`, `shift_close_events`, `shift_reconciliations` and `shift_notifications`; these require append-only/reversal/domain transitions. Other tombstones still require parent/branch/permission validation and pending-local-work protection. Reverse dependency application does not by itself prove each delete API is authorized.

## Previous-document drift

`docs/audit/sync-coverage.md` says it is generated; its current values differ from the registry for these rows:

| Table | Previous document | Current registry |
| --- | --- | --- |
| `members` | branch | organization |
| `membership_tiers` | branch | organization |
| `issued_vouchers` | branch; tombstone | organization; none |

`docs/audit/system-sync-architecture.md` is dated 29 September and includes historical live-security/deployment findings and “repository complete” phase labels. Those are evidence for the recorded revision, not current database assertions. Neither file was blindly regenerated/overwritten here. A future approved documentation refresh should preserve dated historical findings and reconcile generated ownership/conflict descriptions with actual current validators.

## Bounded execution follow-up

At the recovery runtime checkpoint c900679d (documentation head667911f5), the
registry verifier executed successfully. Its printed70 decisions remain the
narrow structural assertions described above, not70 end-to-end workflows.
Additional source tracing confirms all11 non-id tables use declared-key local
apply/cloud feed/delete paths. The skipped marker assertions alone do not
establish missing synchronization.

Five owned isolated HTTP/PostgreSQL observations tested two candidates using the
actual guarded relay and canonical service RPC. No live project was queried or
changed by these checks:

- `secure_settings`: valid-device upload and tombstone both returned400 /
  `SYNC_TABLE_FORBIDDEN`; no insert or change to the seeded ciphertext. The earlier
  suspicion based on the presence of generic SQL helpers was disproved.
- Invalid device proof returned401 before any service RPC.
- `nav_pins`: canonical ordinary-user RLS denied a foreign-owner write, while a
  valid terminal-only sync request updated and deleted the foreign pin with200
  and stored/deleted readback. This confirms a current-source ownership gap for
  user preferences. It does not establish anonymous access, financial/stock
  impact or parity with deployed live definitions. No correction is applied.

Keep nav-pin correction as a separate authorization scope with authentic original
author/owner evidence, legitimate offline retry and allowed/denied cases. Do not
solve it by widening grants or silently disabling valid preference sync. Composite
key round trips, the other table families and installed acceptance remain pending.
Synthetic fixture data and security artifacts are excluded from commits.

## Deliberate exclusions and dependencies

The 70 operational tables exclude cloud-only `user_sessions`, `sync_change_feed`, `sync_idempotency_receipts`, SKU number lease/state, and checked-online ledgers such as notification deliveries, sponsorship issue/policy and missed-bill entries (see `scripts/sqlserver-sync-policy.cjs`). New financial author/receipt/history metadata may have separate protected protocols; registry count alone is not their total count or an instruction to replicate them. SQL local migrations/checkpoints/jobs/conflicts/operation receipts/journal are synchronization infrastructure, not cloud business tables.

Membership hold remains explicit. No schema grants, pool limits, terminal registration, operator URLs, retained data or working checkout paths were changed. Before any wider implementation, select a small table family, inspect its real writers and immutable acceptance evidence, test its allowed and denied complete lifecycle in isolated databases, and retain a targeted rollback. Deployed/installed acceptance and exact-target database application remain separate gates.
