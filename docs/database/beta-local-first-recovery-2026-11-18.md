# Beta local writes, startup recovery and idle synchronization

This change follows the 18 November read-only audit of installed
1.4.84-beta.11. The initial source batch excluded hosted writes; the separately
authorized Beta migration and acceptance follow-up is recorded below.
Production, installed profiles and saved operator local transactions remain
outside the test targets.

Latest reviewed runtime head `9e458546` passes 7,730 automatic application tests
(11 existing skips), all required SQL/upgrade/permission stages, lint,
TypeScript/build, Android compilation and the unpublished iPhone build. The
FIN62 SPLIT/offline-PIN, grouped CASH/offline-PIN and grouped CARD/hosted-approval
two-till slices pass. Their exact expiry, replay, recovery and handback evidence
is recorded separately below. This is not an installed-UI or all-workflow
certificate.

Only the required dependency audit remains red at that head. At 08:48 UTC on
18 November the [official registry](https://registry.npmjs.org/picomatch) still
reports 4.0.7, the [advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)
lists no patched release, and [upstream PR 269](https://github.com/micromatch/picomatch/pull/269)
is open/unmerged. No audit waiver, forced downgrade or behavior-changing fork
was introduced. Keep merge and publication blocked until required checks pass.

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

## Owner-authorized hosted Beta follow-up

The next owner request explicitly authorizes the Beta migration and two-till
acceptance, with merge/publication conditional on all checks passing. The lucky
connector and an independent agent verified Retail POS Beta project
`irjkmhgrjgcaoixcixut`, PostgreSQL system identifier `7703759698107299042`.
Production and saved operator local data remain excluded.

Applied only the guarded read-receipt migration on that target. Hosted ledger
`20261118053019 / native_refund_exact_financial_receipt_probe` corresponds to
source `20261117233612_native_refund_exact_financial_receipt_probe.sql` (normalized
LF SHA-256 `1d05d5b69057d7a6eba46589787061e377a8b1b16a001a90790403ddb585ad5d`).
An exact-target/prerequisite guard and the function/grant postflight ran in the
same atomic DO statement. Independent read-back confirms function source MD5
`939a54a94ceb0498f57493574ac903bf`, owner postgres, SECURITY DEFINER,
`search_path=pg_catalog`, service-role EXECUTE only, and no PUBLIC/anon/authenticated
EXECUTE. Existing business counts remain nine sales, eleven items and zero
financial-history nodes. No existing record or local database was changed.

The current security advisor output does not mention the new function; existing
project findings are outside this narrow migration and no grants were widened
to suppress them. Fresh hosted two-till fixtures are being prepared against the
reviewed current source using new marked Beta records and disposable LocalDB
instances. No hosted business smoke result or installer publication is claimed
at this checkpoint. The dependency audit still has no published picomatch fix;
the reviewed upstream candidate changes supported matching behavior and is not
silently substituted into the release toolchain.

## Hosted FIN62 split-sale and offline PIN refund acceptance

The 18 November hosted FIN62 drill passed on Retail POS Beta
`irjkmhgrjgcaoixcixut`, system identifier `7703759698107299042`. It used two
disposable Windows LocalDBs through ODBC 18 and the current isolated HTTPS relay.
Production, installed operator databases and saved application setup were excluded.

This result combines relay build `9a7e36d032c062f7db28bc764b7fd785e117051e`, the
reviewed native working-tree corrections below and the separately applied Beta
SQL changes. It does not certify the unmodified relay-base commit as the final
installer. Native SHA-256 fingerprints at the successful resume were:

| Native source | SHA-256 |
| --- | --- |
| `electron/sync/change-reader.cjs` | `4af64c41827d08e56b2bcf67c4d24b1c7f65718699e1518a2080c542822d09fc` |
| `electron/sync/push-worker.cjs` | `e7c70af0e8214a4d179fed3ac30b2cd0e090b410696500efffec78487fd377e2` |
| `electron/sync/grouped-refund-native.cjs` | `04d8e1e840ae89977c4b06e83b9f547845667fdc1723acb2df13169b3244d37a` |

The first hosted attempt exposed a valid fact rejected under `en_US.UTF-8`:
linguistic ordering put `paymentsJson` before `paymentType`, while the strict
field list used byte order. Source migration
`20261118060529_deterministic_financial_fact_key_order.sql` was applied as hosted
ledger `20261118061241 / deterministic_financial_fact_key_order`. The exact-source
guard changes only this key ordering to `COLLATE "C"`; private execution,
invoker/strict/immutable behavior, owner and search path remain unchanged.
Read-back source MD5 is `49814368b1669fc9d9943aca23eb5ce1`. No financial rows or
immutable contract pins were rewritten. The isolated ICU English database test
reproduces the original refusal and verifies the correction, malformed-input
denials, unchanged permissions and idempotent application. PostgreSQL documents
the distinction between linguistic and [byte-order collations](https://www.postgresql.org/docs/current/collation.html).

That failed attempt also exposed a financial stock movement reaching generic
upload before its owning financial aggregate was accepted. The corrected native
barrier keeps dependent journal and Change Tracking effects with their owning
financial delivery. The earlier synthetic hosted OPEN and its product at stock
22 remain as diagnostic evidence; they were not reset or repaired to conceal the
failure. Its first disposable local databases had already been cleaned up.
Subsequent interrupted fixtures retained their original databases and DPAPI key
material until verified completion. Original failed-attempt artifacts were archived
before reusing the same synthetic staff and branch with fresh product/terminal IDs.

The successful retry used branch `codex-beta477-bc4887dc-financial`, sale
`67010a0b-5ee5-4b03-bd75-8662cc1ab3cb` and product
`8ea33f97-b4a1-4502-8e9c-9a250c797deb`. The actual named cashier was verified
through `current_app_user`; the existing author enrollment and financial
capability admission remained active. A two-unit sale at 7.50 used two real tender
rows, cash 7.50 and card 7.50, total 15.00. The native runtime saved its OPEN, SALE
and manager-PIN-approved REFUND while the fixture network was unavailable. The PIN
was checked against the synced staff roster; the manager never signed in or owned
the cashier's financial signature. Independent hosted read-back found zero manager
author keys.

Before upload, till A held one refunded sale, one item with refunded quantity two,
two tenders, stock 20, one local refund stock movement, two financial events and
twelve pending journal rows. Till B was empty. The committed companion survived
the real original two-minute admission window, a connection reopen and subsequent
fresh Node processes. SALE and REFUND metadata were accepted before business
projection; each metadata receipt still reported `businessUploaded=false`.

The fixture deliberately discarded the first accepted business response. At that
interruption, the cloud contained the latest refunded sale and the sale movement,
with stock 18; the original refund delivery remained pending. No new sale/refund
was generated to finish it. The next actual restart exposed an uppercase SQL UUID
in the financial-route wrapper being compared against the original lowercase
signed operation. The focused regression reproduced this hold. Normalizing only
the caller's SQL UUID with `recordId()` fixed it without modifying signed JSON,
proofs, scope or the wrong-operation denial.

The final resume stopped and restarted only the owned `CodexProtocol_*` SQL Server
process, verified the same physical database GUID
`4b00a576-a124-4d43-99b7-4a419962cab5`, reopened the same DPAPI signing material and
uploaded only the original remaining queue. Refund operation
`793631d7-7969-4f57-8043-a9d35afbffcf` retained raw payload SHA-256
`cde376a6aeeffdba99d8d96ce7257a3567d9bc81868c76ee6db7f9bc4f8f40d4`.
Both original local tills then downloaded canonical rows and independently read:

| Final fact | Till A | Till B | Independent hosted read-back |
| --- | --- | --- | --- |
| Sale / refunded item quantity | one / two | one / two | one / two |
| Cash / card tender | 7.50 / 7.50 | 7.50 / 7.50 | 7.50 / 7.50 |
| Branch stock | 20 | 20 | 20 |
| Sale / refund stock movements | one -2 / one +2 | one -2 / one +2 | one -2 / one +2 |
| Stock movement net | zero | zero | zero |

The original queue drained only after actual business receipts. Real hosted probe
checks returned the exact existing six-field metadata receipt, `null` for a
structurally scoped absent operation, and denied altered raw bytes, a forged prior
proof and a non-service claim. The absent probe did not sign or register a new
event. Raw-byte tampering was also denied through the actual relay verifier.
The deliberately lost response and intervening hold remain recorded as
interruptions alongside the final PASS. Successful cleanup removed only the two
owned local fixtures and their temporary keys; hosted dummy transactions remain.

The UUID correction passed 52 focused native/transport/hosted tests. The locale
slice passed 30 SQL/refund tests, 31 canonical/generator tests and 23 isolated
notification upgrade scenarios. These checks and this hosted native-class drill
do not replace installed Electron UI acceptance, other POS workflow acceptance,
or the exact-head CI, merge and beta publication gates.

## Hosted grouped CASH, expired PIN proof and archived recovery acceptance

The grouped two-till drill passed on 18 November against Retail POS Beta
`irjkmhgrjgcaoixcixut`, using only marked branch
`codex-beta477-bc4887dc-grouped`, the isolated loopback relay and two disposable
ODBC LocalDBs. The successful native runtime was commit
`24bde46d1ec66f5344cfc39c469f8af369301b28`. The compiled Worker entry SHA-256 was
`d5b21a30f216625b9a3f897739a55ad840657b4c42f85f00dd138380b3ecfae5`;
the ignored build proof records its original relay base, reviewed source-file
hashes and the later native runtime hashes separately. This local relay rebuild
retained existing output directories to preserve its running credential-owning
process; released artifacts still require the ordinary clean build.

The first synthetic sale and refund remained accepted at sequences 1 and 2.
Their data and immutable archives were preserved when a fixture-only outage
window allowed an internal acknowledgement retry. The follow-up used two new
synthetic terminal registrations and a new ordinary OPEN shift in the same
branch. The normal shift publisher appended sequence 3. Its existing
SHA-derived PostgreSQL UUID exposed an overly strict Worker publication-ID
validator; the transport correction preserved that original identifier. Native
handoff then exposed an already-bootstrapped refunded receipt being compared
with its original cash birth. The reviewed recovery correction requires the
same pinned, hash-verified later receipt graph, exact current registered rows,
unchanged birth facts and the existing pending-work guards. The original rows
and cursor were not reset to pass the drill. Mixed correction kinds on one
receipt remain a conservative review boundary.

The successful new sale was `81ac2570-f634-4389-bc20-6d944d336246`, cash operation
`f9e34f43-192c-4bed-94f4-5d1d63f98e9c`, accepted at sequence 4. Its 7.50 CASH
tender, item, sale movement and five original journal rows survived an offline
commit and SQL connection/native-service reconstruction before upload. Both
tills and the independent hosted read-back then agreed on stock 19.

The cashier approved refund `6cbe8cfc-71a6-492a-8003-c8a11111a8d9` with the
separately synced manager PIN while the relay was unavailable. The manager
never signed in or acquired a financial author key. The original immutable
refund and signed durable approval survived SQL connection reopen, discarded
approval-service memory and the real two-minute admission expiry. Omitting its
companion was denied before the financial writer. The fixture then consumed
and deliberately discarded one real APPLIED response. The original four local
refund journal rows and absent local acceptance were retained, while the cloud
already held the refund exactly once.

A genuinely fresh Node process reopened the same physical database GUIDs,
`ae1099a6-c2a2-4cbe-b945-11863236a4ae` and
`7b1ca085-38e1-45d2-a3a1-f12516fb229c`, with the same DPAPI key files. It uploaded
only that original pending refund and obtained the identical sequence-5 receipt;
it did not create another sale, refund or approval. Raw signed bytes remained
unchanged, the four journals were acknowledged, and no bearer approval grant
was uploaded. Current refund movement
`8206c64b-86f4-4e4f-167c-caaf726ce3d2` had one +1 effect. Both tills and hosted
stock converged to 20; the older fixture's separate refund remained intact.

Till B retained its real sequence-4 cursor. After both new recovery pins proved
sequence 5, the guarded Beta-only retirement advanced the replay floor to 5 and
removed only replay groups, retaining two cash and three financial archives,
including the OPEN shift. The actual retained cursor received
`SNAPSHOT_REQUIRED / REPLAY_EXPIRED`. Existing HTTPS cash, financial and stock
pages recovered B to 5; another replay preserved the same stock and ledger.
After the owner sealed that exact epoch at 5, both actual native handbacks
returned at 5 with their grouped write fences removed and the original
cash/refund queues drained. Successful cleanup removed only the two owned
local fixtures and their temporary keys. Hosted dummy transactions remain.

This is hosted native-class/ODBC acceptance with fresh-process proof replay and
SQL connection reconstruction. Installed Electron UI acceptance, the separate
CARD/hosted-certificate and remaining POS workflow drills, clean CI, dependency
audit and publication are separate gates; this result does not assert that they
have completed.

## Hosted CARD and five-minute certificate recovery acceptance

The separate CARD two-till drill passed on Retail POS Beta on 18 November,
using branch `codex-beta477-bc4887dc-destination`, two uniquely owned ODBC
LocalDBs and the same isolated relay. Runtime source was
`9e4585462c5f3991258e5460c616e72b05d8525f`; the rebuilt Worker entry SHA-256 was
`553083fa6fa747908b39c35cfe690938a75379c4b48be127071bc8e655e1b319`.
The build proof retains the earlier compiled entry and source-base fingerprints.
Production and installed operator databases were excluded.

An initial test input copied the CASH tender shape without the installed POS's
per-tender attempt key, reference, cashier name and bill/capture metadata. The
existing native converter correctly selected its legacy path. That synthetic
local transaction, its database and DPAPI files were retained without editing
the saved tender or forcing a financial acknowledgement. The corrected test
derives its tender rows from the actual private `salePaymentRows` and
`stableChildId` functions in `src/core/api/pos-db.ts`. Independent request-free
checks exercised the actual native converter and rejected missing attempt keys
or bill metadata before the fresh capture.

The fresh test used a new terminal pair and ordinary OPEN shift in the same
branch. Its real CARD sale `d1ed6fe3-9ccc-4ae6-8733-3601941a37bf`, operation
`d6fb8483-d65b-473c-afa4-9ac6e58b66bb`, saved one 7.50 card tender and five signed
journal rows offline. The saved capture survived SQL connection/native-service
reconstruction, uploaded at sequence 2, replayed the same receipt and reached
both tills with stock 19. No original failed-fixture financial rows were reset.

Real Main authorization then exposed a caller-policy mismatch: adoption accepted
the authorized staff Auth session, but the durable receipt issuer unnecessarily
required a cashier PIN session. The reviewed correction uses the same
unbound-cashier rejection policy as the existing grouped uploader, retaining
terminal binding, current staff permissions and machine-account denials. Seventy
focused checks included the real caller implementation and negative cases.
Actual post-build Main responses were HTTP 200 with `ok=true`,
`required=true`, a live verified grant and the operation-bound receipt present.
Only then did the normal Main admission commit the original unsaved refund
`a0e2bffb-f3aa-4a3b-890b-106c50183ad0`.

The durable companion survived reconstruction of the SQL connection and native
services. Omitting it was denied before the writer. The test waited more than
310 real seconds, with no process-clock override, until the original five-minute
bearer grant had expired. It then discarded one actual APPLIED response and
verified that local acceptance was still absent and all four original refund
journals remained pending while the hosted refund was already applied once.

A genuinely fresh Node process reopened the same database GUIDs
`65d9fde7-c15b-4d20-96d8-ea83ab2b09cc` and
`e60a5d2a-d614-4baa-aa80-fdb7b1c7699d` and the same DPAPI files. It verified the
original signed-evidence hash and replayed only that pending refund, without
renewing its approval or saving another refund. The exact sequence-3 receipt
acknowledged the four journals. No bearer approval grant was uploaded, the
manager never signed in or acquired an author key, and refund movement
`527a4bbf-7a9b-ddb9-9667-35ff5c1e7141` had one +1 effect. Both tills and the
independent hosted read-back agreed on stock 20.

Till B retained its actual sequence-2 cursor. After both new recovery pins
protected 3, guarded retirement moved the replay floor to 3 and retained one
cash and two financial archives, including the OPEN shift. The real cursor
received `SNAPSHOT_REQUIRED / REPLAY_EXPIRED`; existing HTTPS cash, financial and
stock pages recovered it to 3. Another replay preserved stock and the ledger.
After the owner sealed that exact epoch at 3, both native handbacks returned at
3, their grouped fences were removed, and the original cash/refund queues were
drained. Cleanup removed only the two successful owned local fixtures and their
temporary keys. The earlier malformed test fixture and hosted dummy transactions
remain preserved.

This verifies the hosted native-class CARD/certificate, expiry, fresh-process
replay and cursor-recovery paths. Installed Electron UI, remaining POS workflow
acceptance, clean CI, dependency audit, merge and beta publication remain separate
gates.

## Hosted stock, transfer and central booking smoke — 18 November

This separate functional run finished on Retail POS Beta only, project
`irjkmhgrjgcaoixcixut`, system identifier `7703759698107299042`, with the reviewed
`beta477-bc4887dc` manifest and source
`9e4585462c5f3991258e5460c616e72b05d8525f`. The isolated HTTPS relay used the
verified Worker entry
`553083fa6fa747908b39c35cfe690938a75379c4b48be127071bc8e655e1b319`.
The adapter used the current synthetic named staff and terminal proofs after
both grouped two-till tests had completed their seals and handbacks. It accessed
the normal authenticated terminal relay and booking RPCs; it used no server key,
operator local database, production target or fixture reset.

The stock/transfer phase passed. Two new products received consecutive global
SKUs, `SKU-000265` and `SKU-000266`, in different private clusters. A source price
edit preserved quantity. Recorded adjustments changed source stock from 4 to 6
and, after transfer, destination stock from 2 to 0. A cashier could not approve
their transfer; the independent manager could. Wrong-branch dispatch and receipt
were refused. Dispatch and its exact replay deducted source stock once. Arrival
did not post destination stock before physical verification. Verification posted
two units, and another verification received the explicit already-posted refusal.
The destination retained the received product and its original SKU at zero stock.
Final product stock was source 4, destination 0; the transfer remained completed
and posted with one quantity-2 line.

The first booking run stopped at an incorrect test assertion after saving the
two new bookings and the source's cash-10 partial payment. The product correctly
refused a card-16 overpayment against outstanding 15. Its existing RPC error is
HTTP 400, SQLSTATE `P0001`, with the message prefix `BOOKING_OVERPAYMENT:`. The
adapter had expected the domain label in the SQLSTATE field and rejected the
colon-bearing message. Read-only inspection confirmed one settled payment of
10, no negative-test payment and no handover sale. Only the test adapter changed:
it now requires that exact status, SQLSTATE and known outstanding-15 error, then
checks the unchanged ledger. No application or booking function was changed.

The explicit `--resume-booking` continuation verified the accepted product,
adjustment and posted-transfer identities before proceeding. It also verified
source cash 10/outstanding 15, destination paid 0, and no handover sale. It did
not recreate the earlier records or repeat their accepted writes. Card
overpayment again failed with the exact expected error and retained the cash-10
ledger. A destination card-7 partial succeeded; source access to that foreign
booking's balance/payment was refused. An unpaid handover of 14 rolled back
without a sale, sale item, sale tender or extra booking payment.

The final cash handover tendered 20 against the remaining 15. It saved booking
paid 25, a final booking payment of 15 and change 5, together with one service
sale, one product-less item and one sale tender. The sale total/paid and its
receipt tender are 25, matching the existing `collectBooking` and
`saleCommitRpcArgs` full-receipt contract; the separate booking ledger contains
the cash-10 deposit and cash-15 settlement. Exact replay returned the original
receipt, and a different second sale was refused. No stock movement was needed
for the service item.

| Accepted synthetic record | ID |
| --- | --- |
| Source product / destination product | `5bd5f2f6-bfe7-4086-965e-5736c51cb3a1` / `5de8352b-74a0-4b22-8c5f-78bdbe364e01` |
| Source adjustment / destination adjustment | `a5918ea9-fbcd-456f-bc6d-4c0b87a56455` / `dd1d588d-9a53-4aea-968f-0d9901545650` |
| Transfer / line | `a064d5f0-6969-4266-b6dc-b013e82503ea` / `0fa75c3d-b825-481e-ac80-6c3cfbf0717a` |
| Source booking / destination booking | `68253b86-e9e5-4a68-a664-81770d047cd5` / `6ef8cb38-beb8-4ae1-8b8e-d6a5c31c2dc9` |
| Booking cash-10 payment / cash-15 settlement | `f2af7392-ea09-4d42-8f83-e09e47d27674` / `b2d82930-a7f5-4b30-bc85-f473bce20462` |
| Destination booking card-7 payment | `2177453b-1de4-4b7b-8343-5f9c54eff03e` |
| Handover sale / item / sale tender | `2f9c9d4b-790e-40f4-8502-6d8c752ae312` / `98cb4320-1dba-4405-b9d0-10ce85dfd593` / `ac3ad691-37ab-4c77-86df-2fbbf4fa894f` |

Independent bounded hosted read-back at 09:00 UTC confirmed source booking
collected at 25/25, destination booking active at 7/40, source booking payments
exactly 10 and 15 with change 0 and 5, destination card payment 7, and exactly one
handover item and sale tender. The refused payment key and second-sale ID have
zero rows. The root coordinator's separate snapshot comparison found zero
missing or changed rows among the 20 retained original Beta sale/item records;
the three two-till fixture products remained at stock 20. Accepted dummy records
remain available for review.

This certifies the exercised hosted stock/transfer and central booking RPC
paths. This adapter did not exercise the installed Electron/Android UI, native
transfer draft upload barrier, disconnected booking handover or FIN62 native
booking handover. Grouped native booking retains its existing precommit hold;
central RPC success does not certify that native path or every POS workflow.
