# Beta local writes, startup recovery and idle synchronization

This source change follows the 18 November read-only audit of installed
1.4.84-beta.11. Production, installed profiles, existing local transactions and
hosted database schemas are outside this implementation batch.

## Behavior and evidence

| Area | Required behavior | Focused evidence |
| --- | --- | --- |
| Supported Windows writes | Read the native database state before selecting a writer. Missing, rejected or malformed state and enabled-but-unready SQL stop the save. A refused native write never becomes a cloud retry. | `local-write-route`, `checkout-e2e`, `db-router`: 62 tests passed. Includes booking aggregate requirements, explicit session fallback and SQL-disabled routing. |
| Store rules | The two supported native fields, `block_shift_close_on_hold` and `max_drawer_cash_limit`, use the existing versioned local edit queue even while online. Preserve the exact decimal amount, operation ID, branch, draft and uncertain-response fences. | `pos-rules-editor-baseline`, `pos-rules-draft`, `pos-rules-queue-context`, `pos-rules-canonical-save`: 56 tests passed. |
| Central administration | Other/mixed rule edits retain the existing authorized central writer while online, with an explanation before save. Cluster settings and store-group administration retain their existing server authorization. | Existing policy boundaries inspected; no new native cluster authority or cloud-only table writer enabled. |
| Startup | Bootstrap is preparation, not a disconnected database. Financial review requires an explicit shift-domain hold. Late status/retry responses cannot replace newer readiness. | Startup slice: 136 focused tests across seven suites passed; real Administrator/native review admission remains enforced. Two stale CI test contracts were updated to the safe table diagnostic and runtime observer/readiness behavior. |
| Idle work | Keep ten-second revocation reads and immediate security signals. Coalesce successful heartbeat writes to sixty seconds. Reuse empty legacy-recovery ranges only within the same serializable transaction. | `terminal-revocation-context`, `legacy-recovery-service`, `legacy-recovery-runtime`: 84 tests passed. Includes concurrency, retries, scope changes and fresh later-cycle checks. |
| Status | Equal counts are labelled as count matches, not verified data. Content verification and deferred Membership service status remain distinct. | `sync-status-summary`: 50 tests passed, including the actual panel rendering. |
| Refund admission and transfer handoff | Require Main-verified, transaction-rechecked refund authority. Retain exact receipt replay and existing transfer stage permissions; verify pending uploads before central transfer actions. | 196 tests across nine affected approval/refund/transfer suites passed, with independent agent review. Covers missing/fake tokens, current identity/policy, hosted expiry/audit, direct authority, disabled SQL, failed upload barriers and retry. |

The eight routing/settings/status suites passed together: 168 tests. These are
source and controlled-fixture results, not installed-device acceptance.
After the financial and CI-contract fixes, all 27 affected suites passed together:
584 tests. Scoped lint and diff checks also passed. A local full TypeScript run
could not resolve unrelated mobile/PGlite packages in the shared dependency tree;
new/owned paths have no reported TypeScript errors. Required clean CI remains the
merge gate.

## Recovery and conflict policy

Recovery continues through the existing coordinator, source/branch guards,
transactional journal, receipt verification and staged snapshots. These changes
do not clear queues, adopt unknown financial facts, advance cursors without proof,
or choose a financial winner from device timestamps. Actual conflicting closings
still require the authorized review path. A generic count mismatch or stock/item
failure must not display a shift comparison form.

The audit found matching scoped counts across 70 tables (32 populated, 38 empty).
That establishes count equality at the audit time only. It does not prove every
row's contents or exercise every business workflow. Membership remains on hold.

## Financial behavior and remaining protocol work

Native refunds require a Main-issued token bound to the current operator,
registered branch, exact saved sale, amount and stable refund ID. Main verifies
local approval credentials/policy or verifies central identity and approval
itself. The refund transaction repeats the relevant checks; successful receipt
replay does not repeat stock or payments. Direct authority does not add a PIN
or an override reason. Hosted approval does not create a duplicate local audit
attributed to the cashier, and its native wrapper cannot outlive the verified
hosted grant. PINs and person-session credentials are not retained in the grant
map or persisted in the journal.

Transfer approval, dispatch, receipt and verification keep their existing
central authority. The new Main handoff runs the existing final-upload barrier
before the central action, checking branch permission and stable local transfer
identity/version. Offline or unacknowledged handoff keeps the local draft.

**Remaining code/protocol work:** the current grouped refund protocol accepts a
central signed approval, not an offline manager PIN audit as durable approval.
Unsupported grouped offline PIN refunds are refused before local commit.
Approved grouped refunds whose temporary hosted upload proof expires or is lost
on restart still need a reviewed durable approval/renewal protocol. This patch
does not add that authority contract or claim automatic recovery for it. Existing
committed work remains pending; no proof or acknowledgement is fabricated.

## Acceptance and release boundary

No live business transaction, disconnected/restart acceptance, full two-till
financial smoke test, database migration or new installer release is recorded by
the focused results above. Exact PR checks and merge results must be recorded
separately. The installed beta.11 does not acquire native fixes merely because a
PR is merged; paired installer publication requires a fresh owner request.

At source validation, PR #474 is merged as `656c395a`, and PR #475 is merged as
`b27e6316`; both passed their required checks. PR #476's corrected head is
`dc7a8e66`. See the linked PR lifecycle for later CI/merge results rather than
inferring installed acceptance from this snapshot.
