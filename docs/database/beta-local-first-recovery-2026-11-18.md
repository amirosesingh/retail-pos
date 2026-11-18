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
After the financial and CI-contract fixes, all 29 affected suites passed together:
610 tests. The final two fixture corrections preserve awaited refund ordering and
central request/legacy-child denial checks. Scoped lint and diff checks also passed. A local full TypeScript run
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

## Financial behavior and durable approval follow-up

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

The follow-up requested as "Complete it" adds the missing durable approval
contract to both grouped refunds and FIN62 financial history. The two cases are:

| Case | Source behavior |
| --- | --- |
| A manager approves while the cashier is offline | Main verifies the synced approver PIN and existing branch rules, then saves a separately signed approval companion in the refund transaction. The manager does not need to log into this PC. The original financial author remains the cashier; Main does not create a manager signature. |
| The process restarts or the short-lived approval handle expires after commit | The sender reads committed approval evidence from the original local operation receipt. Its exact-operation proof survives normal handle expiry. Current author, reviewer, manager, method, amount, scope and policy checks still apply before first cloud business acceptance. |

An unused admission handle still expires before commit. PINs, PIN hashes,
session proofs and reusable hosted bearer grants are not saved in the companion.
Hosted approval uses the existing authenticated verifier to issue a purpose-bound
certificate under the existing server secret. Original signed refund/event bytes,
financial sequences and predecessor hashes are unchanged. Reuse the existing
local receipt storage, journal, uploader and coordinator; there is no second queue.

Settings continue to decide whether another approval is required: branch Refund
approver rules override global rules; the existing fallback Refund PIN setting
applies when no explicit rule exists. "No authorisation" retains ordinary refund
permission but adds no manager PIN. Offline approval and central-only refund
settings remain effective. Existing current named/routed request approval rules
are preserved rather than replaced by the offline PIN rule.

For an older committed refund without accepted durable evidence, the receipt
screen offers "Finish refund synchronization" through the existing approval
dialog. This attaches fresh approval to the exact saved operation; it never
reruns the refund or stock movement. A different authorized reviewer is attributed
separately from the original financial author. Legacy FIN62 events that never
stored their custom refund key use an explicit `financial-operation:<operationId>`
review reference and the source verified now. This reference does not reconstruct
an unknown key or claim that the old event originally signed the database GUID.
Ambiguous, missing, foreign-source or revoked evidence remains held.

Lost acknowledgements retain the existing exact-acceptance checks. The new
service-only `pos_sync_read_financial_event_receipt` RPC returns only the exact
stored financial metadata receipt after scope/raw-byte/proof checks. Its
`businessUploaded: false` is not business or stock acceptance. Final financial
projection validates new refund approval independently and binds it to the exact
signed after-fact; canonical unchanged refunded facts do not require a second
financial effect or a new transient grant.

For a sale created and refunded offline before its first upload, the separately
signed companion also witnesses the original local sale's creation date. The
financial sender can validate current refund-age policy without waiting for a
public sale row that financial metadata must precede. Existing central sales
must match that normalized date; a new final projection must match it as well.
This date establishes refund eligibility alongside the signed monetary facts;
it does not choose a financial winner or manufacture a central sale. Hosted
certificate issuance and grouped refunds retain their canonical-sale checks.

The additive hosted migration is
`supabase/migrations/20261117233612_native_refund_exact_financial_receipt_probe.sql`,
also included verbatim in the canonical fresh schema. It adds one read-only RPC,
no tables or business-data rewrites. It has not been applied to any hosted project
in this implementation batch. No new local DDL is introduced; durable evidence
uses the existing beta refund-storage columns. Older schemas without optional
refund storage keep ordinary financial history working; protected refund writes
must not bypass missing storage. Database/package consistency checks remain in
place; applying a migration is separate from generating its source file.

Follow-up verification: **431 tests across 28 affected suites passed together**,
including approval admission/evidence/recovery, the actual recovery component,
IPC close/drain behavior, hosted issuance and current policy, grouped replay,
financial metadata/projection, schema parity and existing write routing. The
existing event/close lifecycle suite adds 11 passing checks. The isolated
PostgreSQL receipt-probe suite contributes 14 of the 418 tests, including reapply,
service-only grants, exact prior receipt and safe creation without optional FIN62
tables. Scoped ESLint, native syntax, registry/install-order/package consistency
and diff checks passed. Agents independently reviewed native, hosted, transport
and UI changes, including the final signed-date exception.

The new four-case offline-first fixture runs the actual worker, cloud client,
endpoint, approval helper and Ed25519 verifier, with explicit isolated SQL RPC
state fixtures. It proves metadata-before-business ordering, same-batch replay
after a lost business reply and later manager revocation, refund age limits and
projected-date tamper refusal. It is not a hosted database test.

The existing opt-in disposable Windows LocalDB fixture passed eight test groups:
six existing protected-financial groups and two grouped-refund groups. The latter
uses a real bcrypt PIN from the synced roster and actual approval/receipt/journal
SQL transactions, then restarts SQL and recreates process state before retrying.
It verifies one stock return; the manager never signs into or enrolls on the
till. These random owned databases were cleaned up. No installed operator
database, live Supabase project or saved device setup was used. A local full
TypeScript run still lacks unrelated shared mobile/PGlite dependencies; no
changed runtime/client path reported a TypeScript diagnostic. Clean CI remains
the merge gate.

The first full CI run at `84e4a388` exposed four compatibility failures outside
the initial refund slice. Corrected an extension-ambiguous rules import, separated
pure transport schemas and exact financial comparison from native persistence,
and taught the schema generator to assemble the new probe deterministically.
The comparison implementation is unchanged and shared by native and hosted
callers. All four failed fixtures now pass in the 431-test combined run, including
actual Workerd execution; the generator fixture also verifies 19 isolated
PostgreSQL graph/authority scenarios. No test, audit or authorization guard was
waived. The compatibility commit still needs its own clean CI result.

At `865a1472`, full application/permission tests and account, database upgrade,
shift, transfer, stock-request and history checks pass. Its isolated notification
generator fixture needed the new migration added to its explicit file-copy
list. After that fixture-only correction, all 23 notification upgrade scenarios
pass; application notification behavior and permissions are unchanged. Later
checks still require the corrected exact head's CI result.

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

PR #476 at that corrected head passes application, SQL/upgrade/transfer/history,
lint, TypeScript and build checks. Its dependency-audit stage is blocked by
[GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf): the
currently published latest `picomatch` is 4.0.7, and the high advisory lists no
patched version. The upstream review on 17 November changed the audit result
without a manifest or lockfile change in these POS fixes. Keep this check and
the passing-CI merge gate intact. No package changes or forced toolchain
downgrades were made. PR #477 records the financial slice and its final CI.
