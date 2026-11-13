## 10 November — receipt report tender amounts

Fix the beta receipt report crash when a synced tender carries its decimal
amount as text. Accept both database arrays and serialized payment arrays,
preserve tender details, and verify the displayed amounts for existing sales.
The regression tests reproduced the crash for both storage forms, then passed
with normalized amounts and a dash for cached amounts that cannot be read.

## 7 November — isolated authoritative cash sync bridge

Continue the owner's two-way plan from beta `94ac06b8`, with the private feed
and inbox preparation from PR #447 as a dependency. Prepare one synthetic
cash-checkout path that can call the existing canonical native aggregate writer
with verified branch and installation authority, record a payload-bound result
and publish a group of canonical post-write rows in the same transaction.
Preserve the existing writer's exact shift, receipt and inventory rules. The
staged cash event must carry any required saved facts and proof before it can
replace a legacy upload. A test adapter must use real domain routines and an
isolated PostgreSQL database. Keep the live relay and databases outside this
slice. If the existing writer's proof or scoped projection is unavailable,
record that prerequisite and retain the live route. A source revert removes
the preparation without touching installed data.

The focused PostgreSQL 18.6 fixture passed with the existing native aggregate,
stock delta and scope routines. The test covers a missing shift followed by
same-operation acceptance, replay without a duplicate stock movement, legacy
identity and unsupported-field rejection, and rollback on feed publication
failure. The bridge is owner-only and synthetic. It needs a full event
projection, verified installation generation and a fenced sender handoff
before an authorized relay can call it.

## 7 November — connect the isolated two-way synchronization pilot

The owner requested completing the sync and keeping the beta PR current as
each part is verified. Start at beta `a5bf2ebc`. Continue with the existing
Windows queue, HTTPS relay and web authentication. The installed route remains
active until a fenced handoff is verified. The first connected pilot is scoped
to a verified Windows Operations till and an ordinary cash checkout. Management
continues using the authorized multi-branch replica. Its permissions and the
web route stay in force.

Prepare exact cash checkout wire evidence under the existing checkout transaction,
a bounded grouped read through the existing HTTPS relay with an explicit server
pilot gate, and a native consumer that preserves a durable scoped position.
Verify actual accepted change groups and replay using disposable databases.
Snapshot work must read canonical scoped data and protect the pending sale and
open shift before any activation. Keep staging SQL outside deployed migrations
and leave the gate disabled without the exact isolated project and terminal
configuration. Required checks include another branch, an invalid terminal,
replayed operations, group rollback and the existing route when the gate is off.
No installed handoff or hosted database write is authorized by preparation.

Five focused LocalDB cases passed for the opt-in cash wire evidence, including
exact replay after restart, installation and database mismatch, and atomic
rollback. The legacy uploader remains active. The isolated cash bridge still
needs a verified relay generation and an exclusive legacy sender handoff before
any installed device can dispatch this evidence.

The same disposable Windows cash wire was accepted by the isolated PostgreSQL
checkout bridge, inbox and feed. Its missing shift deferred the operation, and
its exact replay caused one stock movement. The grouped settings relay and
snapshot gateway passed the targeted hosted-handler and PostgreSQL scope checks.
The server gate requires an exact configured pilot project and terminal. LocalDB
proved atomic row and cursor storage, pending-edit refusal and no echo. A real
PostgreSQL snapshot and committed settings group also applied on LocalDB while
leaving the open shift and pending journal intact. A retained divergent settings
row needs review before snapshot activation. The installed coordinator still
uses its existing entry points. Hosted relay activation, the financial sender
handoff and the remaining domain projections are pending.

Independent review caught snapshot races, empty manifests, a Change Tracking
cleanup race and intermediate settings publication. The native commit now
checks the position saved before fetch and rechecks capture retention after
the scan. Canonical settings writes publish one final row per transaction,
including a defaults insert followed by an update. Ten focused LocalDB cases
and the exact PostgreSQL-to-LocalDB handoff passed after these fixes.

The owner asked to complete the remaining work. Continue on PR #451 with the
required Worker check that failed to bundle the grouped relay. Use the plain
rules definition in the Worker and verify the existing exact financial
download and the grouped relay in focused checks. Exercise the grouped relay
and native reader together with disposable databases where available. Bind
the grouped checkpoint and its apply transaction to the actual SQL Server
database identity and test replacement under the same profile. Keep
the installed route, hosted database and pilot activation outside this batch.
Complete the already authorized same-store PIN badge wake through the
existing verified event path if its authorized read can be preserved.

The relay now imports the plain TypeScript rule definitions explicitly.
The previous ambiguous module name pulled the React provider and TanStack
virtual entries into isolated Worker bundles. All 23 focused tests across
the three affected Worker suites, grouped relay and scoped history passed.

The grouped checkpoint and its apply transaction now require the actual SQL
Server database GUID. Eleven disposable LocalDB cases passed, including a
copied checkpoint and a transaction routed to a different database under
the same profile. A restore that retains its GUID still needs generation
validation before installed activation.

The disposable gateway fixture passed a snapshot and a subsequent committed
settings group from PostgreSQL through the real relay handler to LocalDB,
with its open shift and pending journal intact. The fixture adapts the
HTTP and Data API boundaries in process. Hosted and installed acceptance
remain pending.

Android and iOS PIN activity bells now share the verified branch wake used by
open Approvals and Holds. A committed activity event wakes the existing
person-authorized read, and the existing polls continue. The three focused
receiver, approval refresh and notification persistence suites passed 43
tests. Windows still needs a scoped native download wake for its local badge.
Named cross-store and relay-only PIN delivery still need an authorized wake
path.

Strengthen the isolated ordinary cash receipt before connecting a sender.
Require the independently provisioned active installation generation and
database identity in the owner-only PostgreSQL fixture. Bind acceptance to
the original operation and exact checkout bytes. Verify wrong and stale
generations, payload drift and exact replay without a second inventory
effect. Existing routes remain in service until both legacy write paths
can be fenced and reconciled in the authoritative transaction.

Five focused LocalDB outbox cases passed. Both disposable PostgreSQL cash
fixtures passed with the bound receipt, including the exact checkout bytes
and digest produced by Windows. Missing enrollment, a stale generation,
the wrong database and altered bytes are refused. A wrong epoch cannot
record a waiting receipt. Exact replay returns the stored acceptance with
one stock movement.

Remaining integration needs one verified handoff covering the journal and
Change Tracking fallback writes, a canonical financial projection that can
be applied as one group on the receiving till, and authorized setup for two
distinct terminal enrollments. The current settings reader accepts settings
groups only. Cash evidence in the same stream would stop that cursor, so
do not enroll both publishers until the receiver supports the complete
financial group. Reconcile the pending sale and open shift on both sides
before allowing handback. The connected Supabase project is production-linked.

## 8 November — financial handoff and Windows approval follow-up

The owner requested finishing the outstanding sync work and updating PR #451.
Continue from PR head `d841938b` on beta base `a5bf2ebc`. Implement only
reviewable steps that preserve the existing checkout, journal, branch access
and SQL Server connection configuration. Verify ordinary cash handoff against
the actual legacy writers in disposable databases, and prepare a receiving
projection with exact scoped sale, line, tender and movement facts. A scoped
Windows approval wake must keep the current authorized local activity read and
avoid launching a full sync on each broadcast. Keep hosted SQL, live sender
activation and publication outside this batch pending the isolated target and
acceptance. Run only focused checks and record remaining gaps in the PR.
Prepare exact allowlist support for two Windows Operations test registrations
without accepting any additional tills or changing their branch authority.
Prepare a private cross-store wake for explicitly named staff on the existing
approval route. The topic carries an empty hint, checks the verified person's
identity and current rule, and reuses the authorized queue read. Keep the
publisher disabled without an exact project opt-in. Verify recipient isolation,
client publishing denial, and rejection after a rule or account is revoked.

The isolated ordinary cash fence passed concurrent legacy-first and cash-first
tests using the actual journal aggregate and Change Tracking batch RPCs, with
their compatible service-role overloads. Mixed overlap fails atomically and
unrelated writes still work. The prepared lock and reservations cover exact
ordinary checkout identities. Direct web writes, protected financial routes,
late corrections and sender handback still need their own verified boundary
before applying this preparation or switching either installed route.

The cash receiving fixture passed from a saved Windows checkout through the
canonical PostgreSQL commit to a second disposable LocalDB. Sale, line, tender,
movement and cursor committed together. Missing dependencies, pending work and
failed cursor writes retained local state. Replay did not deduct stock or echo
an upload. The receiving test uses a separate private cash projection; the
installed scheduler, authorized HTTPS cash transport and a unified snapshot
remain pending. The existing grouped settings tests passed all eleven cases.

The grouped relay now accepts either one exact legacy pilot terminal or a
configured pair in `POS_GROUPED_FEED_PILOT_TERMINAL_IDS`, with project,
registration, binding and branch verification for each. Mixed configuration
or a larger list is refused. The named staff wake prepares a private recipient
topic and a service-only hint using the committed route and current rule.
The Approvals page reuses its authorized queue refresh. The disposable
PostgreSQL policy fixture and 33 targeted application tests passed, along with
the three affected actual-Worker suites. The recipient badge, relay-only PIN
subscription credential and actual hosted Realtime acceptance remain pending.

The Windows PIN badge now uses the verified same-branch wake and a narrow
Main-process catch-up. It requires an enrolled Windows Operations terminal,
a PIN session bound to that terminal and branch, and the exact configured
Supabase project. It reads up to 50 recent authorized approval events and
commits only missing local rows under the existing sync lease. Fifty-three
focused application tests and five disposable LocalDB cases passed, covering
no upload echo, preservation of local clears, rollback, wake coalescing and
session invalidation. Installed Windows Realtime acceptance remains pending.

The owner clarified that `50C` came from speech recognition. Removed the
incident investigation from the active sync plan.

The owner confirmed that online sync must reuse the existing Database & Cloud
Connection fields for the central URL, publishable key and POS backend address.
The Windows worker reads the saved project from the existing credential store
and uses the existing backend setting. Use the same fields on the two test
tills when staging is available. Pilot enrollment remains server-side.

## 8 November — two-way store settings

The owner confirmed that a permitted edit for a particular store must reach
the cloud and then other eligible tills for that store. This applies to a
branch-authorized edit from a Management PC or the store's own Operations
till. Continue on PR #451 at `006a5505`. Reuse the existing authorized
settings save and pending-edit paths. Preserve Management replica read-only
behavior, Operations registration scope, settings conflict checks and the
existing connection fields. Connect the staged store-settings download only
through a verified pilot path that preserves pending local edits and cannot
conflict with legacy writers. Verify a same-store round trip, a different-store
refusal and no duplicate write. Keep hosted configuration and installation
outside the disposable fixture until the staging target is confirmed.
Confirm the cloud save response matches the selected store and the next
revision before replacing the editor's verified settings.
Show a scoped grouped-settings pilot result in the existing Database
connection screen when the coordinator reports it. Keep pilot status distinct
from ordinary sync progress and leave the existing connection controls in place.

The actual online rules handler routes Management and Operations edits through
the selected store's canonical save, preserving the person, registration,
permissions and expected revision. The editor accepts only a baseline for the
selected branch, and confirms the returned branch and next revision before
replacing its saved view. The disposable PostgreSQL canonical save produced one
group per accepted edit, and the receiving LocalDB consumed both through the
grouped relay. The fixture denied a stale retry, an unauthorized editor and a
foreign-store Operations edit.

The previous offline editor fallback tried to write an unsupported
`base_version` column and could fall through to a generic write without a
proven base. The editor now keeps the draft open and asks for a connection.
Existing pending records are preserved. A new offline edit needs a durable
original revision and the canonical upload path before enabling offline save.

The grouped settings coordinator pilot now resumes its durable cursor under
the existing lease, limits work per pass, and checks pause before commit. The
Database connection screen can display the pilot result for the current store.
All 119 focused application tests and 12 grouped LocalDB cases passed. The
installed scheduler and legacy write handoff remain pending.

The private two-field settings edit preparation uses the existing canonical
save and inbox. It checks the enrolled source and original person, binds the
operation to its expected revision and settings patch, and seals the committed
group to that operation. Disposable PostgreSQL passed exact replay, stale
review, authorization refusal and rollback if publication is missing or
changes in the same transaction. There is no active caller. Native offline
capture and authorized delivery still need integration.

## 8 November — beta sync release preparation

The owner asked to finish, test and release this sync beta. Continue at
`f0137f32` on beta base `a5bf2ebc`. Use only isolated data for financial and
settings acceptance. Connect the remaining settings path through the existing
verified coordinator and relay where an exact implementation can be tested.
Preserve the original revision, scoped installation and person authority,
durable retry, and the existing store settings and connection controls.
Complete the independent portions while the separate Supabase staging target
and HTTPS relay are pending. Before merging and publishing this sync beta,
verify the integrated application, both isolated tills and safe handback. The
current production-connected Supabase project retains its database approval
boundary.

On 9 November the owner confirmed completing the pending sync work, including
both store-settings directions, with agents and only relevant tests. Update
PR #451 as changes are verified. Merge and publish the beta after the complete
sync acceptance passes. Continue isolated verification while the separate
hosted target is pending.

Complete the installed settings path under one exact pilot enrollment and
the existing Windows sync lease. Preserve the online save and reuse the
existing fields. Verify mixed legacy pages, pending settings edits and safe
handback. For approvals, extend the badge to current named cross-store
recipients through the existing authorized read. Preserve polling while
testing a private short-lived wake for a verified relay-only PIN session.

The two-disposable-till settings fixture passed against the actual relay
handler and native PostgreSQL. A lost response after cloud commit retried the
same command, received the existing acceptance, and delivered one committed
group to the receiving LocalDB without disturbing the open shift or pending
journal. Four focused relay and Worker suites passed 11 tests, including
default-off authorization and refusal of mixed or inexact uploads.

The owner confirmed that no separate hosted staging project currently exists.
Keep fixture tests isolated. Add a relation inventory check to the existing
sync verifier so staging metadata can flag missing mappings and unclassified
relations before cutover. This check does not qualify a table's write paths.
The structural check still passes for the 70 existing mappings. The new
metadata comparison passed against disposable SQL Server and PostgreSQL,
including a missing mapped column, a new unclassified private relation and
refusal of incomplete SQL Server catalog permissions.

The first GitHub run found one legacy checkpoint call with an added null
argument. Restore the original call for every other table and keep the
transaction argument only on the fenced settings path.

The focused checkpoint suite passed all 30 tests after that correction. The
separate exact cash proof remains isolated. The signed financial header only
covers before/after sale facts and currently applies to protected shifts that
the ordinary cash bridge excludes. The cash outbox has immutable checkout
bytes but needs a verified original author bound to those bytes. Its group
also needs the common receiver and recovery snapshot before cash and settings
can publish into the same scope. Do not start a second financial sender or
attach a later uploader's identity to an older receipt.

The installed Windows settings path now opts in by exact staging enrollment.
The existing sync coordinator captures and uploads the two reviewed offline
fields and downloads canonical settings through its existing lease. Management
and Operations continue to use their authorized online rules save. The
settings and sync screens show queued, accepted, retry and review status.
An authorized settings conflict resolution workflow still needs an audited
decision before a stale command can be released from review.
The registration reassignment preflight now checks unresolved settings work
for the previous store and terminal even after pilot opt-out. A limited
legacy login can proceed when it proves no durable grouped settings fence.
Five disposable LocalDB groups and the focused activation checks passed.

The final settings checks covered the focused renderer, IPC, status, relay
and checkpoint suites, five disposable LocalDB outbox groups, and thirteen
grouped LocalDB cases. Mixed legacy pages retained unrelated work. Handback
held for pending settings, missing grouped coverage, or an inexact legacy
decimal. A safe handback preserved the pending sale, journal and open shift.
A newer pinned same-epoch settings snapshot recovered an expired feed when
the local journal and Change Tracking still proved the boundary. Unverified
Change Tracking and divergent retained rows continued to require review.

The approval bell now reads only current named cross-store assignments from
the existing authorized relay and shares the private wake with Approvals.
An enrolled PIN session without a machine bearer can obtain a short-lived
private Realtime wake tied to the verified person and branch. Existing
authorized polling remains in service. The disposable PostgreSQL fixture
passed recipient isolation, rollback, committed activity delivery and client
publish denial. The focused app suites passed. Hosted activation needs the
exact staging project, enrolled terminals and a server-side staging signing
key. The prepared policy is outside deployed migrations.

The required GitHub checks caught a source-level guard for the automatic
offline retry cadence. Keep the existing queued-core delay expression and
schedule another grouped settings page explicitly when one remains.

## 9 November — finish sync code while hosted acceptance is paused

The owner requested completing the pending sync code with agents and focused
tests on PR #451. Continue from `8106b17c`. Keep hosted testing, the beta merge,
and publication pending while only the production project is available.
Use disposable databases and existing operator fields. First complete the
audited stale settings decision, bind financial evidence to the originating
actor and exact committed checkout, and make the grouped receiver preserve
settings and financial transactions under a common scoped checkpoint. Verify
failure, retry, wrong-scope and pending-work boundaries. Review recovery and
table coverage against both installed schemas before enabling anything.

The original still-authorized settings operator can compare the exact saved
patch with the current canonical revision and record an immutable keep-central
decision. The original command and stale receipt survive. The decision allows
a separate new edit or verified handback and re-pair. Missing audit storage,
changed comparisons and revoked authorization hold the edit. Seven disposable
LocalDB checks and 62 focused application tests passed.

An originating cashier attestation binds the exact captured cash receipt bytes
to the operation, registration, database and epoch. The service-only writer
rechecks the active cashier and key in the apply transaction. A native
checkout passed through the actual relay to PostgreSQL, and an altered
signature was refused. The existing private cash overlap fixture still
passes. The local acceptance transaction saves the receipt and acknowledges
only its five frozen journal rows. It rolls both back on extra evidence,
source change or write failure. The shared settings and cash receiver has one durable mixed cursor.
It can recover a bounded snapshot of settings and archived ordinary cash
groups after feed retirement. The receiver verifies the source till's own
accepted operation without rewriting its business rows. Native rollback,
restart, wrong proof and refused downgrade were tested in LocalDB.

Installed mixed finance stays gated. The legacy journal and Change Tracking
paths and the old download must all honor the new route before cutover.
Existing overlap locks cover the two native upload RPC families, not all
direct hosted writers or later corrections. Windows and cloud refund paths
currently derive different stock movement IDs for the same logical return.
Reconcile those IDs and the exact product, store and delta before replay.
Tender corrections need a stable receipt, managed shifts need their existing
signed graph and closure fences, and stock transfers need the complete source
and destination effects. A drawer wake must never replay its hardware pulse.
The bounded snapshot covers settings and ordinary cash receipt rows, not
full stock balances, the remaining financial writers or larger paged recovery.

The owner asked to continue with the installed financial sender, exclusive
legacy handoff, refunds and remaining financial writers, and full recovery
including stock. Continue from `938f2b3f` on PR #451. Keep hosted testing,
the beta merge, and publication pending. Use agents and only focused local
tests. Verify that one committed financial operation has one sender and one
accepted result, that legacy fallback cannot repeat or swallow it, and that
stock recovery preserves current branch and pending local evidence.

The installed Windows sender is wired into the existing upload worker for
the supported single-item ordinary cash checkout. Its original journal and
Change Tracking entries stay pending until the exact central receipt is
verified. Unsupported checkouts and shared shifts use their existing routes.
The isolated mixed downloader consults archived row ownership before
skipping the initial receipt in a legacy page. It preserves unrelated rows
and waits for the grouped receipt before applying a later correction.

The default-off refund relay checks the current operator and the existing
approval rule against the locked sale basis. The prepared writer reconciles
historical refund movement identities, checks exact line preconditions and
returns the original receipt on retry. The Windows refund journal does not
yet capture enough preconditions to send this command after local commit.
Prepared tender and stock SQL verify exact operation and movement replays.
The paged recovery export stages ordinary cash receipts, store settings and
branch-owned stock under one pin. The local apply verifies product revisions
and keeps newer stock and pending changes safe.

Focused LocalDB tests passed for exact cash acknowledgement after a restart,
legacy overlap, refund replay, and rollback when a recovery pin would
overwrite newer stock. The local PostgreSQL and relay fixtures passed for
signed cash, paged recovery, refund approval and replay, duplicate movement
verification, and exact tender correction. The affected sync, receipt, and
approval Vitest suites also passed.

Before financial cutover, complete live stock delivery and verified
handback, publish and apply refund and correction groups, and bring managed
shifts, voids, other tenders, drawer and transfer actions, and direct
web and admin writers into the grouped protocol. Full financial recovery
and reconciliation of all installed data still depend on those writers.
Keep the prepared SQL outside deployed migrations and leave hosted testing,
the beta merge, and installer publication pending.

The owner requested the remaining sync code on PR #451, starting from
`03bba8e0`. Work in the beta PR branch. Use agents for live stock, the
Windows refund journal and sender, and grouped financial publication.
Verify the installed route switch and recovery against disposable databases.
Keep hosted testing, the beta merge, and release pending.

The extended pilot uses the same branch cursor for ordinary cash, live
branch-owned stock, and typed refund and tender correction groups. An
installed Windows till has to apply its verified extended snapshot before
the new sender owns a checkout. Handback stops new captures and drains
owned receipts before the owner seals the cloud branch's financial feed.
The till verifies that sealed prefix and clears the download fence
atomically while keeping the legacy cursor. Windows refunds retain the original signed command and exact
line preconditions in the existing local receipt and journal. Approval
grants are kept in memory, and a saved command that still needs approval
stays pending when that grant is unavailable.

The owner also requested repairs for failed PR checks. The local failures
included an unintended Worker framework import, stale refund/approval
fixtures, and the development interop allowlist. Android Gradle and iOS
CocoaPods downloads failed independently upstream, so native CI retries
those download steps without changing versions or publication settings.

Complete grouped contracts are still required for managed shifts, voids,
alternate tenders, drawer and transfer activity, product owner changes and
the remaining direct legacy and web writers. Full recovery of those
workflows and missing authoritative receipt parents remains pending.

The owner requested continuing those code items on PR #451 from `ee420c73`.
Use disposable tests. Keep hosted verification, beta merge and publication
pending. Work on protected shift and drawer groups, product ownership
transitions and transfer receipts, and authoritative receipt-parent recovery
alongside the canonical checkout and administrative writer paths.

Disposable PostgreSQL and SQL Server LocalDB checks passed for grouped
protected closes and recounts, drawer request and result audits, stock
ownership moves and deletes, refund and tender receipt recovery, and
restart-safe paged recovery. The old stock owner receives only a retirement
marker. A retained historical product can still anchor an archived receipt.
Missing authoritative records or pending local edits hold the affected scope
without advancing the cursor. Canceling an unfinished register bill continues
to use the existing cart path.

Prepared SQL keeps the business tables and connection settings in place.
Before enabling a till, verify restorable backups, reconcile existing rows
and totals by store, and account for pending uploads and open shifts at the
same boundary. Older corrections without archived evidence require review.
No hosted schema or data was changed. Grouped shift opening, alternate
tender checkout, paired stock transfers, remaining direct writers, and
recovery for those paths still require work.

The owner authorized setup and two-till testing on 9 November in the new
Retail POS Beta Supabase project in luckycharms Org. Use a dedicated HTTPS
relay and separate Windows SQL Server databases, with synthetic branches,
devices, and users. Verify each target before applying schema or enabling the
pilot. Test restart and lost-response replay, scope isolation, existing-data
reconciliation, pending work, recovery and handback through the existing POS
entry points. Continue remaining code and focused tests on PR #451. Production,
existing shared deployments, beta merge and installer publication remain
outside this batch.

Grouped shift openings now use the same scoped shift feed as closings. During
recovery, the Windows worker merges the staged receipt and financial streams
in commit order, so a missing opening can be restored before its dependent
sale. An exact opening already present on a till leaves newer shift state
in place. A divergent opening holds for review. The focused PostgreSQL and
SQL Server fixtures passed, including a missing shift before its archived
cash receipt and a retained product after an ownership move.

Grouped transfer dispatch publishes the verified transfer, request and lines
to eligible participants. The sender's stock and audit stay in its own
group. The archive and native cursor preserve atomic apply. The focused
PostgreSQL and LocalDB tests passed, including cross-branch rejection,
pending local stock and replay after the live feed expired. Split warehouse
stock, foreign-owned stock, and receive and verify actions still use their
existing routes. A newer local document without exact dispatch history
holds for review. Card and split tenders still need a compatible receipt
contract that retains their reconciliation metadata.

The owner expanded beta acceptance to a whole-POS smoke run. Verify actual
product setup and stock, checkout, exchanges, refunds, bookings, shifts,
approvals and transfer activity alongside the two-till sync, offline recovery
and handback. Use synthetic records and payment sandbox or manual test
tenders. A settings-only check is outside the requested acceptance. Record
hosted beta and disposable fixture results separately.

The isolated catalogue smoke found that a branch-scoped upsert could match
and modify another branch's product by ID. Repair the existing-row authority
check in the native write transaction. Verify that a denied write leaves the
product and pending journal intact, while authorized creation and editing
still work.

The staging base installer is verified in Retail POS Beta. The hosted
schema contains 79 public tables with RLS on each and started with no
business data or terminal records. The isolated HTTPS relay has a verified
staging service connection. Full grouped pilot installation and the
whole-POS hosted acceptance are still in progress.

The booking smoke found a cross-branch defect in the web booking balance
and collection functions. Add existing booking-scope checks to those
entry points and verify denial without a tender or balance disclosure.
Keep the separate booking payment, checkout, and link finalization gap
tracked independently.

The actual beta Worker returned grouped-feed unavailable even with the two
eligible tills and correct project. The generated Nitro adapter supplies the
Cloudflare bindings through its runtime environment and delegates only the
request to the inner entry. Carry that trusted environment into the existing
server configuration resolver, then verify the real HTTPS Worker responds
with scoped results and denies the wrong proof.

The full staged pilot schema and exact test cohorts are installed. The
Worker now rejects upstream redirects using manual mode so Workerd can
reach the private recovery RPC without forwarding a service credential.
Hosted recovery begin and stock paging pass over HTTPS. The deferred stock
guard checks its private archive under its owner with no new public or
service-role schema grant. The scoped transfer receipt route and the
existing approval rule were verified in Retail POS Beta.

Hosted POS smoke passed product creation and price edit, stock adjustment
with audit, independently approved transfer dispatch, receipt and
verification, checkout and exchange with exact replays, and booking
collection and scope. Source and destination stock changed once. Native
fixtures separately passed held-bill sync, signed refund capture and shift
causal replay. Booking guard fixtures also denied relabeled native
collection while preserving legitimate creation, deposits and receipt
links. Full signed financial two-till acceptance, long-offline cutover and
handback, and grouped support for remaining tenders and writers still
require verification or implementation.

The first hosted cutover attempt verified terminal claims, scoped catalogue,
legacy cursors and wrong-proof refusal, then held an earlier stock pin. The
initial recovery request now pins the current head. A nonzero resume still
reuses a covering pin, and an unchanged initial retry reuses its pin. The
focused PostgreSQL gateway fixture passed, and the exact fix was applied to
Retail POS Beta. Automatic review blocked the hosted two-till rerun, citing
the earlier hosted testing hold.

The owner explicitly approved resuming the hosted two-till test on Retail
POS Beta only. Use a separate synthetic cash scope and disposable SQL
Server databases for the signed sale and receive drill. Retain the existing
synthetic transfer and its recovery hold as a separate negative case.
The hosted migration ledger confirms the recovery-pin repair and RLS on all
79 public POS tables and 18 grouped-feed tables. The separate cash drill
requires the isolated HTTPS relay to be running with a valid Beta key.

The staged transfer smoke also left a completed transfer at revision 5
beside its archived dispatch at revision 3. Preserve the current local
record. A later recovery may advance only with an exact scoped descendant
proof bound to the recovery pin. The current dispatch envelope carries the
original receipt, which by itself cannot prove the newer lifecycle state.
The focused PostgreSQL and LocalDB replay passed. It exercised the review
hold after a tentative stock write and verified rollback of the entire
transaction, preserving the completed transfer, stock, audit, pending
journal and checkpoint.

The follow-up beta batch makes scoped grouped download holds visible in
Data & Sync and system health even with an empty upload queue. Native
booking collection and cancellation check the observed booking revision
inside the SQL Server aggregate. A stale edit rolls back and cannot fall
back to independent cloud writes. Transfer arrival and
verification refresh the authorized saved state, which preserves an already
synced balance and handles destination product mapping centrally.

The signed cash drill passed on Retail POS Beta with two disposable SQL
Server databases and the native workers. The offline checkout retained
five pending rows and the legacy cursor. After reconnect and an exact
retry, both tills reached sequence 1 and confirmed one receipt and stock
of 19. Both tills completed handback after the fresh test scope sealed.
The receiving till verified the hosted archive contains the same receipt
and stock. The demo and older transfer scope were separate.

The hosted PIN refund and expired-cursor drill passed on Retail POS Beta
with two disposable SQL Server tills and the PR #451 relay build. The relay
denied the signed refund before approval, accepted one scoped manager PIN
grant, and returned the original receipt on retry. Stock went from 20 to 19
to 20. Till B recovered the archived sale, refund and stock after its saved
sequence 1 expired at replay floor 2. Both tills completed handback after
the synthetic epoch sealed and preserved their original legacy cursors.
The existing PIN rule stayed active. Disposable PostgreSQL and SQL Server
also passed the two-till settings round trip after a lost response.

The opt-in signed checkout path carries ordinary single-product card and
cash/card split payments with exact payment. Two disposable SQL Server
tills and PostgreSQL verified tender accounts, references, amounts, exact
replay, and one stock deduction. The existing cash format still replays.

Booking handover saves the final payment, sale receipt, and booking link
in one transaction without changing the screens. Disposable database
checks covered stale edits, rollback, exact retry, and deferral of the
change-tracking window until the booking group is accepted. Transfer
arrival and verification now use canonical groups for eligible scopes.
The fresh Beta cloud installer includes these changes and passed isolated
install checks. The separate in-place SQL upgrade passed rehearsal on a
populated PostgreSQL database and was applied to Retail POS Beta as migration
`20261110031005`. Read-back confirmed the new routines, row-level security
on all 97 POS and grouped-feed tables, and preservation of the existing eight
sales and cash archive before the two-till drill.

## 7 November — first two-way sync implementation batch

The owner approved starting the revised two-way sync plan on beta, using agents
and focused verification while the existing engine remains active. Begin from
beta `d39b0333`. The full plan and rules are tracked separately in beta PR #445.
This batch prepares a private PostgreSQL feed foundation for complete change
groups. A transaction appends once for all affected scopes, locking heads in a
consistent order and committing head updates with their groups. An isolated
PostgreSQL fixture must prove visibility, rollback and concurrent ordering, and
verify that application roles cannot read or publish directly.

The disposable PostgreSQL 18.6 fixture passed all four focused scenarios. A
same-scope writer waited for its predecessor, a separate scope progressed, and
complete groups and their head positions became visible together. Rollback,
wrong-epoch rejection and the provisional size limit left no gaps or partial
groups. Anonymous, authenticated and service roles were denied direct access.

The owner asked to complete the plan. Extend the preparation with bounded reads
of whole groups at a fixed upper position, guarded retention and snapshot pins,
and a private payload-bound operation inbox. An identical waiting operation can
resume with its original ID after dependencies arrive. A stored disposition must
be recorded in the transaction that claimed the operation. Keep the active
cloud contracts out of this slice. Move the preparation outside `supabase/sql`
because the canonical schema check treats that directory as deployable SQL.

The extended disposable PostgreSQL fixture passed 14 scenarios covering the
publisher, whole-group reader, snapshot retention fences and inbox. All 28
canonical schema checks passed after moving the preparation files. An export
that reads the canonical projection and head together still needs the
authorized publisher and relay integration.

Keep the prepared SQL outside the deployment migration chain until the scoped
relay, domain publishers and snapshot cutover can be reviewed together. The
existing feed, uploader, approval behavior and all installed cursors remain
active. Rollback for this preparation batch is a source revert. Live database
application, pilot activation and release retain their separate approval gates.

## 7 November — two-way POS synchronization rules and prior backup

The owner asked to record the revised sync plan as a permanent repository rule
and back up the previous rules before making the change. The documentation
batch starts at beta `d39b0333`. The [current plan](database/pos-sync-implementation-plan.md),
[previous plan](database/archive/pos-sync-plan-before-2026-11-07.md), and
[previous repository rules](database/archive/pos-sync-rules-before-2026-11-07.md)
preserve the supplied documents and pre-change instructions. The approval
refresh fix is tracked separately in beta PR #444.

The replacement protocol is pending. Before the pilot, confirm the isolated
SQL Server databases, Supabase project and relay, drawer ownership, business-day
cutoff, offline permissions and limits, card provider behavior, stock allowances,
and named cross-store approval rules. Treat 24 hours offline and 95% of connected
approval updates within two seconds as proposed pilot targets. Record checkout
and catch-up budgets before the drill. Keep a retry with `WAITING_DEPENDENCY`
eligible to apply under its original operation ID and payload after dependencies
arrive. Define a byte budget for whole feed groups and rehearse both cutover and
handback with an open shift and a pending sale. This batch covers the written
rules and backup. Runtime implementation, database changes and rollout follow
their existing approval and verification gates.

## 7 November — existing-enrollment PIN approval wake

Continue the owner's approval sync work from beta `94ac06b8` with the staff
subscription changes in PR #444. On an already enrolled Operations till, use
only a verified current-project machine session whose trusted account mapping
matches that exact terminal and branch. Keep a separate wake-only connection
for the existing private branch topic. Refresh Approvals and Holds through the
person's authorized PIN relay and keep the current fallback. The wake carries
no queue rows or approval authority. Release the subscription on sign-out,
proof loss, expiry or any terminal, project or scope change.

All 49 focused checks passed for account and device proof, one shared topic,
credential loss, expiry, branch changes and the relay fallback. Installed
delivery, the PIN badge outside these views and genuinely relay-only or named
cross-store sessions remain pending. No hosted schema or configuration change
is in this batch. The rollback is a scoped code revert.

## 7 November — scoped history during mixed-client rollout

The owner requested both sync corrections, beta first and then production.
Begin at beta 1b29fc22, which includes the tested shift recovery order fix.
The deployed 1.4.83 audit reader remains intentionally unavailable because
its current bootstrap, feed and counts use legacy reads after admission.
Older Operations clients can retain wider counts. Enabling only the v2
index would expose broader rows over the wire before a native refusal.

Prepare a separate scoped request for upgraded Windows clients covering
index, exact rows, history bootstrap, feed and counts. Keep legacy RPCs
unchanged during rollout and preserve authenticated branch and Management
scope. Add service-role-only routines under distinct names in one reviewed
migration. Make new requests fail closed if the matching hosted code or
SQL is unavailable. Maintain exact pages, cursors, bounded reads, protected
fields and the existing sync lane. Test old and new clients, branch denial,
authorized Management, rollback and pre-deployment ordering in isolation.
Show the exact hosted SQL and promotion for separate owner approval.
Keep the legacy cutoff as a separately reviewed operation.

The isolated exact migration, guarded fresh-install component and real
PostgreSQL/PostgREST suite passed 39 cases. Native sync fixtures passed 25
database integration cases. Read-only hosted preflight matched 13 dependency
definitions and the table integrity checks. The existing PostgREST DDL
watcher is enabled. No live SQL has been applied in this batch.

## 7 November — approval wake during verified staff sessions

The owner requested completion of the two-way sync plan. This beta slice keeps
the existing Approvals and Holds catch-up and uses the authorized activity path
to refresh the in-app bell after staff verification, reconnect or resume. Keep
proof-loss teardown, store and recipient checks and the relay fallback. Preserve
the existing notification cadence and avoid repeated approval-list writes from
the app shell. The current private topics cannot deliver instant wakes to
relay-only PIN sessions or named approvers across stores. Those paths require a
separately authorized wake transport and the two-till pilot.

CI on the initial patch rejected the old source assertion for the one-time
approval guard. The check now requires the per-session guard. All 47 focused
approval, notification and scope checks passed. The rollback is a scoped code
revert. This slice uses the existing database contracts.

## 7 November — shift recovery while the protected history reader is unavailable

The owner directed a focused fix for the synchronization failure reported on
released 1.4.83. Start from beta b0685139. STR1 had SQL connection and schema
Ready, an open shift, a current shifts Change Tracking gap and 29 local versus
30 cloud shifts. The held-status reader is deployed. The broader history
readers remain unavailable. The current startup checks audit-history
availability before its protected shift-gap recovery can run.

Allow existing scoped shift recovery to run only after proving an existing
same-branch Operations snapshot with valid operational bounds except positive
expired shift-family checkpoints. Check all bounds and source scope before
any attempt. Preserve pause, conflicts, pending journals, protected shift
intents and exact retained-graph validation. Recheck all operational bounds
before normal synchronization or checkout readiness. Test refusal of fresh
setup, another branch, unrelated or malformed bounds, blocked jobs, identity
changes and unverified local work. No live SQL, configuration changes,
manual checkpoint resets, installation or production promotion in this batch.
Mixed-version hosted history activation remains a separate decision.

The focused regression run passed 154 tests. The disposable SQL Server run
passed 18 cases, including exact default-organization checkpoint ownership,
a checkpoint changing during recovery, source invalidation before commit and
blank-branch journal refusal. Independent review confirmed the revised guards.
The production STR1 flow still needs an installed check.

## 7 November — retain complete Windows Change Tracking upload pages

The owner approved starting the two-way sync plan in scoped beta batches while
keeping the current engine active. Begin from beta `d39b0333`. The current
legacy Change Tracking reader can read a boundary twice when a page is full.
Cleanup between reads can invalidate the saved starting version. Keep complete
version groups in one bounded-window read and refuse to advance if the starting
version is outside retention after the read. Preserve journal-first upload,
scope and echo filtering, and acknowledgement before checkpoint advancement.

The two focused pipeline tests passed. An owned disposable Windows LocalDB
instance verified whole version groups, composite keys, deletes, existing echo
markers and rejection of an expired position through ODBC. The change uses the
current SQL Server connection and recovery path. It requires no migration or
operator setting change. The rollback is a scoped code revert. Cloud feed
preparation and immutable legacy-row staging proceed separately.

## 7 November — immutable Windows checkout journal preparation

The owner requested completion of the revised two-way sync plan. Begin from
beta `d39b0333`. Prepare a default-off Windows `SaleCompleted` journal writer
at the existing checkout aggregate transaction. Capture authorized saved sale,
item, tender and stock facts with their stable operation and business IDs. Use
an additive preparation table outside installed migrations. Prove atomic
commit and rollback, exact replay after local row changes, and default-off
behavior with an isolated LocalDB fixture. Preserve the deployed uploader,
legacy pending work, cloud acceptance and operator configuration.

This slice does not enable the new journal on an installed till. Review the
schema, event contract, cloud ingestion and pilot fence together before any
activation. Rollback for preparation is a scoped source revert.

Four focused Windows LocalDB scenarios passed. The fixture verified default-off
behavior and legacy replay, immutable saved cash checkout facts and idempotent
retry, rejection of unsupported inputs, and rollback of both business and
journal rows after a failure following evidence insertion. The supported event
is a plain cash checkout on an active shift. Other tenders and later financial
actions still need their own typed contracts and verified authoritative apply.

## 7 November — mixed-version fleet sync and verified held completions

Owner approved a separate beta implementation and isolated tests from
`5316b52a233bfa0605c6f3cd34e0405cc4ac5fd7`. The live STR1 metadata upgrades
and backup are verified. The six legacy bills have six distinct accepted cloud
sales and cleanup markers, but no matching local sale graph or retained valid
Change Tracking evidence. A completion marker alone cannot prove which local
cart revision was accepted. The Administrator review remains available.

Verified rollout blockers: 1.4.82 with broader retained history can fail count
reconciliation after narrowing, while 1.4.83 requires the new scoped reader
even for a fresh empty history snapshot. Bridge only authenticated and exact
scoped-reader unavailability. Prove the operational dataset separately before
enabling checkout, retain history and checkpoints, show truthful pending
progress and resume automatically. Denied scope, invalid data, pending local
work and network errors must preserve their existing safeguards. Do not call
broader history as a fallback or change the behavior of installed 1.4.82.

Automatically complete only holds with verified exact sale and cart lineage,
using existing branch checks, atomic SQL apply and idempotent receipts. Preserve
review for ambiguous legacy data and do not invoke checkout or charge during
recovery. Isolate same-branch and cross-branch tills, old/new versions, offline,
lost acknowledgement, concurrent retries, held-sale audit, and permission denial
in testing. Keep exact live SQL, real installation, automatic schema rollout
and production promotion outside this approval. PR #437 remains gated.

The first fleet slice holds history only on authenticated exact reader
unavailability and keeps checkout available only with an independently
qualified existing Operations cache. Fresh/incomplete tills stay gated. No
shared feed position advances over unverified history. The legacy 1.4.82
contract stays unchanged on the current SQL; the new hosted bridge must be
deployed and verified before the compatible installer is used. A fleet-wide
history SQL cutover still requires upgraded-till inventory and exact approval.

The held-status exception is keyed only for exact surviving cloud-held proof
and already accepted local sale evidence. It retains same-bill aliases, missing
rows, malformed/foreign pending evidence and expired tracking for review.
Existing status/provenance writes share one transaction. No charge, stock
deduction, sale rewrite, new grant or schema change is part of this slice.

Combined 634 focused tests, TypeScript, 29 native held-status cases and 27
native PostgreSQL/PostgREST cases passed. Device installation and hosted live
acceptance remain separate gates.

## 7 November — code-driven shift recovery and durable sync rules

The owner requested the permanent sync rules in AGENTS.md and asked to start
the code fix. Isolated beta baseline b631b5d54035bba6fa00ae641b70fdbbd55c5816.
Live databases and the affected PC stay read-only. Existing checkout, receipt
access, permissions, data, queues and checkpoints remain protected.
The rules cover all applicable sync tables and modes, including each table's
source, supported directions, scope, identities, foreign keys, apply ordering,
deletion policy and checkpoint guarantees. The implementation below is the
first bounded fix under those rules.

First slice: expose the existing authenticated exact branch/terminal shift
comparison as read-only when all optional recovery tables are absent. Show the
actual prerequisite, preserve the startup and checkout gates, and keep review
writes disabled until the existing metadata and approval checks pass. Native
and renderer files have separate owners. Cover clean absence, partial schema,
unauthorized and foreign scope, and the existing writable review workflow in
isolated tests. This slice does not complete a held bill or resolve a conflict.

The comparison uses the existing authenticated Main/IPC path. The fallback
requires database-owner metadata visibility to prove all four optional objects
are absent. It returns no decision key or write action. Focused sync/permission
tests, mounted browser fixtures at desktop and mobile widths, and the isolated
SQL Server absence/collision and exact timestamp test passed. TypeScript and
scoped lint passed. Actual affected-PC acceptance remains pending.

In parallel, review the existing checkout evidence and receipt scope before
preparing any durable held-proof changes. Keep the earlier missing-sale
prototype separate. The six STR1 holds must be verified or reviewed before
the dependent local shift can close. Competing closings still require trusted
evidence or an authorized decision. Show any exact database changes before
requesting rollout approval. No live migration or production promotion.

The existing private completed-hold cleanup receipt links hold, branch, bill
and sale IDs, but has no cart snapshot or revision. It can scope a review read,
but does not resolve an older offline edit. Future automatic recovery needs
durable exact cart evidence retained with accepted completion and durable local
pending/deletion evidence. Existing receipts cannot be backfilled from a sale
match alone. Reuse the current receipt entitlement and share one bounded scan
across the coordinator and recovery lifecycle.

Registry audit: the generated registry already orders normal inserts by
foreign-key depth and accounts for business dependencies such as held bills.
Pull applies deletions in reverse order. Missing parents outside a pull page
still use selected repair paths. A separately scoped follow-up should verify
and fetch exact missing parents for each applicable relationship or defer the
dependent work, without widening access or scanning unrelated records.

Owner follow-up extends the work to all registered table contracts, with
foreign-key and business dependency recovery, stable IDs and unique keys,
and consistent safe retries. First review the 70 registry decisions against
the actual upload, download, delete and checkpoint paths in parallel. Record
confirmed gaps and excluded/private tables. Prepare each small correction from
current beta with scoped regression tests. Do not add new access or apply live
SQL as part of the audit. Keep the tested shift review slice independently
reviewable.

## 7 November — HISTORY-SCOPE82 approved implementation and remote verification

Fresh affected-PC SELECT-only check on 7November about11:05am verified
DESKTOP-VIB2MIL\\LCRPOS/POS_Local GUID F4B03BDB-DE91-4582-B68E-186442172E95.
Current CT49803, all six closing tables minimum32338; stored push checkpoints
29273 (counts/events/notifications/reconciliations),27445(variance alerts),
29281(shifts) are expired. No pending closing-journal rows; zero saved closing
intents and zero baselines. This does NOT prove older closings were uploaded.
There are28CLOSED and1OPEN retained branch shifts. Ran only the already-present,
previously approved STR1-read-only-sync-diagnostic.sql after inspecting its target
guard and SELECT statements. No business/schema/queue/checkpoint changes.
The newly approved held/metadata diagnostic has not transferred; remote clipboard
is unreliable and the sender attachment control is inaccessible in the current
view. Asked owner to transfer/open that exact approved file, without execution.
Owner asked root to open it directly. Reopened remote Desktop file dialog and
confirmed the new file is absent; no reachable sender attachment dialog after
checking the UltraViewer session toolbar. Existing diagnostic results preserved.
Fresh read-only cloud comparison: local 5Nov09:16 shift 7d5bc4e5…ce68 OPEN v1;
cloud same shift CLOSED v4 at 6Nov20:46:42 Brunei. The31Oct shift
1a349429…ad27 retains its original local closing and later saved web closure
in cloud. Neither comparison grants permission to adopt or overwrite the graph.

Prepared implementation is now under one fresh independent candidate review.
Native owner reports410focused cases,26actual SQLServer groups, TSC and lint
passed. Held helper's first15full-core SQLServer groups passed; final17group
negative run pending. SQL history20PGlite/26nativePG-PGRST and41API/transport
cases passed; held20PGlite and final actualPostgREST pending. Root full Vitest
regression is running on frozen candidate source; these are preparation results,
not proof the installed production PC is repaired. Main automatic-DDL pin remains
null. No new PR/commit/live migration, metadata install or beta merge yet.
Independent reviewer reproduced starvation beyond an unresolved TOP100 prefix
and whole-batch rejection over2MiB with valid held identities. Root also
confirmed pending global-journal namespace must be included; actual SQL fixture
reproduced unsafe adoption before this fix. Held owner is correcting only these
reviewed cases with bounded keyset scan, safe smaller sub-batches and global
pending protection. First full run:6639pass/25fail/10skip. New canonical source
strings confused old SQL fixture extractors; serialized inert CREATE tokens
without changing their decoded bytes/fingerprints, restored Windows line ends,
and preserved HEAD canonical financial blocks. Remaining old-protocol fixtures
and installer inventory are being aligned before final full rerun. No runtime
guards are weakened to pass tests.

Exact prepared cloud files (approval not granted for live application):
`20261107021328_isolate_branch_history_sync.sql` SHA256
`12AFC6692EF3EFDF4C77676D920C0DF959AC26708892D99D6DEAFC55D10FF7FA`
changes seven read routines and adds four service-only read helpers;
`20261107024729_bounded_held_status_reconciliation.sql` SHA256
`3B23385AB97C317A7FB317F2BD3685FBAFE683D5A2536916E71536C5F7B84BCB`
adds one service-only read RPC. Target only ROSEGILL pos
`qhrufhtbeguxydenzfey`, postgres. No business records, existing grants, feed
triggers, checkout writer or checkpoints change. Both exact files passed
26 owned native PostgreSQL/PostgREST groups each. Canonical component assembly
and replay pass; full synthetic fresh-schema install stopped at the unchanged
products-to-stores foreign-key ordering before these components. Existing
financial blocks are unchanged. Do not claim fresh installation or installed
device acceptance from these checks. Test deployed beta compatibility before
coordinated migration rollout because old clients can report a count mismatch
after narrowing history. Optional SQL Server recovery metadata remains separate.

Owner explicitly requests a draft PR now so checks can run during verification.
[Draft beta PR #432](https://github.com/amirosesingh/retail-pos/pull/432) opened
and labeled `beta` at e5c51b73a0db356e653fde0c9380025479c66542. Exact beta base
28b7bb97 checked identical on GitHub before push. Stage only scoped paths.
Second full local suite6667pass/10skip; independent SQL schema/registry/install
ordering and91sync/startup/update tests pass. Held global-pending/keyset and
oversize fix passed22full-core SQLServer groups, including101unresolved prefix
and subsequent valid ticket. One extra trigger attach race was reproduced after
the existing packaged probe: extend held/receipt trigger witness under owned
transaction locks. Final witness also pins the complete held and receipt trigger
sets, rechecked after the held row and receipt key range are locked. Both red
fixture side effects are prevented;25/25 actual full-core SQLServer groups pass,
including a competing CREATE trigger timing out under the receipt lock.
Final helper SHA256 CEBFC054D36F8D32B6A3CBD264CE0896E926FBDACA7C77DAEC93080E681B4028.
Final follow-up commit/head CI, applied-migration acceptance and the affected
PC's held-parent evidence remain separate.
No beta merge, live database change, installer or production promotion.

Owner resumed after the physical Escape stop and explicitly requests only the
connected UltraViewer window/one remote view. Resume the same agents and source
scope; no broad desktop inspection or display/security configuration changes.
Automatic future recovery remains the required product workflow, not per-PC
manual data copying or checkpoint edits. Current real-PC list confirms recovery
metadata unavailable (not proof all four objects are absent). Cloud STR1 has
zero active held tickets:4completed with matching saved sales and10cancelled;
preserve those distinct terminal states. No real retry, repair or SQL write ran.
Remote input is intermittently refused due to concurrent owner input; wait for
an exclusive read-only control interval before navigating, while source work
continues independently. Source was frozen on Escape; resumed edits/tests remain
uncommitted and unverified until their explicit checks finish.

Verification checkpoint (not ready/merged): history SQL20PGlite groups and
26native PostgreSQL/PostgREST groups pass, including negative source/grant/shape/
immutable/rollback guards and scoped2009-row paging. Scoped history API10cases
pass. Native26actualSQLServer groups and131focused cases pass; corrected legacy
bootstrap/resume suites68cases pass using current exact hydration and SHA-pinned
released bootstrap for old evidence. Old1.4.82 control-flow3cases prove qualified
cache preservation with truthful ERECONCILE and new scoped convergence; this is
not installed-device checkout acceptance. Held runner11actual LocalDB/PG/PGRST
groups reproduce the no-download shift-gap bug and verify ordinary completion.
Automatic held helper/endpoint integration, full regression and independent
candidate review remain in progress. No real data was repaired/copied.

Current affected-PC1.4.82 is now verified in Software updates. Its actual local
Holds page lists6Nov5 WIN51 tickets0002–0007, unlike the14 cloud held rows above.
Read-only cloud sales lookup confirms exact matching branch/bill saved sale IDs
for all6. Do not equate missing cloud held row with cancellation or infer paid
state from an editable label. Check local bill_no, matching accepted parent,
held CT and canonical lifecycle triggers. SSMS17 is opened and owner connected
it using saved Windows Authentication to DESKTOP-VIB2MIL\LCRPOS/POS_Local.
Remote clipboard pasted old search text rather than intended SELECT; nothing
was executed. Prepared guarded SELECT-only diagnostic SHA3FEE1601B84D4A712B89E90AE6701F949BD73D5ED87EB6E380B6B4A16071241D
needs authorized file transfer before execution; optional metadata upgrade and
all live DDL remain unapplied. An initial cloud diagnostic SELECT used an invalid
total column, was corrected to identifiers only, and changed no data.

Held recovery extension is now justified by an actual owned SQL Server +
PostgreSQL/PostgREST reproduction: accepted web completion stays locally held
because the real coordinator throws shifts ECHANGEGAP before its pull phase;
ordinary pull succeeds. Root authorizes the requested automatic-sync correction,
not manual data repair: bounded known-held-ID status reads and guarded local
terminal-state adoption under the existing exclusive lane. No normal feed/push
checkpoint, journal acknowledgement, checkout readiness or shift warning changes.
Require valid held CT, stable branch/source/GUID, no related pending writes and
matching ticket identity; completed also needs an already accepted matching local
sale/booking. Missing parent, expired held CT or divergent work remains pending.
No financial header copying or new charge/stock movement is allowed.

Ownership: held_sales_verification owns a new held-status helper, coordinator
hook, Main wiring and focused actual workflow tests. SQL owner owns the new
service-only bounded known-ticket read RPC in a separate CLI migration, guarded
server request/dispatch and SQL/API tests. Native owner owns CloudClient adapter
and the necessary optional lifecycle hook; coordinate exact wire/callback shape
before editing. Never add a competing sync lane/timer. New RPC is read-only;
exact final file/hash/target approval remains required before live installation.
The observed equal-version competing-draft zero-applied acknowledgement remains
a separately tracked defect; do not silently bundle its writer/financial fix.

Implementation contract after fresh independent investigation: Operations history
is ONLY explicit BRANCH attribution matching its trusted registered branch and
exact organization. GLOBAL, PRIVATE, CLUSTER, TERMINAL and unknown/unattributed
history remain immutable/stored but excluded; neither current product ownership
nor a terminal's current branch proves historical attribution. Verified opted-in
Management retains all history within that configured company. Shared catalogue
and current scoped settings synchronization are unchanged.

SQL owner history_sql_preparation owns a new CLI-created migration, shared
canonical scope helper/generator hook, generated schema and SQL/PostgREST tests,
protected-history-reconciliation.server.ts, sync-endpoint.server.ts guarded
request/dispatch and their focused API tests. Native never edits those paths.
Native owner history_native_scope owns a history-read-scope helper, index/legacy
handoff, jobs repository, feed/bootstrap/CloudClient/protocol, read-comparison
branch predicate/reconciliation/verifier/lifecycle and native tests.
Do not modify shared upload/write predicates or financial
writers. Prefer compatible legacy response shapes with an additive scoped
protocol marker for new clients; no legacy broad-read bypass or fake count.
Freeze the shared protocol with both owners before their boundary edits.

Native transition must preserve old hi1 rows/status/cursors/evidence and pending
work while starting a distinct policy-bound scan; old completed broad proof is
not new scoped proof. Raw bootstrap uses exact absent-only history hydration,
not generic highest-version replacement. Old1.4.82 qualified-cache behavior and
new-client/old-server denials require isolated tests before live rollout. If
legacy clients cannot safely adopt narrowed counts, report the rollout dependency
and hold live application rather than weakening isolation or declaring success.

Affected-PC read-only evidence on7November about10:09amBrunei: STR1/361Degree
Sports, POS_Local SQL connected/schemaReady210ms, stateBootstrapping, zero
journaled uploads shown, no active database job. Automatic shifts ECHANGEGAP and
bootstrap/Database.State ELOCAL_PENDING_UNVERIFIED repeat34times; retained work
needs classification. Zero journal rows does not prove expired CT work uploaded.
No retry, clear/reset, schema application, manual copying or shift action ran.
Owner reiterates code-driven automatic recovery for future PCs; prove safe
matching/recoverable facts and preserve genuine conflicts for authorized review.

Owner explicitly requests agents to fix history sync: registered Operations
terminals get only their branch; verified opted-in Management replicas get all
shops. Check held sales between Electron and web and inspect the affected PC
now available through UltraViewer. Show exact database changes before applying.

Owner follow-up: held bills remaining on affected Electron were already completed
online. Verify authoritative sale/held identity and completion/cancellation
delivery through normal sync; no manual DELETE/update, no duplicate payment/stock
movement and no pretending an unknown response is a confirmed completion. Check
whether the shift-recovery gate is stopping those independent confirmed updates.
The held-sale owner extends isolated tests first, reports any confirmed runtime
defect before editing a shared checkout/pull path. Root reads exact PC/cloud facts.

Recoverable baseline: beta28b7bb97f0f51cea910713511a29c66c88a06a8d,
new isolated codex/branch-history-sync-beta. PR431 already merged there: local
6523/10 skipped, CI6522/11 skipped, exact merged tree935d06c8, required and
post-merge permission checks/Workers succeeded. Automatic recovery-metadata
approval pin remains null; no live installation or production promotion ran.

Phase1: root independently traces bootstrap/feed/count/history-index/missing-row
boundaries; fresh read-only security investigator checks alternate paths and
compatibility. Held-sale agent traces/tests real native/web adapters, offline
durability, completion and denied branches without real financial writes.
Then agree the narrow source/migration contract before one owner edits each file.
Prepare any additive cloud SQL through CLI, matching canonical generator and
allowed/denied PostgreSQL/PostgREST tests; no new grants or business-row rewrite.
History already retained locally needs a non-destructive scope-safe transition:
never delete unuploaded/local-only work or reset progress to force equality.

Root owns tracking, Git/PR, remote inspection and protected actions. Remote
inspection stays in UltraViewer and SELECT-only diagnostics; no sign-in entry,
retry/clear/reset/cache action or real checkout/shift mutation. Capture current
app version, registration/branch, actual error, local schema/capabilities and
pending-work evidence before deciding a correction. Preserve operator config.

Acceptance: Operations A denies B/GLOBAL/unattributed history through every
download/count/recovery entry; Management all-company scope remains explicitly
verified; tampered/revoked identity denied; pending work survives expired history,
interruption/retry and scope mismatch. Verify held tickets through save/upload/
web read/update/download/payment-completion fixtures without double effects.
Membership, Stock401/031 and deferred shutdown logging remain excluded. Exact
live SQL/rollout and each production promotion need separate owner approval.

## 6 November — generator TEMP fixture dependency follow-up

Exact PR428 f5ce739d passed the original full permission suite and native/Workers checks, then failed step15: notification parity copies the generator into TEMP but omits its new history helper and migration. Owner/root authorizes fixing every fixture with that same copied-generator dependency defect. Search all actual generator references first; modify only confirmed fixture manifests, retain actual generation and unchanged ownership/denial assertions. Verify the real TEMP invocation plus related canonical/notification checks. SQL/schema/migration bytes, production approval and sole-writer push ownership stay unchanged.

Verified with pinned Node22.22.2: actual scripts/test-notification-upgrades.mjs now23passed/0failed; notification state plus history canonical and Management generation suites31passed; scoped ESLint and git diff --check pass. All generator references were inspected: only this notification harness copies it to TEMP; the others use repository-relative VM require or source inspection. Added only the helper and its existing migration input to the manifest; all parity/denial assertions remain. Exact-head full CI remains pending sole-writer integration.

## 6 November — CI failure repair for PR428 and infrastructure retry for PR400

Owner explicitly requests a separate agent to investigate/fix failed PR checks and continue without CodeRabbit. Baseline ca09533b in isolated codex/ci-history-recovery-beta-20261106. Limit source correction to synthetic fixture role construction and deterministic canonical schema block regeneration; preserve the credential guard, all SQL definitions/grants, final hardening and exact migration bytes. Acceptance: existing secrets, Management graph generator, history SQL/canonical tests pass; exact updated PR head CI is separately verified. Coordinate integration with the automatic-history writer; no concurrent remote push.

Verification: pinned Node22.22.2 with the existing read-only chore dependency tree passes46 tests across secrets, Management graph SQL/generation, history canonical/API/protocol and both25-group LF/CRLF PGlite fixtures. Scoped ESLint and git diff --check pass. First cold parallel local secrets scan timed out at20seconds; serial default-timeout rerun and full focused rerun pass. Complete generator outputs repeat byte-identically over three runs; no generated schema is committed because separate inherited stock canonical drift belongs to root. PR400 targeted retry completed successfully as job127735089204 (same run42161706683). Exact-head PR428 CI remains pending integration by its sole branch writer.

PR400 current cf8a4847 Android compile failed only while fetching Maven artifacts with HTTP429; retry exactly job127708672069 once. Draft/awaiting-owner-approval and production/publication boundaries remain unchanged. No live database, operator profile, registration, queues, billing, permissions or Membership change.

## 6 November — HIST81 automatic fleet history reconciliation

Implementation is now authorized within the owner's explicit automatic fleet
recovery scope, after root review of the concrete plan. Refresh beta c79893c3
before source edits and preserve COUNT80/product guards. First independently
reviewable checkpoint: strict exact-value protocol plus service-only UUID index/
missing-row functions and INSERT-only feed invalidation, tested in disposable
PostgreSQL/PostgREST. Then wire existing durable jobs and one sync lane; generic
JobManager pending-step behavior must opt in so existing callers are unchanged.
Completion proves ID membership only, never financial/payload equality or an
upload CT baseline. Preserve pending/local-only/divergent legacy work. New cloud
DDL is one atomic migration statement owned by the migration tool's transaction;
no explicit nested BEGIN/COMMIT payload. Exact cloud target/hash approval remains
separate. No live schema/data/configuration changes, per-PC manual repair,
registration reset, queue clearing or mutable history writer is authorized.

First checkpoint in progress: strict Main-only index/row protocol now passes25
focused cases for bound scope, increasing/duplicate UUIDs, malformed progress,
lossless bigint/JSON/timestamps and denied extra/private fields. This is not wired
to sync yet. Current live read-validator, privacy-helper, immutable-guard and
pull definitions were captured read-only before any proposed patch; schema-only
fixtures contain no business rows. CLI created the pending migration file; its
SQL/native/PostgREST tests, future-insert trigger, fair durable jobs and actual
device acceptance are still pending. Keep the draft PR checklist explicit.

RPC preparation checkpoint: CLI-created20261106042139 is one DO statement with
three new service-only functions and an INSERT-only feed trigger. It backfills no
history and changes no existing helper/grant. Latest captured-routine tests pass
25 PGlite groups in each LF/CRLF form,26 native PG18.6 CRLF groups and27 native LF
groups including8 actual PostgREST16.5 cases. These cover the1000-row set cap versus
complete2007-ID scalar pages, exact bigint/JSON/100ns values, current privacy and
denied/revoked scope, byte prefixes/hard limits, source/shape/grant guards, real
writer contention, replay, late DDL rollback and tool-ledger rollback. Fresh-schema
assembly preserves final privilege hardening and guards the two observed immutable
helper formatting variants; live migration preflight stays byte-exact. The native
read transport/actual relay and bounded response validator pass50 focused tests;
canonical/SQL assembly pass39. TypeScript and scoped lint pass. This is disposable
evidence only, not actual device recovery or hosted CPU acceptance. Independent
review, durable runtime jobs, final CI and exact live approval remain pending.

Runtime preparation dependency review: root explicitly approved the necessary
history-only ECHANGEGAP hold in PushWorker/coordinator/lifecycle and same-job
Management scheduling. This must retain journal and push CT checkpoint, remain
held in final allUploaded/close checks, and never soften other-table or401/403/
proof failures. Management stays pullOnly and schedules once per verified scope,
not per shop. The durable job uses the actual database GUID plus current trusted
request fingerprint/pool; opt-in JobManager checkpoints must stop on identity
changes rather than writing a previous job into a newly selected database. ID
membership still authorizes no push baseline or accepted author/payload proof.

Native job preparation checkpoint: actual JobManager plus the missing-only class
pass29 focused cases; the actual append-only SQL Server store passes10 owned
LocalDB groups. Durable rows/cursor rollback, cold pool resume, exact15-column
values, lost response, byte prefix, retained divergent/currently arriving rows,
pending/unknown keys, CLOUD CT context and unchanged journal/feed/push checkpoints
are covered. Per-step identity changes suppress stale-database status writes.
The class is not yet scheduled by startup/periodic/Management runtime. Push hold,
coordinator/final-close truth and startup qualification remain separate local work,
then require combined regression and independent review. No live database touched.

Runtime wiring checkpoint in verification: one existing Main timer now separates
history continuations from due core work; all ordinary/unknown hints keep core
priority and its activity/connection deadlines. Management uses the same job once
per freshly admitted sorted branch set, never a per-shop uploader. New optional
nativeSyncSummary historyRecovery presentation is a necessary status dependency:
show actual pending/retry download work between quanta while preserving real
errors, disabled/pause, unknown counts and pending uploads. It grants no readiness,
new read or upload ACK. History-only expired push CT remains explicitly held and
cannot pass final allUploaded/close gates; neither index completion nor local-only
facts reset a journal, feed cursor or push baseline. A qualified operational cache
may remain usable; first-time/unknown/restore and wrong-scope gates remain.

Actual disposable SQL Server verification now passes17 groups, adding startup/
restore/forged-cursor gates, real concurrent journal lock exclusion, lost committed
readback and two independent owned PC databases. Current runtime source still
requires final focused/full tests and independent review. The last PUSHED checkpoint
52c18862 passed all required CI/Workers:6296 tests passed/11 skipped; both prior CI
fixture failures are corrected. That result is not evidence for the new local
runtime head. Prepared migration bytes remain80BDFC48A78220A532FBF909F5B1E05F2C7188881401F8822ADF642EDCD40A88;
new helper-literal whitespace denial tests change only fixture coverage. No live
application, beta merge, deployed CPU/device acceptance or production approval.

Actual caller review added two bounded acceptances:10 mounted1440/390 NativeBoot/
AppShell groups preserve page/dialog/unsaved input through24 genuine Management
activity quanta, while cold/restore/profile/revocation gates still block. Twelve
owned actual Main/SQL/HTTP/PostgreSQL groups preserve local closing, central
closure upload and exact original replay under the history-only upload hold.
Its final full-upload guard remains false. Necessary shutdown dependency: classify
the new explicit EHISTORY_UPLOAD_REVIEW alongside existing non-retryable holds,
so shutdown does not immediately repeat an already-known review condition3times.
This changes neither save/ACK rules nor ordinary transient/authentication retries.

Persisted-v1 compatibility finding reproduced in an owned LocalDB: a valid
interrupted history_gap_recovery_v1 opaque cursor blocked both the new index job
and an otherwise qualified cache. Root approved a narrow handoff preparation:
classify at most50 exact existing history-only job rows with current bound source
and Main single-instance+coordinator ownership proof; defaultempty allowlist with
no proof. Bind their exact SQL FOR JSON metadata, including100ns timestamps, into
the new job scope hash, re-lock/recheck each commit, and exclude only those IDs
from active/startup barriers. Preserve every old row/status/cursor/error/baseline;
no old helper execution, CT/feed/journal change or completed-marker fabrication.
Unknown/executing/different-scope rows and operational restore/bootstrap remain
gated. Required: actual persisted-v1 upgrade/restart, metadata100ns mutation and
combined execution/source proof true/false tests before final freeze.

Compatibility verification now passes23 owned actual SQL Server groups: a real
prior-app page transaction saves an opaque v1 cursor, interruption persists it,
the new job resumes missing-only work after a cold pool restart, and every old
job JSON value plus CT/feed checkpoint stays unchanged. Missing Main proof,
executing legacy work, wrong backend/unknown job, defaultempty/overflow IDs and
a100ns-only metadata change remain held. Main's private callback rechecks actual
single-instance and coordinator lease ownership, secure profile/registration
fingerprint, exact executing new-job ID and fresh database GUID before/after its
await. It is not an IPC authority. SQL metadata hashes/raw JSON are never logged.
Five pure legacy-proof tests and three actual Main callback cases pass;168
focused tests pass and TSC passes. Metadata-set mutation does not authorize
discarding an earlier now-unbound index job: membership can finish but that
retained startup barrier still needs review. Valid unchanged v1 upgrade does not
have that barrier. Final full-suite and independent review remain in progress.

Provider review found the NEW history-page Transaction.begin(SERIALIZABLE) left
the same msnodesqlv8 pooled session at SERIALIZABLE after commit. Correct only
this new path: pin a publicly acquired Request connection, refuse inherited or
implicit transactions, own BEGIN/COMMIT/rollback, and rely on the existing
UPDLOCK/HOLDLOCK resource ranges without any session SET. Restore/verify its own
transaction count before release; if rollback cannot be verified, close and
invalidate only that owned driver handle. Main's GUID callback uses that same
pinned parent, avoiding another-connection deadlock with a max1 pool. Actual13
owned single-session groups pass all5 isolation levels, unchanged options/
lock timeout/deadlock priority, commit/rollback/lost-BEGIN/context failure,
contention with the writer retained, inherited/implicit refusal, actual Main
callback inside/outside the real coordinator lease, and failed-rollback discard.
The23 recovery/upgrade groups also pass on this corrected path. Before this
narrow correction the full runtime suite passed6354/10skipped; final exact-source
full regression, TSC/lint and independent review remain gates, not assumed pass.

Frozen corrected runtime verification: full pinned-Node22 Vitest with2workers
passes6354 tests/10skipped (734 files passed/1 skipped), no failures/unhandled
errors; TSC passes, scoped ESLint has0errors (18 pre-existing fixture any warnings)
and diff checks pass. Actual owned tests:23 SQL Server recovery/v1 groups,13
single-session preservation groups,27 native PostgreSQL18.6 CRLF groups; prior
actual PostgREST8cases, mounted1440/390 startup10groups and actual Main closing12
groups remain relevant unchanged-path evidence. All owned active fixtures are
closed. Installed beta/hosted CPU, exact-head CI, independent final review and
the separately approved central migration remain pending; no real profile,
database, registration, queue, checkpoint, permissions or production was changed.

Owner explicitly requires automatic recovery for hundreds of PCs after short or
long offline periods, without per-PC manual SQL, UUID exports, repair scripts,
registration/checkpoint resets or queue clearing. A centrally reviewed migration
may be applied once. The earlier manual evidence/seed proposal is diagnostic
preparation only, not the final fleet design. Prepare a concrete automatic plan
from beta c77beecc, keeping COUNT80/PR426 frozen and depending on its correction.

Reuse the one durable sync lane, transactional jobs/checkpoints and current
authorization/privacy proofs: future immutable inserts use incremental feed;
missing retained records use bounded/resumable authorized UUID/index comparison
and fetch only missing records. Each PC keeps independently scoped progress and
pending offline work. Do not treat matching counts or newest revision/time as
equality/authority. Retry transient failures with controlled jitter; classify
local-only/divergent/uncertain legacy work for review without overwriting it.
Large-table auto-recovery must reuse existing history resume infrastructure and
bounded requests, not disable the existing100-row safety limit globally. Inspect
existing contracts and send the exact proposed files/protocol/risks before code.
All live DDL/application remains separately approved. Do not enable unreviewed
mutable history apply/delete helpers or change deferred audit privacy/Membership.

## 6 November — COUNT80 count-artifact line-ending correction

Separate beta correction from c77beecc after merged COUNT79 reproduced
HISTORY_COUNT_UNEXPECTED_CHANGE on a fresh Windows CRLF checkout. Its multiline
new_select dollar literal embedded the checkout's CRLF bytes while the unchanged
new-body hash correctly required the reviewed LF replacement; the transaction
rolled back. No live count migration has run. Keep its existing filename, exact
old-source/metadata guards and f5a899 new-body hash. Construct only the replacement
from single-line literals joined by explicit LF characters. Test the complete
captured-definition scenario group using both LF and CRLF artifact bytes, including
cross-format replay and denied/source-drift/rollback parity on PGlite and native
PostgreSQL. Inspect all other hash-sensitive literals for checkout dependence.
No source variants, hash relaxation, live schema/data changes or deployment.

Verification: complete21-scenario groups pass with LF and CRLF artifact bytes in
both PGlite and native PostgreSQL18.6, including cross-format replay. Focused
Vitest/canonical inventory31 passed. Other guarded old/new/history/sources dollar
literals are single-line and explicitly checked. The prepared committed-LF-file
SHA256 is now731375F0F4E03520A7C648DFE790FF05AC97FA455A57CF1E3032B0D0748B9DF7;
this supersedes COUNT79's288F artifact bytes, not its unchanged reviewed f5a899
resulting routine body. Exact-head CI, fresh preflight and exact-target database
application approval remain separate; no live count migration has run. Root's
independent source review passed the exact four-file correction before commit.

## 6 November — COUNT79 complete the existing history-count contract

Separate preparation-only branch from beta0b6f00b1. Actual Electron's normal feed
succeeds, but strict reconciliation correctly refuses the incomplete central
count contract: the registry contains70 tables, while live counts delegates69
and omits change_history. Old comparison silently ignored this missing coverage.
Live bootstrap_scoped89cc3af4 already admits history using WHERE true with no date
cutoff; registry retention=current and local comparison=1=1 agree. Preserve this
existing authorization/retention contract, including its separately held broad
audit-privacy review, rather than relaxing client validation or inventing scope.

Owner authorizes recommended sync corrections with exact database changes shown
before application. Prepare one CLI-created additive migration pinning the exact
four-argument counts wrapper6547d32e, scoped delegatec08c4bf2, bootstrap history
selector/body and routine metadata. Append exactly one current-history count;
preserve OIDs, validators, voucher semantics, ACLs and all existing count rows.
No business-row writes, data repair, feed trigger, backfill or live application.
Focused isolated tests use schema-only captures and synthetic records, with
allowed/denied branch/terminal/role, full count coverage, replay, unknown source/
metadata/selector rollback and existing history-retention parity. No operator
profile/SQL Server database is used.

Read-only current evidence: cloud history21019, root's local count20799. The220
net count gap needs a separate UUID comparison; it does not prove exactly220
missing rows or exclude local-only facts. This is separate from the three-product repair. Actual change_history
has only its immutable UPDATE/DELETE guard, no sync-feed routine/AFTER trigger,
and zero history feed entries. Count completion exposes that gap; it does not
recover history or authorize the separately pending feed/recovery implementation.
Keep three-product ownership and stale-owner protection in their independent PR;
no STOCK401, Membership or deferred audit-scope changes. Final artifact/hash,
isolated tests, independent review/CI and exact-target approval remain required.

6 November prepared verification: the count migration passes20 scenarios using
the captured routine definitions in both PGlite and a uniquely owned native
PostgreSQL18.6 fixture; the latter was cleaned after completion. Coverage includes
all70 unique registry counts, unchanged earlier69 rows, unchanged global vouchers,
history/retention parity, preserved OID/ACL/attributes, denied branch/terminal/role,
exact replay, source/metadata drift and late transactional rollback. Focused
Vitest plus canonical inventory:30 passed. Scoped ESLint and TypeScript noEmit
passed. Authorization adapters are controlled synthetic fixtures, not deployed
device/RLS acceptance. No live migration ran; no local POS profile was opened.

Root independent review reran20 PGlite and20 native scenarios with no blocker.
Prepared migration SHA256:
288F86855B5A7735BF9FCC3601D3A840781BB5F6759AE1C6FCFA17D79D3DC173.
The separate beta PR remains draft/preparation-only until exact-head CI, fresh
live-definition preflight and the owner's exact-target application approval.

Fresh read-only dispatch inspection also confirms live pos_sync_pull already has
the change_history UUID selector. The protected feed page delegates it and the
unchanged privacy projector. An absent history trigger, not absent pull dispatch,
explains why no new history invalidations exist; implementing/backfilling that
separate change remains pending a concrete plan and exact database approval.

## 6 November — SYNC75 recovered POS-feed failure status

Owner asks to fix the continuing fetch-failed notice without resetting queues,
registration or permissions, and to surface only failures that cannot recover.
This is a separate status-only beta batch from cfae0756; UI74 remains in PR421.
Actual read-only Coordinator + PullWorker reproduction proved a feed EAI_AGAIN
failure remains in lastError after two successful normal POS feed reads because
the separate Membership directory reports deferred. The automatic success log
correctly resolves the old diagnostic event, while the panel still reports one
current error from coordinator.lastError. Membership remains ON HOLD: preserve
its reads, deferral notice, dependencies and retry behavior without modification.

Plan before implementation: add private in-process evidence of the existing POS
feed's failed/complete boundary; classify coordinator status failures by that
proven domain. Clear a feed failure only after a complete matching-branch feed,
even if the unrelated Membership directory remains deferred. Keep unknown/full
download, skipped scope, credential, push/activity and actual local-pending
barriers unresolved until their own work succeeds. Existing clearing also ignores
deferredLocalChanges/deferredHeldDeletion, so partial feed work must not establish
new successful-completion evidence. No upload/download request, retries, data
application, acknowledgements, queue/checkpoint, schema, settings or permission
behavior may change. The evidence is presentation status only, not authorization.

Acceptance: actual classes with synthetic cloud/checkpoint/SQL adapters for feed
failure then Membership-deferred success, repeated failures, incomplete/pending
feed, branch/direction/activity mismatch, unknown/membership failures and current
credential denial. Verify existing status summaries and diagnostic classification,
and preserve Membership's notice. No live profile, business DB or network writes.
Prepare a separate beta PR after scoped tests, TSC and independent review; exact
head CI/deployed acceptance remain required before merge. No publication or DB
application is included.

SYNC75 verification checkpoint:141 Vitest checks across seven actual-class/status/
checkpoint suites and31 native sync-pipeline tests pass on pinned Node22.22.2;
TypeScript and scoped ESLint pass. The synthetic adapters make no network calls
or business/checkpoint writes. Tests prove EAI_AGAIN recovery despite a separate
Membership deferral, continued real errors, branch/direction/activity mismatch,
unknown and Membership metadata failures, credential status, pending local rows
and held tombstones, and forged/copied/serialized/wrong-branch evidence rejection.
The private evidence changes no serialized worker result or permission grant.
Independent exact-head review and beta CI/deployed acceptance remain pending.

## 6 November — UI74 confirmed-empty Dashboard activity panels

Owner's existing ALL-cards rule covers the three confirmed empty Dashboard
frames still rendered after CHART72: Cashier review, drawer opens without a sale,
and split payments. Fix only those presentation conditions and the same explicit
empty-category frames on Business Board, from clean betaca93ee76. Preserve All
Shops' loaded zero-shop directory exception, financial formulas, actions and all
queries/permissions. New frames reveal with the existing reduced-motion-aware
entry animation only after actual current-scope data is confirmed.

Inspection: sales/cashier/split data comes from useReportSales, which exposes
initial loading, refresh and errors; drawer events come from the existing
synchronous saved-event cache, filtered by current branch/business day. That
feed is not a complete SQL/cloud history read or a newly persisted Electron
history cache and must not be described as one.
Use existing confirmed-presentation snapshots scoped to current identity,
branch/day/timezone, retaining same-scope known rows on failed refresh and hiding
old rows on scope change. Keep errors/status truthful; never treat an error as
an empty success. Board category panels stay behind its existing confirmed read
and appear only when their scoped item rows exist. No provider/auth/DB edits.

Acceptance: actual mounted React at1440/390 for unknown seeded data, confirmed
empty, positive arrival, same-scope refresh/error retention, positive departure,
branch/identity scope and real actions/columns; preserve normal-terminal scope
and error messages. Focused route/financial/report regressions and final beta PR
checks required. No operator data or live database execution is authorized.

UI74 verification: the actual mounted Dashboard and Business Board pass at
1440px and 390px with controlled report/auth/provider snapshots and real tables,
receipt dialogs and column-menu portals. Unknown seeded data and confirmed-empty
frames stay hidden; actual rows reveal with the existing motion, including
free/refunded-bill records. Same-scope sales refresh failure retains the last
confirmed activity with an explicit status; empty departure and identity/branch
changes remove the panels and their popups. Native normal-terminal branch lock,
bill search, receipt opening/closing, column controls and Board category drilldown
remain exercised. No remote requests, operator preference writes, document
reloads or real business data. Screenshots inspected at both responsive widths.
Commands: pinned Node22 runs scripts/test-dashboard-activity-panels-browser.cjs
--run; eight focused Vitest files pass52 tests, including category/trading/scope/
timezone regressions; tsc --noEmit and scoped ESLint pass.
The shared hourly-chart wording now says reported item cost, matching the
preserved unit-cost/current-product-cost fallback. Queries, calculations and DB
objects are unchanged. Final beta PR CI/deployed acceptance remain separate.

## 6 November — SQL73 existing-PC stock-history bundle preparation

Owner requires ONE existing-data PC SQL upgrade file for the upcoming approved
stock report, without replaying the installer or damaging production records.
Prepare in separate codex/existing-stock-history-upgrade-beta from beta99064909.
This supersedes SQL72's temporary031 exclusion only AFTER the STOCK401 writer
explicitly freezes its reviewed031 source/shape; do not pin or ship the current
unfinished draft. Existing025–030 artifact090F2403…A4730 remains unchanged and
valid for its reviewed scope. No live SQL, installer publication or promotion.

Plan: preserve the current schema24/core hash guard, known installed025–030
recognition and source hashes; append the frozen031 metadata as the final module
in the same owned transaction/maintenance lock. Capture its exact table, column,
constraint/index/FK/trigger/owner shapes on a uniquely owned LocalDB fixture,
verify runtime schema parity, then generate the single file. Fresh/unknown core,
partial/unknown031 shapes or changed sources abort; recognized reruns preserve
all populated metadata and business values. No stock openings/backfill/activation,
permissions, settings, queue/checkpoint or registration changes are authorized.

Preparation inspection found a packaging gap: an extra031 entry in the manifest
is currently ignored and still emits the025–030 hash. Require exact source/module
set and ordering before generation so a future manifest cannot silently omit its
last upgrade. This support-only correction does not change the existing SQL
artifact. Focus on new031 append success/idempotence/partial-shape/late rollback
and populated-data/grant preservation once frozen; do not rerun unchanged32
SQL72 cases without a relevant change. No final artifact PR until concrete031 is
reviewable; exact file hash and actual PC/server/database approval before use.

## 6 November — CHART72 approved implementation

Resume the approved chart consistency batch from clean beta3074a475 in separate
codex/chart-consistency-beta. Preserve scopes and existing financial formulas:
selected-branch Dashboard; selected-cluster/all-authorized All Shops; authorized
company Board; normal terminal stays branch locked. New owner direction replaces
graph horizontal/infinite scrolling with a hidden-scrollbar VERTICAL chart grid,
two columns on large screens and one on phones, equal card/fixed plot heights.
Separate revenue/profit shop-colored trends, daily/monthly grouping, Today/15/20
day/custom date windows, cost+grossprofit stacked to revenue with Margin%, and
actual transactions/profit by hour are in scope. Summary-card rails are unchanged.

Inspection confirmed Dashboard and All Shops already have complete date-bounded
sales and captured line costs, so their hourly charts need no extra reads.
Board has daily aggregates and bill headers only; daily-cost apportionment would
be false. Prepare any required bounded hourly aggregate and exact SQL separately,
with existing account/terminal/branch/cost authorization and no live application.
Coordinate native Main changes with the agent owning stock/recovery; do not edit
shared Main concurrently. Use shared chart presentation, keep errors/incomplete
data truthful, and test branch/cluster/range/cost denial, zero/loading states,
small/large renders and existing checkout/report regressions. No financial writes,
grants, operator configuration, deployment or production release is authorized by
this preparation. Membership stays ON HOLD.

CHART72 first source checkpoint: shared fixed-height vertical charts, separate
shop revenue/profit trends and actual hourly grouping prepared. Dashboard and
All Shops reuse their existing bounded complete receipts. Board transaction
counts use actual bill times; hourly profit remains explicitly unavailable until
its bounded cost read succeeds. Native SQL reuses #facts and never returns its
private per-bill cost evidence; Main supplies/rechecks current cost authority and
rejects session/branch handover. No renderer flag grants access. Existing scopes,
daily calculations, financial comparison measure choices and sponsorship chart
remain preserved. All Shops waits for actual lifetime totals/inventory readiness
before showing shop cards, retaining the loaded zero-shop exception.48 focused
scope/value/permission tests and TypeScript passed. Actual SQL, responsive
rendering, full regression and cloud hourly read preparation remain pending.
No live database or deployment occurred.

## 6 November — isolated dependency integration verification

The owner asks that completed chore/version bumps be checked and integrated into
beta while payment and sync recovery continue. Retail's application version is
already 1.4.82. Five dependency PRs406–410 remain separate from publication and
production approval. Their green original checks use beta4e9a854a; actual current
beta is3074a475. Do not represent those checks as verification of the current
combined source.

Approved preparation scope: a separate codex/chore-beta-verification worktree,
preserving all five original heads as merge parents and changing only package
metadata/lock plus this evidence. No real POS profile, operator database,
registration, queues, settings, private keys or application code is changed.
No remote merge, release, signing or installer publication is included.

Local preview order406,407,408,409,410 retains every original package upgrade.
Only407 conflicts with406's dependency hoisting: retain Chalk4 for the builder
and resolve Chalk5 underneath its actual CLI consumers with npm11.4.2/Node22.
Existing minimatch/resedit and added mimic-fn/require-main-filename entries are
preserved semantically. The final preview bdf82beb has source tree
458704d89a0ed1cc8f38e761cb8046deed493456 and changes only package.json and its lock
relative to beta3074. Fresh isolated Node22.22.2/npm11.4.2 installation passed
(1063packages). TypeScript passed. All92 native Node checks passed, including
actual Capgo valid/invalid local bundle packaging and updater/sync/database
fixtures. The first restricted-temp run passed91/92 but Windows denied a fixture
installer rename; the unchanged normal-temp rerun passed92/92. The restricted
full run likewise failed on missing Vite SSR temp files/workerd fixture startup;
the unchanged normal-access rerun passed5983 tests/10skipped/0failed across706
files with two workers. Focused Query/Radix/startup/report/offline-checkout checks
passed120 tests across15files. Full lint passed with0errors/27existing warnings.
npm audit passed its high threshold:0high/0critical,19moderate/3low retained as
advisory follow-up rather than a zero-warning claim.

Unsigned Windows desktop build, NSIS installer/blockmap and full package smoke
all passed with builder26.18.0, Electron44.9.1 and npmRebuild=false. The smoke
verified ASAR integrity and the packaged SQL driver; signing/publication were
disabled. The local acceptance installer hash is
E493C3C7C0E869D4EB6827445D5AEAFE06D1F43CADBC96EE93A50AD955ADD088.
This is a test artifact, not a release candidate containing pending payment fixes.
Generated schema/report/route artifacts were inspected and restored after the
build; no generated changes enter the PR. Registry changes were timestamps only;
the existing source scanner reported two informational numeric-input observations
in NotificationRulesPage, not a newly introduced dependency defect. Actual
signed-in installed workflow checks remain separate. No remote integration,
database application or native publication occurred. Membership remains ON HOLD.

FIN62 cloud phase: PR391d15be0af allrequiredCIpassed. Ownerapproved exactdecimalv2 NEWactions only/final2dp halfawayzero; preserveoldacceptedhistory. Activeindependentnative/PGmath implementations, safecomplete-server-baseline receipts and financialauthor-domain foundation. Actualfinancialoperationauthor/writercapture and historical admission wiring remain open; no synthetic authorized flag/GUC or unverifiedclientrowlist may claim authority. All cloud/local DBapplication deferredEND exactbundleapproval. No finalcloudmigration applied or existingfinancialamountsrewritten.

FIN62 known-snapshot preparation verification: seven disposableLocalDB metadata-upgrade groups and20 SQLServer financial-basis groups passed, fixturescleaned. Independent review corrected IGNORE_DUP_KEY/physicalindex guard, canonicalUUIDtextorder, and transaction-preserving rejectedcaller behavior. Native prototype exposes expectedNativeRaw with scale12/formulaversion rather than claiming parity with PostgreSQL2dp wiremoney. Shared final monetary canonicalization/admission binding remain pending; no runtime activation or database application. Candidate025 hash updated in final-bundle document. Decision/preparationfiles are queued for PR391 update, not automatic migration discovery.

FIN62 next preparation: candidate existing-data local metadata025 is under scripts/preparation ONLY, NOTauto-discovered/applied. Metadata-only table/index/check/immutabletrigger, strict existing-shape and caller-transaction safeguards; six real disposableLocalDBgroups passed/cleaned. Exact proposal/hash in production-upgrade-bundle.md. Native financial-basis prototype under preparation remains unconnected to runtime/cloud. No production migration/datawrite or publication. PR391 current4fc8f04a checks allpassed; new decisions/preparation update will require newheadchecks.

FIN62 owner resolved multi-terminal semantics: VALIDATE SAVED KNOWN-DATA SNAPSHOT. Complete terminal-known baseline plus its authorized local financial changes at save, not a global all-terminals cutoff. Later other-terminal uploads must not retroactively change the original action; later authorized corrections use their own snapshot. Protocol completeness/authentication and legacy handling still require implementation/tests; no database application permitted before final bundle.

FIN62 first-batch verification: root full suite5099 passed/7 skipped (651 suites passed/1 skipped), separate prototype bridge1passed and17 isolated SQL groups. Independent4 actual SQL Server financial-boundary groups and31 existing native causal workflow scenarios passed with disposable fixtures cleaned; TypeScript/scoped lint/diffchecks passed. One pre-existing trusted-journal test lint warning remains. Source remains LOCAL race safeguard plus isolated prototype; cloud historical-authority gap and offline evidence protocol are NOT fixed or deployed. All new database application deferred until final exact bundle approval.

FIN62 first implementation prepared (not deployed): OperationsRepository can read the unchanged tender aggregate on the active transaction; protected ORIGINAL/RECOUNT saves recalculate expected amounts inside their existing SERIALIZABLE transaction before writes/signing. Unsupported new count/reconciliation shapes reject; exact accepted replay and variance-only approval keep their historical basis. 130 focused tests passed. Root full regression and isolated native SQL race/legacy workflow checks are running. This closes a LOCAL draft/read race only, not the cloud's authoritative historical validation gap. No schema change is needed for this first guard.

FIN62 isolated SQL basis prototype: complete selected-branch/shift inputs and exact existing-formula totals in one SQL MVCC statement; 17 isolated parity/precision groups passed. scripts/preparation/shift-financial-basis.sql is NOT an apply-ready migration, authenticated admission guard or persisted financial evidence. Cloud/new offline protocol remains pending. Do not release or label full FIN62 fixed based on the prototype/local guard.
4 November controlling owner instruction: FIN62 first, agents; defer ALL live cloud/local database changes until final exact ordered bundle review/approval. Supabase is PRODUCTION, never isolated by beta label. Prepare additive existing-data local SQL upgrade file if necessary; do not reset/rebuild/overwrite databases. Exclude Membership and checks requiring owner credential entry. Other pending tasks remain tracked, not silently completed. Report progress in this chat; cross-device push delivery is not guaranteed by agent. No external messages/notification service configured. Release only after required acceptance, exact promotion and release authority.

## FIN62 — owner-approved shift financial/as-of validation correction

## 5 November current integration and newly queued dashboard scope

Latest owner release decision: FINISH DEVICE ACCEPTANCE FIRST, not approval to
merge400. Owner explicitly requests offline recovery, historical stock report
and one consolidated existing-data SQL upgrade completed before production.
Continue necessary implementation/isolated tests under those existing feature
batches with agents; present exact cloud/local database changes before any live
application. Electron404 corrects the shared sale-saving path, including ordinary
sales without an approval, but installed acceptance is not yet proven. Native
testing must use an explicitly isolated database/profile, never real POS data.
The next final release head/scope still requires exact owner approval.

Current integration checkpoint: completed PRs396/397/398/399/402/403/404/405
are merged to beta8b1cb17b04187fe468033c04c4383eecc691babb, exact reviewed tree
57dbea4f321016c4ed95c753af10a6547d43fb88. Candidate1.4.82 metadata is consistent;
no tag/installer has been published. Final reviewed-head CI passed5789 tests with
9 skipped/0 failed. Both checkout and metadata automatic beta deployments passed.
Production remains main3d9d314c/Retail1.4.81. Draft promotionPR400 contains55
scoped files and no schema/data change; merge preview preserves the exact tree.
The identical-tree postmerge Security rerun and exact owner release/installed-test
disposition remain pending. Do not infer approval or call production updated.

Separate pending work: draft395 runtime recovery/CT acceptance, draft401 stock
historical storage/UI, consolidated guarded local recovery upgrade, installed
acceptance, Management session handover, navigation-pin ownership and deposit
attribution. Newly opened dependency PRs406–410 are unreviewed/excluded from400;
held359 and Membership remain untouched. User clarified sale failure is Electron
only while web succeeds:404 targets the local SQL aggregate path; installed PCs
need a new native installer to receive it. No cloud ownership/stock repair follows.

New production checkout refusal after approved discount: source mapping confirms
SYNC_BRANCH_FORBIDDEN / products, not a PIN or network error. Relevant checkout,
financial-stock policy and catalogue guards are unchanged between main3d9d314c,
betaada83bb9 and the recovery precision checkpoint. Twenty-three actual isolated
SQL cases reproduce a valid unowned legacy product losing stock-based catalogue
eligibility when its last quantity becomes zero; aggregate post-write validation
then rejects and rolls back the sale. Own/sibling/posted/cached catalogue proof
cases pass; genuine foreign/ineligible preimages remain denied.

Owner requested read-only tracing of the last two recent approvals. Exact pos
project/org identity was verified; both STR1 approvals reference the same bill and
were approved/consumed. One matching cloud product has no owner and STR1 stock1;
this matches the reproduced condition, while exact cashier-PC local linkage is
still unverified. No real records are copied into test fixtures. Owner now APPROVED
the separate same-transaction preimage/postcondition checkout correction and
isolated tests: existing aggregate repository plus focused tests, preserving
strict financial-stock deltas and unchanged catalogue identity. No ownership
assignment, stock repair, database/configuration changes or deployment covered.
Use a separate beta branch/PR from betaada83bb9; no live product, stock, sales or
configuration change was made.

Checkout testing also confirmed a PREEXISTING financial replay gap on original
beta and the scoped patch: an existing sale/item graph under a NEW aggregate
operationId can deduct stock again if its stock preimage again matches (isolated
restock reproduction). Same-operation exact receipt replay remains protected.
Owner now APPROVED the additional aggregate-only replay guard and isolated tests:
after exact accepted-operation receipt handling, before stock/financial capture/
journal writes, lock normalized proposed new sale IDs deterministically and hold
any existing sale without that aggregate's exact accepted receipt. No invented
receipts, guessed partial recovery, financial-row rewrites or stock changes to
real data. Preserve legitimate new sales, old original-bill exchange references,
same-operation retries, branch rules and separate refund workflows. Code/tests
only; no schema/configuration/data application or deployment. PR404 stays draft
until this guard and final full/independent/CI checks pass.

Negative-stock clarification: allowing negative quantity does not waive catalogue
or branch authority. The last-unit failure is transient eligibility loss at zero,
not a refusal from the negative-stock limit. Preserve the configured rule and test
positive/zero/negative transitions with actual allowed/denied branch cases.

Recovery completion within the ORIGINAL approved application-recovery batch:
now that exact downloads pass the complete regression, reuse the existing Main
authority/SQL service/IPC/preload/review UI for explicit Administrator cloud-choice
and private-receipt convergence, bounded ACKed-but-not-adopted restart scanning,
truthful pending stages, and a fresh existing six-table V0 proof after adoption.
No new role, grant, business decision, manual cloud copy or checkpoint reset.

Startup access investigation refined the first apparent blocker: existing
/database-startup already bypasses the trading boot gate and mounts AuthProvider;
it currently only exposes connection setup. Actual existing online/offline Main
POS login handlers passed a synthetic connected-but-not-tradingReady test, so no
backend auth relaxation is needed. Add a bounded ordinary Administrator sign-in/
review section to that route using existing PrivilegeGate and Main POS authority;
keep trading blocked, reject staff/emergency/stale identities, and preserve normal
login navigation elsewhere. Do not change NativeBoot/root readiness/permissions
or repurpose emergency sessions. If more shared auth semantics prove necessary,
stop and present the additional scope. Runtime changes remain in the unmerged
feature branch with isolated tests; no live metadata/activation/deployment.

Recovery wiring review found three existing Main safety/status consumers still
reading ordinary pending counts instead of the new combined upload/convergence
count. Isolated extraction proves reassignment could pass and signed-out/offline
shutdown could report zero with retained recovery work. Correct those three
already-approved Main callsites and existing focused tests only; preserve the
existing exit policy and authorization. This does not authorize a Change Tracking
acceptance change. The exact all-six-table recovery test still holds older
unproven CT entries, so this draft remains incomplete and excluded from production.

Owner APPROVED two narrow code/isolated-test batches on5 November:
1. Exact-witness-only correction in electron/sync/shift-graph.cjs and
   electron/db/shift-intents.cjs plus focused tests. Preserve legacy no-witness
   behavior and every branch/pending/immutable-history guard; no live database
   changes, deployment or runtime adoption activation covered.
2. Exact Management report pagination in
   electron/db/repositories/management-reports.cjs plus focused tests. Preserve
   current permission/completeness/cost/branch guards and every record across
   submillisecond page boundaries. No schema/data changes or deployment covered.
The separately found Management session-handover race and nav-pin ownership
correction remain outside these approvals; prepare their scopes separately.

Owner additionally requests production preparation side by side. Keep draftPR400
current as scoped beta work is verified; this is not specific production merge
or installer-publication approval. PR402 is merged betaada83bb9 with exact tree
parity and live beta asset delivery verified. Postmerge Android's sole failed
job hit an external Kotlin artifact HTTP504, not a compiler assertion; a bounded
failed-job retry is appropriate without source/settings changes. Other recorded
postmerge platform/Security/Workers checks passed. No production/installer/DB
action performed by that merge.

RECOVERY65 application checkpoint: missing-cloud legacy closing review/upload,
Main-only actual-admin IPC, immutable SQL pending records, private verified
receipt, duplicate-review uniqueness and truthful runtime status are implemented
under verification. Targeted real PostgreSQL21 groups, real isolated SQL Server20
groups, focused status/IPC/service/receipt102 tests and real React13 browser groups
pass; separate runs overlap and must not be summed as unique coverage. Total-wire
256KiB transport guard passes30 focused relay/receipt cases, with legacy ordinary
sync limits/branch/authentication preserved. TypeScript/scoped lint checks passed
before final UI lint-only cleanup. No live schema/data changes or publication.
Core adoption/completion is still a separate unfinished prototype, not included
in this checkpoint or claimed fixed. Exact committed head c900679d passed the
separate full Vitest run:5,848 passed/8 skipped/0 failed (5,856 total), plus
TypeScript. All current required GitHub/platform/Workers checks pass. These
results exclude the uncommitted adoption prototype and installed-device tests.

Reviewed-adoption prototype and exact-writer correction: the previously failing
ordinary cloud-delta precision case is now fixed in the owner-approved two shared
writers. All40 disposable SQL Server groups pass, including exact adoption,
receipt normalization, six-table capturedV0 completion, subsequent note update,
immutable history and genuine no-witness legacy behavior. Fifty-three focused
tests, TypeScript/scoped lint and independent SQL40/focused29 review pass; runs
overlap and are not summed. Independent review also corrected unbounded OPEN
timestamp changes and exact CHECK definitions. Final integrated full regression
is next. Prototype/runtime adoption remains unwired and schema unapplied; passing
writer tests alone is not the complete affected-PC recovery or release acceptance.

PR399 single sync-data lane is merged to beta596742141d33a1683f39990299ac7b7217259136.
Exact source0d2dcf45 passed5,748 tests/7 skipped/0 failed plus109 focused checks,
TypeScript/lint and all required CI/platform/Workers builds; merge tree parity
passed. Installed acceptance/publication is separate. Production draftPR400 now
tracks beta into main and is labelled production/awaiting-owner-approval; no
promotion or installer publication is approved by creating it. PR354 is historical.

Owner asked to inspect red production commit checks. PR400's12-commit check
rollups show two CANCELLED older Security runs (7ffb9862/4137b32e), not failed
assertions; later reviewed heads and merge commits pass. Current59674214 now
passes all required production-draft checks, including Security and Workers.
CodeRabbit remains skipped under the owner's earlier waiver. Do not erase old
run history or skip required tests. Passing checks alone do not authorize
production promotion, installers or live database application.

DASH69 new request (separate from the nine-workstream stabilization progress):
Live Dashboard selected branch only; Live Business Board company-wide comparison
within authorized scope across clusters; All Shops cluster context, revenue/gross
profit/line/bar charts with stable distinct shop colors and explicit filters.
Read-only source audit found /dashboard uses allShopsScope while its inventory
cards use currentStore; /analytics calls itself every-shop but companyStoreScope
is selected cluster; All Shops currently keeps every authorized card visible and
filters totals/bills by explicit cluster. Earlier owner decision719 preserves
all cards, so a new question is pending whether cluster selection should filter
cards AND charts or only totals/charts. Do not silently narrow/widen cards or
permissions. Scope/chart proposal audit only until this decision is resolved;
Membership stays on hold. Core recovery work continues independently.

DASH69 card-loading refinement: start summary cards hidden until their requested
scope has resolved data; then show qualifying values with the existing smooth
animation and react to later updates without full-page reload. Preserve verified
visible data during same-scope background refresh, distinguish errors/unknown
from zero, and clear a prior scope immediately when switching branch/cluster.
Keep meaningful negative financial/warning states and existing nonzero semantics;
All Shops shop cards remain visible even with zero data in the chosen scope.
Do not add chart sliding or invent animation-ready values from fallback defaults.

DASH69 decision resolved: owner selected "Filter cards and charts by cluster;
keep All clusters". This supersedes earlier719's always-visible-card behavior
ONLY when an explicit cluster is selected. All clusters still shows every
authorized shop including zero-data shops. Live Dashboard is selected branch;
Live Business Board is all authorized company shops across clusters. Preserve
normal-terminal branch locks, authorized management scope, existing revenue/
sponsorship/refund/profit formulas and graph placement; stable shop colors,
minimal desktop/mobile layout, no sliding/infinite behavior for charts.

RECOVERY65 UI verification:13 isolated real-React/Chrome groups pass at1440/390,
covering session changes, malformed replies, selected-shift binding, required
reason, stable retry ID, explicit upgrade hold and pending-not-accepted wording.
Fixtures used mock IPC/auth and blocked external network; not installed-device
acceptance. Actual cloud-correction adoption/final CT recovery remains unfinished.

Owner requests production preparation incrementally alongside beta integration;
keepPR400 scope/checklist current as independently tested fixes reach beta. This
does not authorize its merge, live database application or installer publication.

STOCK68 preparation is now draftPR401 at91e4e37e, integrated with beta59674214.
Independent review corrected order-dependent intermediate overflow;32 kernel and
4 adjustment tests pass, and the integrated kernel/adjustment/lane run passed55.
Only five scoped preparation files are in that PR. No historical report route,
ledger/schema, stock writer, data repair or complete-history claim is included.
CI is running; the full report remains pending and PR400 lists that release gate.

DASH69 investigation identified an existing shared Management-reader risk:
the Management report converts SQL datetimeoffset(7) cursors through JavaScript
Date milliseconds, which can skip submillisecond rows at a page boundary. Keep
any future native adapter fail-closed when another page lacks exact cursor
evidence; no partial result is a complete company total. A separate owner question
for Main reader correction/real SQL boundary tests is pending; no Main edit made.
Further review reproduced a session/branch handover race during its awaited read;
that additional authorization finding needs separately scoped correction review.

Controlling DASH69 scope correction: actual beta59674214 composition proves the
original Business Board already uses cloud on Management (isOnlineOnly=true,
effectiveDatabaseMode=online, localDb=null). The earlier concern that cloud routing
removed an existing offline Board path was incorrect. Preserve the original auto
reader in the UI/scopes/charts PR. Newly prepared native adapter/status/math code
is unactivated and excluded from that PR; do not add shared Main metadata reads
merely to complete this UI task. Cold-offline/PIN-only Management Board metadata
is a preexisting unresolved capability gap, not a verified supported path. Main
cursor/authorization corrections remain separate tasks. Final scoped UI review,
full regression and deployed/installed acceptance remain pending.

All-table follow-up: all11 non-id registry tables have declared-key generic
local apply and canonical cloud apply/feed/delete paths. The verifier's marker
skip is a structural assertion gap, not proof of missing synchronization.
nav_pins has an ordinary id key despite sparse direct behavioral tests. Highest
priority unresolved source candidates: whether the guarded native service path
rejects pull-only secure_settings uploads/tombstones, and whether nav_pins keeps
its established owner/company-admin rules under service-role sync. Source review
alone does not establish deployed exposure. An agent is preparing isolated
composed denial checks only; no app correction, permission change or live test
is authorized by that investigation. Keep Membership unchanged.

Five actual isolated HTTP/PostgreSQL follow-up observations completed. The
secure_settings candidate is FALSIFIED: valid device push/tombstone return400
SYNC_TABLE_FORBIDDEN, existing ciphertext is unchanged; invalid device returns401
before RPC. The nav_pins ownership candidate is CONFIRMED IN CURRENT SOURCE:
ordinary canonical RLS denies a non-admin foreign-owner write, while the actual
terminal-only guarded sync/service-RPC path updates and deletes the foreign pin
with200/readback. Impact shown is user-preference ownership only, not anonymous
access, checkout, stock or financial mutation. Live deployed-definition parity is
UNVERIFIED. No application/schema correction is authorized or applied. Keep as a
separate scoped authorization finding; do not widen access or silently disable
legitimate preference synchronization. Synthetic fixtures/results stay outside
commits; temporary .tmp files must not be staged.

## 5 November sync coverage clarification and current work

Owner explicitly confirmed: "All applicable tables; missing/changed records only."
Full end-to-end coverage means each applicable table and its dependency, delete
and recovery paths, not a repeated full-table refresh. Initial authorized baseline
and expired-history snapshots remain distinct from ordinary incremental passes.
Preserve Membership ON HOLD and existing per-table direction/privacy rules. Add a
registry-to-runtime coverage review; do not silently enable excluded tables.

Owner additionally selected one coordinated active data-sync request per terminal,
with bounded/fair upload and download turns and events recording changed facts.
Native durable pending operations remain in SQL Server, not an Electron file or
browser outbox. A transient Main scheduling queue is not durable business storage.
Keep authentication/control/health independent, SQL checkout local, and Supabase
pool management unchanged. Implement in a separate focused beta PR (SYNC68),
preserving all existing request/proof/batch/retry/cursor/acknowledgement behavior.
Owner asked to avoid extra/duplicate previous code: reuse the current engine;
add only necessary reviewed helpers/tests, and trace compatibility callers before
removing old paths. No broad rewrite or second per-module sync implementation.

Active work: RECOVERY65 server admission/receipt and native durable review outbox,
then trusted Main/UI/automatic-sync integration and end-to-end regressions. Root's
new relay integration plus existing native binding/causal regressions passed 59
tests on 5 November. That proves isolated routing/denial behavior, not installed
recovery or live database application. STOCK68 pure historical-quantity engine and
coverage design runs separately. Electron process-role/resource investigation and
all-table runtime coverage remain pending. No live database edits in this batch.

Owner asked whether both-connected database differences cause crashes. Divergence
is normal; observed evidence proves a recovery/loading block, not a process crash.
Test differing local/cloud data without losing pending work or reloading the UI.
Owner reported 3–5 or 14–15 Electron processes; inspect roles/windows and CPU/memory
before classifying extra processes. A prior sanitized local scan found no running
electron.exe; no remote process leak is verified and no process was stopped.

## 5 November new owner decisions — supersedes pending questions below

RECOVERY65: owner chose "Allow audited Administrator recovery". Implement a
separate explicit recovery action for unverifiable old closings, requiring actual
admin role/current scope, reason, immutable original/reviewer provenance and a
fresh cloud-state compare-and-swap. Saved amounts remain labelled historical
evidence with missing original financial snapshot; never fabricate strong
ORIGINAL/FIN62 receipts. Protected/new financial cases remain denied. This is
application implementation/isolated-test authority, not live database approval.

STOCK68: owner chose "Actual stock at the selected time". Use original movement
effective time, not upload arrival time; late uploads may revise the past report.
Preserve arrival time separately. Need proven opening baseline/deduplicated
movement coverage, branch/location scope and exact date/time/zone. Incomplete
historical evidence stays explicit. No arbitrary old stock/valuation reconstruction.

Current completed beta work: importsPR396, policiesPR397, documentationPR398,
all required checks passed before merge. Latest beta a73f24e8 contains the
permanent AGENTS rules; PR395 remains draft until runtime recovery is verified.

## RECOVERY65 and companion stabilization — 5 November

Approved: implement application-driven retained-shift recovery and isolated tests;
use agents, preserve offline checkout, current permissions/branch restrictions,
and all original/corrected closing histories. Owner rejected manual cloud copying.
Worktree codex/retained-shift-recovery-beta starts origin/beta5e7327d5. Permanent
AGENTS.md sync/database/import/report rules explicitly authorized for update.

Read-only affected-PC evidence: DESKTOP-VIB2MIL/POS_Local GUID F4B03BDB-DE91-
4582-B68E-186442172E95;29 parents/201 closing rows; CT49620 unchanged through
export, min29490 above six upload checkpoints; no pending journal/intents/baselines
or scoped orphans. Complete comparison:16 exact graphs;3 local CLOSED/cloud OPEN
(2/3/4November);4 competing local/web chains;4 identical-child parent summary
repairs;1 revision/update-clock difference;1 OPEN created_at precision difference.
Those are classifications, not authority to overwrite or manufacture receipts.

RECOVERY65 preparation checkpoint: draft PR395 created. Permanent rules and
bounded classifier committed; 60 isolated classifier cases pass. Dedicated
append-only evidence store and prepared (not installed) SQL pass 12 tests with
real disposable LocalDB, including concurrency, rollback and restart readback.
Existing runtime recovery passes 16 isolated SQL Server regression groups.
Portable classifier/evidence tests are wired into Vitest. No business export is
committed. This does NOT complete application recovery; modern author/financial
guards still need an explicit reviewed legacy recovery flow and runtime wiring.

Active RECOVERY65: bounded exact classification/tests, durable recovery evidence,
authorized legacy-operation recovery/accepted-correction preservation, resume
and long-offline/restart/lost-ack/denied-permission cases. Full runtime recovery
is NOT complete. New necessary schemas remain preparation-only and must be shown
with exact target/change before application. No live changes or deployment here.

Parallel POLICY66: native rules request schemas strip valid device proof and one
save schema drops terminal/session context; preserve proofs and existing guards.
Prevent editing unverified fallback defaults while retaining verified offline
cache/pending-edit support. Worktree native-policy-proof-beta; tests and beta PR
pending. This is not approval to change operator policy values.

Parallel IMPORT67: formatted Excel numeric amounts/decimals and row/header mapping
need reproducible fixes. Preserve original values/identifier text, expose errors
at original rows/columns, handle missing cells without shifting and test large
synthetic workbooks. Column N's header is not yet supplied; do not invent it.
Worktree inventory-import-values-beta; implementation/tests and beta PR pending.

Queued STOCK68: historical stock at selected date/time/actual shift close inside
Inventory. Audit found item_activity_logs/stock_delta_applied are not proven
complete (refund/absolute-stock paths, retention and effective-vs-recorded time).
Need verified baseline/movement coverage and time/valuation decisions. No fake
historical report or zero-data fallback. Core three fixes take priority; retain
this unfinished task. Membership remains on hold.

Retained earlier work: NATIVE-PROOF64 diagnostic preparation remains on
codex/native-terminal-proof-diagnostic-beta at c7597596. It is not installed,
published or verified on the affected PC. Device-proof cause must not be declared
fixed from a green reachability/registration-presence check. Preserve that
separate task and its original no-registration-rewrite approval boundary.

Pending business decision for RECOVERY65: old missing cloud closings have no
original frozen financial basis. Existing ORIGINAL/RECOUNT signatures cannot
honestly represent them. Asked owner whether an actual Administrator may attest
the saved legacy graph with explicit unavailable-historical-snapshot provenance;
new protected/FIN62-required writes remain excluded from any such exception.
Until answered, no legacy financial-admission exception is implemented or applied.

Nonblocking source-audit follow-up from POLICY66: other validators named pinInput
and closeInput in pos-rules.functions.ts omit native proof/context fields, but
their actual native callers are not traced. This is unverified, not a confirmed
runtime defect; do not expand PR397 or claim those paths verified from a keyword
match. Trace them separately before proposing a scoped correction. Current
rules get/save transport, branch/permission and offline-cache fixes remain the
approved policy batch.

## SQL72 — one guarded existing-database upgrade, preparation

Latest owner scope: the urgent 1.4.82 deliverable is ONE plain local SQL Server
PC upgrade file containing025–030 only. Unfinished stock031 is excluded and kept
as a future separate upgrade. This does not authorize Supabase execution or any
live PC update. Preserve populated installed025–027, migration records, pending
queues/checkpoints, settings, permissions and all business values. Exact final
artifact hash and actual PC target approval remain required before application.

SQL72 now incorporates beta759b4d0b at preparation mergeaca859b2. The two refreshes
preserved additive tracker text and both scoped LF-attribute additions. Reviewed
offline-approval/refund fixes, recovery, checkout and Management reader match the
destination exactly. Packaging-only catalogue capture on an owned
full Retail fixture verified84 SQL tables including all70 registry/domain tables,
then cross-checked existing runtime metadata preflights for025/026/028/029/030.
The manifest retains engine/collation provenance, canonical source hashes,
inherited versus explicit collations and semantic metadata without object IDs.
Generic SQL recognition compares exact typed, binary-ordered catalogue fields.
Only reviewed structural CRLF/LF variants outside quoted literals and generated
constraint names are normalized; literal content and index key order stay exact.
No original runtime validator/export was changed. Full inspectable catalogue rows
and per-category SHA256 fingerprints are independently cross-checked.

The standalone generated file is a preparation candidate, not yet accepted:
full existing-data, installed-module rerun, corrupt/partial shape, late rollback
and concurrent maintenance tests are running on uniquely owned LocalDB. An
initial execution never started because automatic permission review timed out;
the permitted retry started successfully. No operator database was accessed.

Current one-file SHA256 is
090F24031A07660C2D36512D2B38197A06491BB28408CCAAFDBB66FC400A4730.
Packaging10/10, scoped lint and independent Ubuntu-LF/Windows-CJS-CRLF parity
pass. Artifact/manifest and only5 additional actual source paths are LF-pinned;
the original SQL source Git blobs are unchanged. Quoted CR reconstruction starts
with explicit nvarchar(max) to prevent truncation. Final exact-byte acceptance
passes28 full-schema SQL groups on CI/BIN2 defaults (including6002-character
quoted-CR reconstruction), plus4 original transaction-composition groups. Every
owned fixture was cleaned. The27-group predecessor is historical only. Initial
typed comparisons hit the60-second fixture budget; binary JSON fingerprints
reduce valid apply/rerun to about10/5 seconds without raising any timeout.
Unknown/literal-case/Unicode/escape/NULL/index/trigger/owner differences remain
reject cases; no weak or version-only skipping is introduced.
Post-refresh checks pass90 dependency-free CI Node tests (including10 packaging),
scoped lint, exact packager check and independent platform parity. Git staged
blob and raw standalone file have identical SHA256 and zero CR bytes. DraftPR411
still needs exact-head remote CI and beta integration; no target application or
publication has occurred.

Owner requires one local SQL file for existing PCs and exact database changes
before live application. Separate branch codex/consolidated-sql-upgrade-1482-beta
starts from beta8b1cb17b. Packaging must retain the reviewed financial/sharing
metadata025–027, include final recovery028–030 and optional history031 only after
their sources/shape validators are frozen, and skip only recognized installed
shapes. Never replay the full installer, repair archive flags, switch databases,
rewrite stock/sales/permissions, reset queues/checkpoints or activate new rules.

Preparation adds a dependency-free assembler with one owned outer transaction,
bounded schema-upgrade lock, existing-core validation, source-byte hashes and
retained module shape guards. Only each declared initial no-caller guard is
removed to permit safe nesting in that owned transaction; module transactions
remain balanced. Caller work is rejected before changing XACT_ABORT. Five pure
packaging tests pass; an initial parser-only failure on the existing one-line026
guard was corrected. No final upgrade artifact or apply approval exists yet.
Actual rollback/rerun/unknown-shape tests and recognized026/recovery idempotence
remain required; do not claim the packaging unit tests prove SQL execution.

SQL72 actual-engine checkpoint: four uniquely owned disposable LocalDB groups
pass: caller transaction preservation, rollback of every earlier metadata module
after a late failure, successful three-module composition without sentinel or
migration-ledger changes, and truthful rejection of already-installed026 rather
than partial repair. Fixture cleaned. This is transaction-composition evidence,
not final idempotence or full existing-Retail schema acceptance. The final single
file still waits for frozen recovery/history sources and exact installed-shape
validation; no operator database has been updated.

Six packaging tests now pass, including identical generated bytes from LF and
Windows CRLF sources. The artifact embeds canonical LF source fingerprints;
separate source metadata retains the inspected raw-byte fingerprints. No final
operator artifact is emitted until every included module has its reviewed
recognized-shape/rerun guard and the complete bundle passes actual SQL tests.

## RELEASE71 — incremental production preparation, 5 November

Owner requested preparing production alongside fixes and promoting completed,
verified features through beta without replacing unrelated code. Retail1.4.81
already exists as an immutable published release; proposed next patch is1.4.82,
with no existing remote v1.4.82 tag at preparation. Separate current-beta branch
codex/release-1-4-82-beta prepares metadata only: existing version generator for
package/lock/APP_VERSION and SQL artifact labels, matching iOS marketing version
and incremented native build number. Preserve dependencies, signing credentials,
OTA key and all application/database behaviour. Inspect generated SQL diffs for
version text only. No tag, installer workflow, billing, schema execution or
publication is authorized by preparation. Require metadata/release checks, scoped
review and beta CI; specific final production promotion/publication remains a
separate exact reviewed-head decision. Other feature PRs retain their own gates.

RELEASE71 verification: nine dependency-free release/version/iOS publication
fixture tests and 22 focused release-channel/revision/desktop tests passed.
Independent review and structural comparisons prove package dependencies, SQL
semantics and signing configuration unchanged. The initial focused invocation
could not load absent worktree dependencies; it passed after reusing the existing
installed dependency tree, without package installation or source changes.
No actual publication, key access, tag or database execution occurred. Exact-head
CI and beta integration remain pending; do not call 1.4.82 published.

## 5 November permanent-rule update and current task index

Owner approved updating AGENTS.md without overwriting existing instructions.
Added coordinated durable synchronization/long-offline safety, bounded scoped
database calls, exact import values, evidence-based historical reporting,
truthful progress and approved-scope autonomy. Preserve all existing beta-first,
production/database approval, branch/cluster, iOS-key and Membership rules.
This instruction batch changes only AGENTS.md and the existing memory/tracker.

Current completed integration: PR396 import parsing/decimal/row mapping merged
beta73c002ae; PR397 native proof, offline policy/cache/upgrade and truthful503
handling merged beta e4be3768. Each exact head passed required checks; merge
trees equal reviewed heads. Final combined regression5,729 passed/7 skipped.
Installed Electron/mobile and original customer workbook acceptance remain
unverified. Production PR354 is closed/merged and v1.4.81 is already published;
do not reuse its approval for a new promotion or call new beta fixes published.

Pending RECOVERY65 (draftPR395): full runtime durable recovery/evidence/CAS/
acknowledgement integration and installed offline/reconnect verification. Older
unsigned closings lack original financial snapshots; owner was asked whether an
actual Administrator may attest them as explicitly unverified historical
recovery. No such financial-admission exception is approved or implemented yet.
No manual cloud copying, registration/checkpoint reset or queue clearing.

Queued STOCK68: Inventory stock at selected date ANDtime/actual shift close,
with explicit zone and truthful coverage. Existing movement history is not proven
complete; no fabricated past quantities/current-price historical valuation.
Owner was asked actual effective-time stock versus information known to cloud
at that earlier time. This decision remains pending; core fixes take priority.

Retain NATIVE-PROOF64: diagnostic preparation c7597596 on its separate branch is
not installed/published or verified on the affected PC. Green reachability is
not proof native device binding matches. A separate unverified follow-up traces
other pos-rules pin/close validators' callers before declaring a defect.

Membership and the separately tracked booking-deposit attribution correction
remain on hold/pending respectively. New production promotion, exact database
application and installer publication remain separate gates, not implied by CI.

4 November: owner approved agents completing production checks and fixing authoritative shift-total/refund validation, preserving checkout/permissions. Exact local/cloud database changes must be shown before application; no live schema/data change is approved by preparation. Baseline beta68470185; isolated branch codex/shift-financial-validation-beta. Confirmed gap: graph/author validation proves internal consistency/actor, not expected tenders against authoritative sale inputs. Current mutable sale journal cannot reconstruct historical offline refund state. Do not compare old closing against current cloud totals or invent refund timestamps.

Approved business decisions: validate ORIGINAL closing using financial inputs at its saved point; each later administrator recount/correction uses its own saved financial boundary. Preserve all prior audit/accepted receipts and latest accepted authorized correction. Booking deposit/payment-when-received attribution is a SEPARATE pending correction, not part of FIN62. Preserve current tender formula and original-shift refund attribution in this batch; do not silently implement a new cash-flow allocation rule.

Active: independent source/root-cause review; isolated reproductions; design additive native/cloud financial-version and action-witness metadata with trusted complete input boundary, exact arithmetic and all-writer concurrency discipline. Missing/ambiguous evidence must remain explicit; a caller-supplied subset/hash or signature alone is insufficient. Do not rewrite prior frozen signed intents or force pending closures. Proposed metadata is not implemented/applied. Actual schemas, compatibility rollout and migration hashes remain to be reviewed before database application. Membership stays ON HOLD.

Production: PR390 merged beta68470185; 5085 tests passed/7 skipped, exact merged tree parity verified. PR354 preparation continues; latest beta CI/PR-head synchronization, installed isolated checkout/offline/reconnect/platform acceptance, FIN62 and bounded CPU evidence remain release gates. Owner conditional production release instruction does not make incomplete gates pass. Existing production POS_Local must not be manually reset/rebuilt or overwritten.
4 November NOOP60 integration: PR389 merged beta0bfa12e3 after exact-head CI, independent118 regression tests, 11 isolated SQL Server groups and TypeScript checks passed. Merged tree equals reviewed797e3017. Postmerge Cloudflare beta build15239080 passed; installed runtime acceptance remains separate. Owner requests PR390 refresh/merge after checks and production354 preparation; no production merge or installer release authorized by this entry.

4 November OWN61 follow-up: normal local sync verified all22 ownerSTR1/all22cloudzero on exact POS_Local identity; total2169. No forcedlocalrepair/queueclear/checkpointreset. PR390 commits historicalartifact/tests/evidence only; merge does not executeSQL. Installedcheckout remains unverified.

## OWN61 — exact 22-product ownership repair applied; local adoption verified

4 November owner directed agents complete22productdifference investigation, exactDBchangesBEFOREapply. PrivatefreshSQLproof:22extra localproducts/0missingauthorizedIDs; all22cloudexist/nondeleted/ownerNULL/cloudSTR1stock0, stockmapONLYSTR1 key, all22STR1sales/nootherbranchsales. Local22versionsolder, no pendingproductjournal/nonCLOUDpostcheckpointedits. Capturedcloudavailability removesunownedzero product; pos_sync_pull thenreturnsNULLrow_data; native skipsNULLdata butcommitsfeedcursor, leavingstale localpositive quantities. Isolated actual-module reproduction confirms that failure path. 69tablefreshcountcomparison nowonlyproducts2169local/2147cloud; historicalother2 countnamesnotlogged andnotclaimed repaired.

Prepare ONLYowner_store_id NULL→STR1 on exact22 guardedfullbeforeimages/trigger+routine/schema/grantpins. Preservecloudstock/SKU/prices/archive/deleted flags andeveryotherproductfield exceptnormalrow_version/updated_at. Expectednormal22history+22globalproductfeed plus1honestmaintenanceaudit/1STR1auditfeed,23feedtotal; testsverifyingactualcapture. Afterapprovedrepair, normalguardedsyncwilladoptcloudzero locally andshow22inselectedbranchArchive; that expectedlocalquantityeffect mustbeshowninapproval. No cloudstockadjustment orforcedlocaloverwrite. Owner subsequently approved the exact repair. Applied SHA256 97A72C1B54D38ADA2BADD75B3617E446914AAFF69886AE15775D2341F3DB90FB after fresh preflight; cloud readback verified receipt1/owned22/visible22/unchanged-stock22/unchanged-other-fields22/history22. Global and STR1 catalogue counts both2169. Local normal adoption verified for all 22 owners and cloud zero quantities; no forced local overwrite.

Additionalrisk:1201cloudproductsownerNULL;1179currentlyvisible maylaterloseeligibilitywhenstockzero. TheseareNOTincluded22repair; requireseparateprovenanceaudit/exactapproval, notblanketownerassignment. Existingfutureproductownerpreservation/newcreationguards mustbereviewedforrecurrence. No scopebypass/harddelete/queueclear/checkpointreset/Membershipchanges. UIplacementPR388andNOOP60codescope remainseparate.
NOOP60 final prepared verification:11 actual isolatedSQLServer groups passed, independent136 regressions/1explicitnativeoptinskip passed, TypeScript/scopedlint passed. Effectiveassignmentguard uses DATALENGTH plusbinarytuple to distinguishtrailingNUL/case/space; destinationconversion TRY_CONVERT failureforcesoriginalassignment/error, stalerejectedsourceignored. Pending/tombstone/protectedshift/network/checkpoints unchanged. This is NOT zeroSQLstatements or zero statementtriggers. Ownerrequests all latesttestedcodeinGitHubPRs, eachreviewedseparatelybeforeproductionpromotion; candidate codepreparedbutnotdeployed.
## NOOP60 — owner-approved identical-row update correction/tests

4 November owner explicitly approved separate sharednative rowapply correction and isolatedtests: skipordinaryUPDATE ONLYwhen every effectivepersistedassignment isidentical. Preserveequal-versiondifferentdata repair, NULL/case/trailing/Unicode/decimal/time fidelity, pendingwrites, tombstones, refundMAX/ORrules, deviceallowlist, ownershipprotection, pos_settingscompanyfallback, protectedshiftgraph path and checkoutpermissions. Scopeexistingcloud-client.cjs+focusedrealSQLServer/concurrencytests; no schemas/live datarepair or feedomission. This reduceslocalrowwrites, NOTallnetworkdownloads orphysicalpoolconnections. Newcurrentbetabranch codex/sync-noop-updates-beta at5a6ac8bc. Preservestatementtriggers; do notclaimalltriggerinvocationsgonewhenMERGEupdateszero rows. Preparation/testingactive; no deploymentauthorizedbythisentryalone. MembershipONHOLD.
## INV59 / RECON58 — owner-directed inventory/reconciliation work

4 November owner explicitly requested agents find/fix remaining table differences and repeated downloads, with exactdatabasechanges presented BEFOREapplication. Also explicitly moves Total/Active/Archived counters to immediately ABOVE TABLE (notbottom/notabovecards), superseding earlierbottomplacement. Preserve branchArchive<=0 includingnegative warnings and authorizedcluster boundaries; do not expose unrelatedclusterproducts justtomatchassumed24xx count. Membershipunchanged.

Fresh SELECT-only evidence: globalcloudproducts2169; authorizedSTR1count2147; local2169. Both90/7300retention localmapsidentical; fresh69tablecloudcomparison hasONLYproducts difference, notall3historic counts; historicalother2namesnotrecorded. All2147authorizedIDs localpresent,22extra localIDs alsoexistcloud butowner_store_idNULL. Exclusionrootcause stillunderinvestigation; no ownership/datarepair authorized. Counterspaginatedloader includesnondeletedallstatuses, counts computedbefore search/pagination. Incorrectdiagnosticp.is_active columnqueryfailedread-only andcorrected; no schemafixneeded.

Approved UIimplementationisolatedbranch codex/inventory-counts-beta currentbeta5a6ac8bc: relocatecountercomponentonly. Agents review no-op ordinaryMERGE andcountscope separately; no broadstartupskip withoutfreshnessproof, noqueueclear/checkpointreset/schemachange. ExactfutureDBproposal requiresownerapproval.
NET56 final verification: 5078 broad tests passed/6 skipped; actual workerd graph test passed separately after a measurement-process timeout in the first broad run. All five expected diagnostic assertion failures corrected without weakening timeout/cause checks; 37 focused reruns passed. TypeScript, scoped lint and independent four-runtime-file review passed. Requests, retry schedules, permissions, queues and public result fields remain unchanged. Next: beta CI and local reload for real error-cause evidence. READ57 remains an audit/preparation outcome, not a claimed connection reduction.

## NET56 — approved diagnostic-only fetch-failure correction

4 November owner approved safe diagnostics/tests only: classify failed sync operation, fetch-vs-body stage and allowlisted network error/name, never URL/credential/payload/rawcause. Separate branch from beta342bee8c; preserve requests/retries/queues/checkpoints/permissions/checkout. CloudClient attaches only private safe evidence; coordinator retains it privately through error normalization; automatic log emits strict whitelist. Localfeed continued beyond134968 after genericfetchfailed, hostedrequestsaroundfailure200; actualrootcause notyetconfirmed becauseoldlogs omittedcause. No claim that diagnosticsalone repairsnetwork.122 focusedtests/6suites, TypeScript/scopedlint passed. Fullregression pending. No liveDB/configchange or extraAPIcall.
## READ57 — approved duplicate-count/status preparation; no runtime edits

4 November owner requested fewer unnecessarydatabaseconnections/work and approved isolatedpreparation/tests only. Separate beta342bee8c worktree; independentread-onlyreview found one coreleasealreadyserializespushthenpull, native/webtelemetrynotduplicated, statusJSsubscriptionsnotcloudDBpolling. Snapshot15:32Brunei:24client(1active23idle),1replication,2backgroundworkers=27processes;14PostgRESTidle includedinclients. LocalElectron2sessions. Idlepoolcountsare notterminalcountsor activequeries.

Potentialduplicatework: startupensure reconcile thenfirstautomatic15min verification; overlappingmanual/automaticcounts; simultaneouspendingstatusreads. Currentcode lacks complete local/cloud mutationgeneration and resultpublicationprofilefence. Therefore DONOT reuse completedstartupcounts, cachependingcounts orshareolderreadwithfreshmanual/postwritechecks. Serializationalone saveszeroqueries. No poolconfig/auth/syncschedule/data changes prepared. Safe proposal requires explicit advisory-snapshot freshness semantics plus immutable pool/profile/backend/terminal/branch/history identity and postawait/monotonic publication guard; manual/repair/closingfreshreads retained. Not implemented or claimed optimized. MembershipONHOLD. DiagnosticNET56 remains independent activebatch.
## FEED55 verified beta rollout — 4 November 2026

Owner-approved exact migration83495D696622241ECA2A8D396234E2FD65EE7C7A3050E93E4280638D6530D59B applied once to ROSEGILL/pos after allCI and freshsourcepreflight. Supabase tool ledger version20261104042158/nameprotected_byte_bounded_feed_download records approved sourcefile20261104040251; do not replay merely because ledger timestamp differs. Newfunction definitionMD5f7c8221574a065caf04d4b16c1344d0f; invoker/search_pathpg_catalog, service-only execute. Original pull/project definitions and ACLs unchanged. PR384 merged beta342bee8c6e5ca6f9eb2f67330dc712dcdca040af; deployed beta build cd80e42e-c826-4652-94b1-c237c1d05508 passed.

Updated Electron reopened from this checkout on local8085 using existing profile; owner signed in. Independent read-only verification sampled147 hosted /sync requests: all200/ok, no exceptions/exceededCpu. CPU min2/max114/mean9.469ms;27of147 above10ms. This is sampled shared-endpoint traffic, not proof every request is protected feed or belowFree10ms. Feed131613→133184 automatically (+1571); all sixshift CTcheckpoints remain valid. No new native sync error since restart in observedwindow. Existing publicbranch/global feed beyond132738 had23596records, so backlog is STILL DRAINING, NOT fully certified up-to-date. No queues/checkpoints reset, businessrows rewritten or operatorpermissions/configuration changed. Normal sync retains existing pending upload behavior; no test sale/stock movement. Main/production, installers, billing and Membership unchanged.

Pending: keep monitoring normal backlog completion; investigate further only if new errors or unacceptable CPU spikes recur. Strict all-request<10ms/cold-start acceptance remains unverified. Other productionPCs and newinstaller distribution are separate tasks. Historical preparation/pending paragraphs below describe their recorded stage and are superseded by this outcome.
## FEED55 applied and beta merged — verification in progress

4 November: all required CI passed for exact PR384 head38cd10ed2c6fcc05f73277397eb2501ebce95fd3. Fresh ROSEGILL/pos preflight confirmed newRPCabsent and original definition/ACL pins. Approved migrationSHA83495D...D59B applied once via Supabase migration tool; readback newRPC invoker/search_pathpg_catalog, anon/authenticated execute false, serviceexecute true. Both olddefinitionMD5andACL unchanged. PR384 merged beta at342bee8c6e5ca6f9eb2f67330dc712dcdca040af. Beta deployment/real sync+CPU acceptance pending; local updated Vite8085 and private read-only Worker tail started. No business rows, permissions/settings/queues/checkpoints rewritten. No main/installer/billing change. Do not declare hosted10ms success yet.
## FEED55 exact live/beta approval — 4 November 2026

Owner approved exact migration20261104040251 SHA83495D696622241ECA2A8D396234E2FD65EE7C7A3050E93E4280638D6530D59B for ROSEGILL→rosegill0011@gmail.com Org bjxgimekljzlnwejuawj→pos qhrufhtbeguxydenzfey/postgres, followed by PR384 beta integration/deployment and real sync/CPU verification ONLY AFTER finalCI and freshpreflight pass. No production/main, installers or billing changes. Read-only preflight confirmed newRPCabsent and bothsourcepins exact. Independent hash/scope review passed. Live application is still pendingCI; do not infer application from approval.
FEED55 preparation verification: full suite5031 passed/4 skipped (643 suites passed/1 skipped), TypeScript and scoped lint passed, web/Cloudflare production build passed. SQL17 isolated scenarios and5 actual PostgreSQL/PostgREST groups passed; native20 continuation tests and existing real Operations authorization workflow passed. Actual workerd protected1.97MB warmmean3.906ms vs legacy10rows416.667ms; firstprotected31.25ms is NOT hosted/billed/cold10ms certification. Independent SQL/native/wire review found no blocker. Exact proposed migrationSHA83495D696622241ECA2A8D396234E2FD65EE7C7A3050E93E4280638D6530D59B. Live application/deployment remains NOT authorized. No operator data, permissions, queues or settings changed. Generated logic report and CLI .temp excluded.
## FEED55 — approved CPU correction preparation and isolated tests

4 November owner approved preparation/tests only after confirmed beta Worker exceededCpu418ms/HTTP503. Separate current-beta branch codex/sync-feed-cpu-beta at e6af19de; no deployment/live edits authorized. Preserve checkout, permission/branch checks, complete feed history, monotonic cursors and operator config; Membership unchanged.

Read-only feed cursor131613 next100 candidate metadata shows20 pos_settings references to the same current1,238,098-byte row (~24.76MB),19 settings_scoped (~0.60MB),45 small audits plus telemetry/terminal rows. This independently explains a large ordinary-feed processing risk; exact failed-operation request correlation remains limited because shared endpoint logging omits operation. Prepare service-only bounded feed RPC delegating unchanged current read validator/source selector and reviewed privacy projection; contiguous prefix2MiB, bounded singleton5MiB, exact bytes/rowcount/continuation attestation. Worker buffers through EOF without JSON rebuilding. Native Main-private continuation metadata preserves partial-page retry/drain semantics; legacy behavior preserved. Only exact missing-RPC404PGRST202 or explicit400/P0001/POS_FEED_STREAM_UNSUPPORTED_SOURCE permits old guarded path; other errors fail closed. Test SQL/PostgREST privacy/branch-denial/cursors/tombstones/largepages and actual Worker CPU; do not claim10ms success before measurement. Any live migration requires exact-project/file approval.
## LOCAL54 verified recovery completion — 4 November 2026

Root and independent agent verified all six shift push checkpoints automatically recovered after the approved repairs: shifts12070, counts12087, events12088, notifications12088, reconciliations12097, variance alerts12112. Every checkpoint is >= minimum valid2916 and <= observed current12124. Exact POS_Local server/GUID reconfirmed. No manual reset/queue clearing. All 18 retained local graphs matched the reviewed cloud source, then normal download populated all28 cloud shifts. Local Electron reopened Ready. Native failure log contains no new entry since the pre-repair restart; historical notifications may remain as history. This verifies the reported local shift CT-gap condition, not an assertion that all installed production or offline workflows are certified. Runtime correction PR382 is merged beta. Repair artifact/evidence PR383 CI remains separate; no main promotion, installer publication or Membership changes.
## Verified execution — 4 November 2026

Owner approved these exact local repairs and confirmed Electron closed, no unsaved checkout and no concurrent schema maintenance. Both guarded artifacts applied to the pinned POS_Local identity. Readback verified three summary targets and one receipt, plus fourth CLOSED revision 3 with seven existing children and one receipt. Lossless comparison found all 18 retained local graphs equal to the reviewed cloud snapshot under both privacy projections, with no orphans. PR382 merged beta at e6af19de. Electron reopened Ready; automatic recovery is advancing through existing checkpoints. Full recovery completion remains under observation. No stock/sales/permission/configuration edits, queue clearing or manual checkpoint reset. The preparation text below records the approved design, not current execution status. Private package stays ignored; its preparedOnly manifest is an immutable artifact descriptor, not a live authorization registry.
## LOCAL54 execution update — 4 November 2026

Owner approved fixing both exact local differences and sync recovery, then confirmed Electron closed, no unsaved checkout/cart work and no concurrent database/schema maintenance. Root verified no Electron processes. Fresh four cloud graph texts exactly match reviewed source. PR382 passed all required CI and merged beta at e6af19de01c7abb20b9306fdae7ba9b94e84afa6; no main promotion or installers.

Three-shift exact D5A11AC4C5152677100276EAEFF7412F53579B164834E1A0FF9A48EFEFFBCE90 repair applied to verified POS_Local. Independent readback: three complete targets and one maintenance receipt. Fourth exact 9201D1168853154DBCBC008CAF6DCD3383E6ADA8210ECC93770C69C98F4F6837 independently passed all 20 native groups; application/readback and complete Electron recovery remain pending. No manual checkpoint reset, queue clear or permission change. Membership remains ON HOLD.
# POS task tracker

Last reconciled: **2026-11-04, Asia/Brunei**.

4 November integration status: STARTUP51 (PR379) and verified cloud-repair documentation (PR381) are merged into beta. RECOVERY53 has 4,977 passing full-suite tests plus 16 real SQL Server recovery groups; both real SQL Server/API/isolated-PostgreSQL closing workflows pass, including OPEN acknowledged before offline closing. The owner-requested local restart loaded the integrated source at port8084 with saved STR1 registration and cashier list. Hosted RECOVERY53 deployment and historical local repairs are not yet complete. LOCAL54 now has three closed-summary repair preparations and a separately approved fourth stale-OPEN adoption plan; no live local repair has run. The historical preparation/status paragraphs below remain evidence for their recorded stage, not current completion claims.

## RECOVERY53 — approved local retained-shift recovery preparation/tests

Owner subsequently requested restarting local Electron after code changes. This
authorizes a tested local-development relaunch with the existing profile, not a
live data repair, forced process stop, hosted deployment or installer release.
Preserve the already approved startup-progress UI from PR379 when integrating
native recovery; do not launch older renderer behavior from a beta-only checkout.
Require normal shutdown and preserve registration, SQL settings, queues and all
checkpoints. If normal exit is blocked, obtain approval for the exact dev process.

Prepared and independently reviewed; NOT applied to the running app or database.
Root verification: final full suite passed 639 suites / 4,961 tests (one suite
and three tests skipped), TypeScript passed, scoped ESLint had zero warnings,
and 83 additional native startup/sync/shutdown regression tests passed. Actual
isolated SQL Server acceptance passed 16 groups with fixture cleanup. Workerd
wire/privacy/authorization tests, actual Vite SSR, and Electron 44.9.1 ASAR/Main
helper loading passed. Cloudflare and Windows production builds passed locally;
existing Vite config/directive/Wrangler warnings remain. Build-generated route
and logic-report changes are excluded. Initial broad testing found one older
VM fixture import failure; three affected fixtures now load the real shared
helper and preserve assertions. The final full suite passed after correction.

Exact proof is optional and limited to complete responses up to 32 KiB. Larger
graphs keep complete ordinary privacy-filtered downloads without the proof
header; nonfinite numbers/negative zero also preserve legacy ordinary behavior.
No rows are omitted. Local workerd process CPU averages were about 2–5 ms for
small fixtures and 14–16 ms for a 2,000-row ordinary fallback. These are not
hosted billed CPU/cold-start acceptance; maximum-request Free-plan performance
remains unverified. Do not advertise unrestricted automatic recovery or a 10 ms
hosting guarantee.

The live app remains on the earlier source. At 10:05 Brunei its retries still
pass download and fail local apply with ELOCAL_PENDING_UNVERIFIED. Preparation
alone does not change that loop. Three known differing local graphs stay held;
an exact local reconciliation and deployment need separate review/approval.
No live SQL repair, manual checkpoint reset, queue clear, installer publication,
Membership change or production promotion was performed in this batch.

Integration follow-up: PR379's startup-progress source is still separate and now
has documentation conflicts with newer beta; preserve both intended changes
when reconciling. PR381 records the verified SHIFT52 outcome. Do not overwrite
those newer records with the historical preparation notes below.

Owner separately APPROVED graph-only server/client precision extension and
isolated tests4November. Read-only investigation proves two JSON rounding sites:
hosted sync-endpoint parses PostgREST then serializes redacted graph; native
cloud-client parses again. Actual6table money columns are unbounded numeric;
even648.00000000000000000001 can become648, so safe-integer checks alone do not
prove equality. Scope now includes sync-endpoint.server.ts, cloud-client.cjs,
necessary shared losslessJSON/helper/redaction compatibility and focused tests.
Preserve ordinary parsed values/requests/auth/error behavior and exact existing
privacy traversal; add only graph-local bounded lossless serialization and Main-
private comparison witness. NoRPC/schema/dependency/permission/live-data change,
checkpoint reset or deployment. Test duplicatekeys/rawstringlookalikes, large/
fractionalnumbers, timestamps, malformed/oversized/deepJSON, privacyparity and
actualhostedruntime capability/CPU. Fail closed on unsupported precisionproof;
never forward raw unredacted graph or use collision-prone string replacement.

Compatibility requirement: older hosted builds round numerics before sending,
so exact native parsing alone cannot prove original precision. Only a successful
new graph-only lossless response may advertise an explicit capability header;
native proof must require the known header version from the fresh authenticated
response. Missing/unknown header preserves ordinary graph behavior but cannot
enable expiredCT proof. Body/request flags are not authority. Bind private raw
witness to unmodified parsedgraph/token/scope; no capability on errors/other
downloads. Verify actual devSSR, bundledWorker and Electron module loading;
prefer a selfcontained ESM sharedhelper over widening global build interop.

4November owner approved shared native shift-download guard correction and
isolated tests only. No live localSQL repair, manual checkpoint reset, queue
clearing, permissions or deployment. Baseline currentbeta4590d63b; branch
codex/local-shift-recovery-beta. Root owns docs/integration; writer assigned
runtime/tests after independent design; second agent reviews.

Cloud SHIFT52 is applied/verified and all27STR1graphs validate. Local apply now
holds ELOCAL_PENDING_UNVERIFIED: all6graph checkpoints2881<minimum2916,
18retainedshifts(17closed/1open),zero pendinggraphjournal/intents,zero durable
graphbaselines/anyshiftintents;3closedlocals have missing summaries. These are
read-only observations, not permission to trust queues or overwrite divergence.

Approved conservative design: use fresh authenticated/strict validated complete
cloud graph plus transaction-locked full6-table local graph. ExpiredCT exception
only for exact no-op match of ALL facts/rowsets, scoped branch+shift+token, after
pending/orphan/deleted journal and unacknowledged-intent denial. Lossless numeric
and timestamp comparison; global sameRow precision must not be weakened. Do not
trust local baseline/receipt metadata alone or add renderer force/ignore flags.
Existing validCT and empty-new-graph paths stay intact; no business writes for
this exception. Existing postapply exactreadback/adoption/immutablehistoryguards
remain. Any divergence/missingorlocalonlyhistory/unknown deletion stays held.

Wholebranch coverage is mandatory before normal completion checkpoint advance:
capture retained graph identities and a valid V0; prove every retained graph,
including localonly/orphan rows, and revalidate membership/concurrent edits under
finaltransaction with validCTsinceV0. Never mark whole table recovered from a
subset of matching cloudpages. Files may include change-reader,shift-graph,
small lossless proofhelper,lifecycle/bootstrap and focused tests. Preserve all
author,checkout,branch,offline,queryprivacy and Membership boundaries. No live
execution. Isolated nativeSQLServer tests must use only uniquely owned fixture
databases, never POS_Local. Matching proof may not resolve this PC's3divergent
summaries; document holds and prepare a separate exact local repair only after
review, not implicit approval under this batch.

4 November beta refresh: preserve both STARTUP51 and newer SHIFT52 records.
The exact approved SHIFT52 cloud repair has since been applied and verified:
one audit, two feed entries, unchanged saved web closing/counts/children, and all
then-27 STR1 graphs valid. PR380 merged beta4590d63b. Earlier held-original-PC
requirements below are historical and superseded for the selected web closing.
Local retained-history recovery and its separately reviewed data differences
remain distinct; do not claim startup progress alone repairs them. PR381 records
the detailed live outcome. This refresh changes no STARTUP51 runtime behavior.

## STARTUP51 — approved truthful startup progress and native-owned retry display

Implementation and isolated verification: native activity reports preparation,
download, committed local rows, upload and validation without starting additional
work. Author validation passed168 tests across12 suites; independent review
passed96 tests across5 suites. Root rendered the actual Windows NativeBoot and
TillLoader with an isolated fake bridge (no POS API/data) at1280px and390px:
phase/count changes, temporary wait, permanent shift blocker and manual pause
display correctly; no premature Try again appears during sustained active work.
At390px document and viewport widths both equal390 (no horizontal overflow).
Ready workspace stays open when later progress arrives. The fixture recorded
one initial database status read, zero sync status reads and zero job reads
through all activity changes. This proves component/subscription behavior,
not live SQL recovery or installed-device acceptance. Final lint cleanup,
exact-head CI, beta integration and actual Electron relaunch remain separate.
No database/configuration changes, queue clearing or process restart occurred.
Rollback is a targeted revert of this progress-only patch, preserving later
unrelated changes. The unresolved original STR1 closing remains separately held.

Final local validation: scoped ESLint0 warnings/errors, TypeScript and diff check
pass. Full Node22 Vitest run passed633 suites /4,904 tests (1suite and2tests
skipped),92.28s with maxWorkers4. Owner then requested reopening latest Electron:
old development process29296 exited through normal shutdown; no forced stop.
Latest worktree Windows Vite is running at127.0.0.1:8083 and native Main PID34328
uses this source. Actual window Register — Retail renders that URL, saved STR1
branch and cashier list. No login/checkout transaction was automated. This
verifies launch/registration display, not a fresh administrator login or complete
shift recovery. Existing profile, SQL settings and checkpoints were preserved.
Exact-head CI and beta merge still require separate recorded results.

Read-only design refinement: progress-only notifications must use a dedicated
native activity event (optional preload subscription), not ordinary database
state broadcasts. Existing public-flags listeners retry reads on database events
when flags have not loaded; do not modify those Membership/shared dependencies
or multiply their queries. Initial getState may include sanitized activity;
ordinary database transitions/logs remain unchanged. Prefer Main-window-only
activity delivery and test no generic database publish or remote reload occurs.

Owner requests actual downloading/uploading/loading status while the workspace
opens, with automatic retry rather than a premature Try again/reload button.
Baseline beta16db48d7; branch codex/startup-live-progress-beta. Agents audited the
Windows gate and shared TillLoader: an unconditional12-second fallback appears
during active work and defaults to renderer reload. Existing Main retry loops
already own Operations retry/single-flight and Management backoff; do not create
a second renderer retry loop or auto-call manual retryStartup (which resets
Management retryAt and repeats schema work).

Implement a small sanitized read-only native activity signal, actual preparation/
download/local-apply boundaries, and existing job/sync progress observation with
stale-initial-read protection. Windows gate opts into controlled loader states:
no generic timeout retry while native work runs; show actual phase/table and
committed records where available, indeterminate progress when totals unknown.
Keep temporary retry display tied to existing native scheduling. Respect manual
pause, offline/authentication conditions and permanent data/schema/proof errors.
Show confirmed SYNC_SHIFT_GRAPH_CONFLICT as blocked, not endless fake loading.

Preserve desktopStorageRoute/sticky readiness, scope/cache proofs, Management
authorized scope/backoff, checkout, permissions and Membership/shared dependencies.
Do not change retry delays, API requests, queries, transactions, schemas, saved
configuration, queues/checkpoints or terminal identity. Other TillLoader callers
retain their existing defaults. Tests: real rendered active>12s, phase/count
updates, stale IPC/events, no duplicate retry, pause/permanent blocks, cleanup,
readiness/checkout and Management boundaries. Use isolated fixtures, no real sale
or stock actions. Root owns tracker/integration; one agent owns runtime/tests and
another independently reviews. Existing eighth STR1 repair remains blocked by
unavailable original PC; do not silently adopt the later cloud web closing.

## SHIFT52 — saved web closing selected; one-shift graph repair preparation

VERIFIED CLOUD OUTCOME4November: owner separately approved exact SHA
3745EE19DCBA22F34B8ECA5395201F35CE2D88A8C736984F1745CB4BCED94650
afterCI/freshpreflight. AllrequiredCI passed on be7c4d29567903a80de6ac60ceac6786b6ef11dd;
preflight matched exact parent/graph/count/reconciliation hashes, version5 and
zero repair audits. Root executed that immutable artifact once on ROSEGILL pos
qhrufhtbeguxydenzfey. SELECT readback verifies version6, approved five values,
unchanged opening/closing/counts/children and all other parent facts, exact audit
before/after and owner-selected web authority, one audit and two normal feed
entries (shift update6, audit insert1). All27STR1graphs validate. PR380 merged
to beta4590d63bcff91836975f1d597c4bc8d7c6049c43. This supersedes earlier held
eighth/original-PC prerequisite; selected saved web closing is authoritative.

LOCAL ACCEPTANCE STILL BLOCKED: next automatic retry01:21:57UTC passes download
but fails local_apply with ELOCAL_PENDING_UNVERIFIED. This is distinct from the
resolved cloud P0001. SQL SELECT confirms all6graph push checkpoints2881 below
minimum2916 (current11855),18retained shifts(17closed/1open),zero pending shift
journal rows and zero unacknowledged shift intents. No checkpoint reset. Source
review confirms expired CT plus any retained graph blocks adoption even if rows
might match cloud; empty queues do not prove no legacy edits. Next proposed
batch: read-only scoped full-graph/baseline comparison and guarded recovery
preparation/tests, preserving divergent/pending/unknown work. Obtain scope
approval before shared-sync implementation. Do not claim complete local recovery,
original-PC adoption, checkout acceptance, production or installer publication.

Prepared SQL SHA256
3745EE19DCBA22F34B8ECA5395201F35CE2D88A8C736984F1745CB4BCED94650.
Root reviewed the scope; independent reviewer passed72 actual native PostgreSQL
scenarios and diff check, with owned disposable fixture stopped/removed. Guards
cover changed/busy records, forged or altered replay receipts/authority, ignored
updates, audit rollback and preservation of unrelated shifts/stock/sales. Normal
effects verified: one row's five summaries, version5→6/updated_at, one maintenance
audit and two feed entries, unchanged counts/time/children. Exact live approval,
fresh preflight, execution/readback and actual local recovery remain pending.

4November owner explicitly superseded the earlier original-cashier authority
choice: keep the saved1November web closing and prepare/test a one-shift repair.
Priority is graph validation and subsequent download; do not assume original-PC
pending uploads recover automatically when it powers on. Approval covers
preparation/isolated tests only; exact live artifact/project approval remains
required before writes. Baseline beta16db48d7; branch
codex/web-shift-summary-repair-beta. SQL agent owns artifact/tests/plan,
independent agent reviews; root owns tracker and project memory.

Target STR1 shift1a349429-cea1-4f45-8d2b-36678d37ad27, row_version5, saved
closing2026-11-01T13:38:37.207159Z. Existing reconciliation supplies only missing
parent expected_cash648,expected_card123,expected_digital472,variance_cash0,
variance_total0. Parent fingerprint996d4f3d74e9d7704fb68403f0818d1b; full graph
fd55a0dbab4401786c7f801407330bb4. Root SELECT-only in-memory candidate passes
the existing strict validate_graph helper with children unchanged. Candidate
graph fingerprint49d753292cc47b33c52c88645dccc3ad before normal trigger versions.
Preserve counted amounts, time, children, original/web audit evidence, stock,
sales, author/permission guards and current drawer. Exact before-image guards,
locking, whole-transaction rollback, replay verification and normal audit/feed
effects must be tested. No checkpoint reset, old-PC queue reset, forged proof,
legacy #359 replay, Membership or production promotion. No live mutation yet.

Root fresh read-only parity: all10 actual user triggers match captured exact
definitions/enabled state/raw body hashes; both graph helper bodies, owners,
flags and settings match the reviewed baseline. Replacing only the candidate
held parent fields in query memory makes all27STR1graphs validate using the
existing validator with p_closed=false (closed records still require consistent
closed graphs; current open records remain valid). Held candidate separately
passes p_closed=true. An initial all-branch p_closed=true diagnostic correctly
rejected open shifts; it was not evidence of another bad closed shift. No rows
were written by these SELECT checks. These are candidate validation results,
not executed repair, successful download or native adoption proof.

## SHIFT49 — seven repaired and verified; eighth blocked

Latest verified outcome: corrected SHA256
95F35B0C2467301326CF2980533EAE3466AA6903338D1955401C77EB45679B83
was applied to the exact approved ROSEGILL pos qhrufhtbeguxydenzfey target after
all required CI passed on b8b7be605aa590b55a97f9bc433748e54590bcc7. Seven
closed shift graphs now pass strict live validation. Independent SELECT readback
confirmed exact before/after audit pairs, version+1, only five summary fields
plus normal updated_at/version changes, unchanged child graphs and other parent
facts. Seven audit entries and seven shift/seven audit sync-feed entries exist.
Feed entity_id is a JSON identity object, not a bare UUID; readback must match
jsonb_build_object identities. No repeat repair was needed.
Held shift 1a349429-cea1-4f45-8d2b-36678d37ad27 full graph fingerprint remains
fd55a0dbab4401786c7f801407330bb4, with no repair audit. All other26 branch
graphs pass strict validation. The eighth original-cashier-PC authority/adoption
work remains blocked because that PC is unavailable; do not claim full recovery.
PR375 merged to beta8ab8e3871de9dab71d07a069f7c69c69748441c8. No production
promotion or installer publication. Local Electron is open, but returned to
sign-in during post-repair inspection; owner login requested. Do not treat its
old warning or zero journal count as current end-to-end sync completion.
The earlier preparation/abort records below are historical evidence, superseded
by this verified seven-row outcome; they do not describe current execution status.

Local post-repair verification: SQLCMD SELECT-only checks confirmed
LAPTOP-N0QBONGL\LCRPOS / POS_Local, completed history recovery20799 rows and
bootstrap17432 rows; history checkpoint11569 remains above minimum2916.
Shifts checkpoint2881 remains below minimum2916; no checkpoint was reset.
Electron first showed sign-in, then Opening your workspace with central and
local SQL connected. The latest available automatic-failure logs predate the
repair, so do not claim a fresh successful recovery cycle or that local replicas
have adopted all seven repairs. The remaining held graph would still fail the
strict download validator. Owner login/status inspection was requested; existing
pause state, queues, registration and SQL settings were not changed.

Owner renewed exact approval for corrected SHA256
95F35B0C2467301326CF2980533EAE3466AA6903338D1955401C77EB45679B83
on ROSEGILL pos qhrufhtbeguxydenzfey after final CI and preflight. The owner
also requested checked beta integration and local Electron verification.
Immediate read-only preflight: all seven parent/graph fingerprints match,
repair audits zero, all ten exact trigger pins match. No historical write yet.

Exact F202 execution attempt aborted at the trigger fingerprint guard before
any updates; root verified zero repair audits. Captured trigger body_md5 was
normalized while the guard compared raw prosrc bytes. Prepare exact raw-byte
pins and tests without weakening the guard. Changed artifact requires renewed
exact approval; no repeat live attempt is authorized by the old hash.

Corrected raw-pin artifact SHA256
95F35B0C2467301326CF2980533EAE3466AA6903338D1955401C77EB45679B83:
seven trigger source fingerprints changed to exact raw captured CRLF bytes;
three audit fingerprints unchanged. No guard normalization or runtime behavior
change. Previous 47-scenario native harness substituted fixture-computed pins,
so it did not prove production pin parity; that acceptance claim is superseded.
Normal cases now retain the production trigger list verbatim, preserve exact
source bytes through server-side escapes, and test source/hash consistency,
normalized-pin rejection and changed-raw-body rejection. Final 68 PGlite and
69 native scenarios passed; Vitest bridge 2/2, ESLint and diff checks passed.
Native owned-LQk5me stopped/removed. Root SELECT-only live parity confirmed all
ten exact raw hashes/definitions/enabled flags true, and all eight original
parent/graph fingerprints unchanged with zero repair audits after abort. New
historical execution remains pending renewed exact approval and CI.

Owner separately approved exact seven-row artifact SHA256
F202F0D99EBF1BE668A4255B7207F94D47477E24E3E211C7D6943D13DD3B4557
on ROSEGILL pos qhrufhtbeguxydenzfey ONLY after final CI and unchanged live
preflight. Historical execution has not occurred. Eighth STR1 remains excluded.
Windows launcher normalization preserves CRLF marker extraction; both LF/CRLF
copies passed46 scenarios. This test-only correction does not change SQL bytes.

Historical preparation extension: owner requests the underlying recovery error
resolved. Prepare an exact seven-row, five-NULL-summary repair and isolated
tests; execution still requires separate exact approval. Root refreshes live
fingerprints first. Preserve all existing facts, normal triggers and graph
guards, append before/after maintenance audit, roll back on any mismatch or
invalid full graph. Held eighth STR1 original-authority repair remains excluded;
its original private evidence must be recovered or recaptured. This supersedes
the earlier plan-only/no-executable-preparation boundary, not live approval.

Future-write live correction separately approved and applied by root: immutable
FF8FC4BBA96CB68274E973557107F6F13809A4D825308613AD59CE6750B24056 migration;
readback body de87d75592ce3fe5872de90b4be9a466, OID22248 and existing owner,
ACL, arguments and flags preserved. This did not modify historical rows.
Prepared seven-row maintenance artifact now passes 46 PGlite scenarios and
47 actual disposable PostgreSQL scenarios, including real two-session NOWAIT
contention, whole-batch audit/late-graph rollback, legitimate replay and forged
valid-graph replay denial. All ten captured real triggers remain enabled:
seven parent versions increment once; updated_at changes normally; seven audit
rows plus fourteen normal feed entries (seven shifts/seven audit). No activity
notification, count, timing, stock, sale or held-eighth change. Native fixture
owned-GDpLtG stopped and removed. Live historical execution remains unapproved;
affected original PC is unavailable, so complete eight-graph recovery is blocked.

Preparation verified: 89 isolated SQL scenarios and 27 focused Vitest tests
passed; scoped ESLint and `tsc --noEmit` passed. Guarded migration
`20261103105157_preserve_shift_reconciliation_parent_summaries.sql` changes
only seven already-computed parent assignments. This future-write migration was
subsequently separately approved/applied as recorded above; current historical
shifts recovery remains blocked. Historical proposal is
[the guarded seven-row repair plan](database/shift-reconciliation-summaries-repair-plan.md),
explicitly excluding the eighth held STR1 authority repair. Historical mutation
is prepared only, not applied. Synthetic tests do not verify live recovery.

Owner explicitly approved preparing and isolate-testing a separate correction
after read-only diagnosis of the new shifts gap. Baseline beta290ef2c5; branch
codex/shift-reconciliation-summaries-beta. Native SQL agent owns migration/source/
tests; independent agent reviews; root owns records and live approval boundary.

History recovery completed20799rows18:32:51Brunei. Local shift checkpoint2881
is older than SQL minimum2916. Scoped shift recovery currently fails server
SYNC_SHIFT_GRAPH_CONFLICT (validate_graph line38), before local apply. Cloud
branch27shifts/25closed;8 have valid closed headers and one consistent ORIGINAL
count/reconciliation each, but five parent derived fields areNULL. Existing
shift_reconcile_now inserts the reconciliation and omits expected_cash/card/
digital plus variance_cash/total in parent UPDATE, so future closes can repeat it.
Counts/linkage/finite/nonnegative/2dp/variance math flags all validated read-only.

Prepare only atomic persistence of all seven already-calculated derived fields:
expected_cash/card/digital and variance_cash/card/digital/total. The five NULL
fields explain the observed eight failures; the same omitted card/digital variance
assignments must also be preserved for applicable counts. Keep
all calculations, cashier/admin authorization, counted facts, dates, stock,
checkout, graph validation and author protections unchanged. Use reviewed guarded
additive migration and canonical parity plus allow/deny/retry/rollback tests.
Any live routine change requires separate exact-project/file/hash approval.

Prepare historical repair PLAN only. All8 IDs/facts are read-only evidence;
the held31OctoberSTR1 shift1a349429-cea1-4f45-8d2b-36678d37ad27 is among them.
Its original cashier authority (#359) is still HOLD and cannot be overwritten,
normalized implicitly or made authoritative from the later web closing. This
development SQL has no row for that held shift; original copy was another PC.
No historical shift repair, checkpoint reset, closing change or stock edit is
approved. Present exact proposed affected rows/fields and authority separately.
Startup48 remains a separately approved native readiness correction; it must
not bypass this operational graph conflict to clear a loading screen.

## STATUS50 — approved retry-status stability correction

Live acceptance follow-up: PR376 merged into beta59f218ba after all required
checks passed. Owner approved restarting only verified development PID24800
after normal shutdown hit ECHANGEGAP; reopened PID29296 with the same profile.
Owner signed in; local SQL/schema remain Ready and central is Reachable.
Actual alert now retains the error but repeats identical text for two unresolved
work scopes. Within the approved status correction, deduplicate presentation
only, retaining every scope and credential flag until matching success. Add a
regression proving one scope's success cannot hide the other's shared message.
Branch codex/retry-warning-display-beta starts from beta59f218ba. No database,
checkpoint, request, retry timing, checkout, permission or Membership changes.
Underlying SHIFT49 graph conflict remains unresolved; do not claim full recovery.
Follow-up passed57 retry/summary tests independently and exact one-line runtime
review. UI observations retained the same alert through automatic retry failures
at19:35:43 and19:36:55Brunei; no disappearance observed in sampled states.
This is sampled installed UI evidence, not every-frame recording or successful
recovery. Normal SQL/schema stay Ready, central Reachable. No shift data repair.
Deduplicated text still requires CI/beta integration and a new native reload.

Owner explicitly approved this separate code/test batch on 3 November after
read-only reproduction: SyncCoordinator clears lastError at each retry start,
making the unresolved shifts ECHANGEGAP warning disappear and reappear. Preserve
unresolved warnings while displaying retry progress; clear only after a relevant
successful pass. An unrelated branch/direction or activity-excluding success must
not imply recovery of an earlier failure. Pause/offline behavior remains truthful.
Baseline origin/beta290ef2c5; branch codex/retry-status-stability-beta. Scope is
coordinator status, existing summary presentation and focused isolated tests.
No requests, retry schedules, queues/checkpoints, auth, checkout, operator settings,
database records or Membership behavior may change. Owner subsequently approved
PR376 CI corrections, beta merge after checks, local Electron reload and runtime
flicker verification. Production, installers and live database repair stay separate.
Implemented in coordinator error bookkeeping and existing summary presentation;
no worker request or result semantics changed. Passed108 focused/dependency tests
across7 suites, scoped ESLint, TypeScript and diff checks. Independent review
reran56 tests and reproduced then cleared dual-failure and auth-warning issues.
Tests cover failed retry stability, matching direction/branch success, runFinal,
activity/deferred scope, pause/offline and preserved authorization warnings.
Actual installed UI, CI, beta integration and runtime reload remain unverified.
Rollback: revert this scoped commit; no data/configuration rollback is required.
Actual shifts CT/graph conflict recovery is separate and unresolved.


## STARTUP48 — approved cached-snapshot startup correction

Owner reports Electron stuck on Preparing local store data despite8081 HTTP200
in110ms/22ms and connected SQL. Owner explicitly approved focused native startup
correction and isolated tests (about6 runtime/status files plus tests), preserving
checkout/auth/permissions and first/incomplete/restore/scope-mismatch gates.
No database/configuration changes are authorized. Membership remains untouched.
Baseline origin/beta290ef2c5; branchcodex/startup-cache-readiness-beta. Author owns
runtime/tests; independent agent reviews; root owns records and any live action.

Confirmed source: schema-only tradingReady is not complete-data proof; NativeBoot
correctly waits while enabled_bootstrapping. Any active job blocks cached readiness,
including a non-operational history recovery. Previous Main catch unconditionally
marked ready on preparation failure, so failed recovery appeared faster than a
successful long recovery. Do not reuse that fail-open path or reorder schema-ready
ahead of the gate.

Proof must require validated connected current pool/profile, a completed scoped
bootstrap marker, local branch row, valid current history job identity/depth/backend
and no other active or newer unresolved destructive bootstrap/restore. Inspect all
jobs rather than TOP1. A new history-only exemption also needs read-only operational
CT validity checks so another expired operational table is not hidden. Apply that
extra preflight only to the NEW exemption; preserve ordinary completed-cache offline
opening behavior. Main failure handling must not invent readiness from schema or
malformed/foreign-scope failed history. Include restore/readiness invalidation if
needed within approved native startup/status scope; no frontend/auth bypass.

Actual read-only SQL metadata now verifies completed bootstrap_7300 for current
brancha611a328-2217-4d77-944a-5f6a637d123b,17432rows,9Oct2026. History recovery on
samebranch/depth7300 completed20799rows at18:32:51Brunei, hr:final:9429. Current
failure advanced to shifts ECHANGEGAP: HTTP400/P0001 SYNC_SHIFT_GRAPH_CONFLICT,
server validate_graph line38. This requires separate read-only graph diagnosis;
do not reset checkpoint, bypass protection, close/correct shifts or execute held
STR1/#359 repair. Startup patch must not falsely promise to resolve that conflict.

Acceptance: allowed complete same-scope history-only background case; denied first
bootstrap/force-full/restore/incomplete/malformed/foreign backend/terminal/branch/depth;
multiple active jobs and newer failed destructive jobs; profile/pool race; other
operational CT gap denies NEW exemption; ordinary cached offline use preserved.
Test actual lifecycle/boot error boundaries and relevant checkout/permission paths.
Implementation prepared in four native runtime files, with focused regressions.
Full-suite run: 4873 passed, 2 skipped; one wrapper asserted 16 native cases after
the harness gained its 17th case. Updating that assertion passed the focused test.
Additional acceptance: 96 focused tests, 20 native tests, six disposable SQL groups,
TypeScript and independent review passed. No live data, configuration or Main
restart has occurred for this patch; actual startup and the separate shift graph
recovery remain unverified. Exact-head CI and scoped integration remain pending.

## PROJ47 — confirmed post-deployment history projection timeout

PR371 and PR372 are merged on beta0be4da49. Owner approved and root applied
exact STREAM46 migration SHA25654A39A26...8BC4E91 to ROSEGILL pos
qhrufhtbeguxydenzfey; service-only/invoker/source-pin readback passed and existing
bootstrap fingerprints were unchanged. This is not full sync acceptance.

Local Electron is open at8081, existing profile preserved. SQL is ready and
journal pending dropped3 to0, without cloud-row readback. History download fails.
Correlated native17:04:24Brunei and exactWorker5a2b6549 event show HTTP500,
CPU6ms/wall9365ms, PostgreSQL57014. Read-only unified logs09:03–09:09UTC confirm
14 failed protected-page RPCs, each timing out in recursive projection line44
then page line35. The newly introduced per-key JSONB concatenation is the
confirmed hot path; previous large-string tests missed structured width.

Metadata-only shape inspection (no business values returned) found old/new each
824670JSONbytes, root9keys, noarrays, nested widestobject57899keys. Prepare a
targeted replacement of projection construction using set aggregation and safe
scalar fast paths. Preserve exact privacy/overflow behavior, page/cursor rules,
permissions, grants, timeout limits, stock, checkout and every history row.
Baseline0be4da49, branchcodex/history-projection-performance-beta. SQL agent owns
new corrective migration/canonical/test files; independent agent reviews parity
and actual native-PostgreSQL structured benchmarks. Root owns records/approval.
Require the existing994 cases plus matching-width old/new synthetic records,
structured arrays and real PostgREST tests under the existing deadline. Never
raise timeout or omit history to pass. No corrective live DDL is approved yet:
present the exact new migration/hash/target separately before applying it.
No Membership, operator setting, queue/checkpoint reset or production promotion.

Temporary containment: the existing local app runtime Pause was applied at
17:22:35Brunei and verified17:22:51. Only future automatic synchronization in
this development instance is paused; SQL connected/schema ready9ms, journal0.
No persistent configuration, SQL data, queue or checkpoint changed. Keep app
open and explicitly Resume only after corrective SQL readback/acceptance.
Metadata-only scalar types in the wide object are57896strings+3booleans.
The first set-aggregate candidate passed small parity cases but still failed a
ten-wide-row actual PostgREST request under8s. It is rejected, not a live fix.
Continue testing safe leaf-container fast paths plus full-page deadline and
numeric/privacy parity. No live timeout/compatibility flag increase is allowed.

Final reviewed candidate replaces only the privacy helper implementation using
typed scalar/container handling, safe leaf fast paths and one merge of changed
children. It reuses unchanged nested objects instead of rebuilding parents.
Normalized new body MD5a5be97695f3e105ebde271e2f017ddee; prerequisite old body
e43c47701fcda3776828f3759361d386. Unknown body/attributes abort; owner, OID, ACL,
strict/immutable/invoker/search_path attributes are preserved. Original approved
base migration Git blob SHA54A... remains unchanged.

Independent native PostgreSQL18.6 reproduction: original fails8s with matching
line44 stack; final matching1.62MB old/new pair passes113ms. All994 existing
privacy/access/cursor scenarios pass independently;13 upgrade guard cases pass.
Actual PostgREST16.5/native PG under8s passes10 scenarios including two matching
giants+eight small rows, one-row prefix/cursor followed by nine rows, all retained.
Metadata-only stored-size windows currently find at most two >200000-byte
stored records per10UUIDs; compressed sizes do not bound arbitrary expanded JSON.
Ten synthetic giant rows can still time out BEFORE projection in the inherited
raw bootstrap aggregation. Keep this separate risk pending; it is not fixed or
authorization to alter the old selector/visibility in this helper-only batch.

Corrective migration20261103091907_optimize_protected_history_projection.sql,
committed LF artifact SHA256C822AD9C78842D81B5F79307DD17145AF1FBB6247004B5AFBC09D76D884FFD77.
The temporary Windows working copy used mixed line endings; deployment and
approval must use the immutable committed LF blob, not its checkout byte hash.
Source/generator/fixture parity and standalone tests pass. Exact live application
still needs owner approval and final CI. No correction has run live yet. Resume
the temporary local runtime pause only after approved application and readback.

## RESUME45 / STREAM46 — remaining acceptance and conditional beta integration

Owner now authorizes completing actual isolated SQL Server, PostgREST and CPU
checks using agents, then beta integration only when required checks pass.
Report the exact target, migration and changes before any live application;
The owner subsequently approved applying the exact migration below after final
checks pass. This does not authorize any other live migration or configuration.
Preserve checkout, permissions, registered scope and all existing records.
Baseline origin/beta remains a13739a5 (refreshed); prepared commits are
2ce731e7 (resume) and d4aed867 (stream). Agents separately own disposable SQL
runtime, gateway wire acceptance and CPU harnesses. No production promotion,
installer publication, live queue repair or Membership change is authorized.

RESUME45 independently passed actual disposable SQL Server acceptance and all
exact-head CI on 01791798. PR371 merged to beta as
18fb220e58cb264244e4bbfa90514cc211666684 on 3 November. No installer published.
STREAM46 now uses a bounded binary buffer, not immediate HTTP passthrough.
Local workerd exposed expensive JavaScript byte checks; direct FixedLengthStream
was rejected because a valid JSON prefix could complete before delayed excess.
The corrected helper waits for both native bounded consumption and upstream EOF
before HTTP success, with a checked generic fallback and explicit abort signal.
Normal page target is 2MiB, one-row hard cap 5MiB; this bounds response payload,
not total isolate memory. Concurrent buffers/runtime copies add memory. Complete
upstream EOF adds response latency but no Worker JSON parse/serialization.
Independent review passes three suites / 57 tests, including actual workerd CI
regressions for short/overlong/delayed-extra bodies and explicit in-flight aborts.
Local process CPU means over 50 warmed requests: large page 3.75ms, structured
page 2.5ms, small page 2.1875ms. These are not Cloudflare billed CPU measurements.
Physical client-disconnect cancellation is unverified in this local topology,
including an isolated flag trial; no hosting compatibility flag was changed.
Hosted version/CPU acceptance and exact-head CI remain required before completion.

Combined current-beta local full suite passes 628 files / 4,841 tests, two opt-in
tests skipped. First PR372 CI reached notification parity and found its disposable
generator fixture omitted the new migration dependency. The fixture now copies
that one required file; all 23 standalone notification scenarios pass with every
assertion retained. Required CI must rerun on the corrected head before the
approved live application. No business logic change was needed for this failure.
Owner additionally approved restarting only the headless local development
Electron process. Latest Main runs from this branch at DEV_URL8081 using the
existing profile, preserving registration, SQL configuration and queues; the
updated Windows-target preview returns HTTP200. This is not a test database or
permission to create real transactions during inspection.

Actual PostgREST16.5 / native PostgreSQL18.6 disposable-cluster acceptance passes
nine cases: exact byte/header correspondence, Unicode/privacy, commerce fields,
1.65MB row, identity/gzip request, byte-prefix cursor, empty page, anonymous and
foreign-branch denial. Root independent rerun passed all nine and exited zero
after cleanup. Live read-only preflight finds
all source compatibility predicates true and protected RPC absent; wrapper md5
2a0564a108930ffdaa326e3e9cf41de4, scoped md5 b4306345e37e638c610e8484a479c510.
No live routine/table/policy/data change has been made. Migration hash remains
54A39A26FEDDE4E3CCD6E1DDAA03F4B604742CFEDD56BB70B1A70465C8BC4E91.

## STREAM46 — approved protected byte-bounded history preparation

Owner approved preparation and isolated tests on 3 November for ROSEGILL pos
qhrufhtbeguxydenzfey. Baseline current beta a13739a5; branch
codex/history-stream-preparation-beta. Prepare an additive service-only history
RPC applying the exact existing privacy projection and bounded pages/cursors,
plus guarded Worker body streaming. Keep fresh terminal/branch/permission checks;
never stream old raw RPC results or omit oversized records silently. Preserve
existing audit visibility, authorization and Membership dependencies. Test SQL
projection parity, allowed/denied scopes, byte limits and old/current clients.
No live migration, data repair, enrollment, billing, deployment or publication.
Present exact migration/hash and target separately before live application.
SQL agent owns migration/canonical SQL/tests; root owns Worker integration and
records; independent review required. Rollback code before removing additive
RPCs; preserve all business records and cursor/checkpoint history.

Separate RESUME45 durable page progress preparation is also approved. Both
batches preserve checkout and protected pending data and remain separate from
production promotion and installed-device verification.

Current evidence supersedes older HOST44 pending-CI notes below: PR370 merged
on beta a13739a5 after exact checks and 4,804 full-suite tests. Deployed Worker
64769214-253d-47bf-ae03-733d92226734 returned small requests in 3–4ms but still
failed history requests with exceededCpu / HTTP503 at 10ms (14:36:42.571 Brunei).
No end-to-end CPU/recovery acceptance is claimed. Read-only size metadata found
individual history values around 1.65MB; the exact failing row is unconfirmed.
STREAM46 moves identical projection to the service-only database function and
streams a byte-bounded prefix, preserving opaque cursors and all history rows.
Runtime unsupported definitions fail before raw aggregation; legacy guarded
redaction remains the compatibility path. SQL wrapper/scoped fingerprints and
reviewed source admission intentionally reject unknown definitions. A future
compatible schema change can therefore disable streaming until reviewed.
Independent isolated SQL rerun: 994 scenarios pass. Actual PostgREST wire bytes,
headers and hosted CPU remain unverified. Ten synthetic wide rows still require
database-side aggregation; no database performance improvement is asserted.

Prepared final checks: full Vitest with two workers passes 626 files / 4,836
tests, two opt-in tests skipped. Focused five-suite run passes 91 tests, including
the CI bridge executing 994 isolated PostgreSQL cases. Current Operations,
Management and captured 1.4.79 clients apply a complete 1.65MB record; interrupted
bodies apply no rows and save no baseline. TypeScript noEmit, scoped ESLint and
diff check pass. Initial migration-list and legacy-fallback fixtures were updated
without removing their assertions; host-load timeouts did not recur in the final
bounded-worker run. Final independent rerun passes three suites / 54 tests,
including the 994-scenario SQL bridge. Independent source review found no
remaining confirmed preparation blocker. Actual gateway/installed/CPU gates
below remain open; this is not live end-to-end acceptance.

Prepared migration: 20261103074926_protected_byte_bounded_history_download.sql,
SHA256 54A39A26FEDDE4E3CCD6E1DDAA03F4B604742CFEDD56BB70B1A70465C8BC4E91.
Final staged inspection removed two trailing blank lines only; the 994 SQL cases
were rerun successfully after that whitespace cleanup and hash recalculation.
It adds service-only projection/page functions and matching canonical source;
it does not rewrite history, products, stock, prices, grants or checkpoints.
ROSEGILL target remains rosegill0011@gmail.com's Org bjxgimekljzlnwejuawj,
pos qhrufhtbeguxydenzfey, database postgres,
https://qhrufhtbeguxydenzfey.supabase.co. This is target identification only:
no live application is approved by preparation. Exact gateway serialization and
compression must pass before hosted acceptance; mismatched protocol fails closed.
Actual SQL Server acceptance now supersedes the earlier LocalDB-unavailable
note. On SQL Server 2025 LocalDB 17.0.1145.4 / ODBC18 / existing msnodesqlv8,
`node scripts/test-history-resume-sqlserver.cjs --run` passes four acceptance
groups: monotonic checkpoint/cursor preservation, committed-page network resume
with original baseline and atomic finalization, page+cursor rollback before
retry, and concurrent writer exclusion (SQL1222). Root independently reran all
four groups successfully. Each run creates a uniquely named disposable database
and removes only its owned database/instance. Agent cleanup inventory showed
only MSSQLLocalDB afterward. No POS_Local/profile/operator configuration used.
The bigint assertion was corrected to account for the driver's text result;
no application code was changed for this acceptance step. Installed Electron
IPC/UI acceptance remains separate from the actual SQL runtime evidence.

## RESUME45 — approved durable history recovery preparation

Owner approved preparation and isolated tests on 3 November. Baseline is current
beta a13739a5, branch codex/history-resume-preparation-beta. Preserve existing
local job/checkpoint schema; persist each committed page cursor atomically with
its applied rows, retain the original CT baseline across restarts, and advance
CT only after complete snapshot success. Pending edits, scope identity and newer
checkpoints must remain protected. Resume must load committed state rather than
mutated in-memory state after rollback. No live repairs, queue resets, schema,
permissions, checkout or deployment changes. Membership remains on hold.
Agent owns native resume files/tests; root owns project records; independent
review and full isolated regressions required. Any unmet scope or stale-baseline
state must fail clearly without silently discarding prior work. Rollback is a
targeted code revert preserving durable jobs and original pending transactions.

Separate STREAM46 preparation is approved for a service-only protected,
byte-bounded history RPC and guarded Worker streaming; no live migration or
deployment is authorized by either preparation approval. CPU remains unresolved
for large history records despite successful small-page samples.

Prepared source verification (3 November): independent review and 16 native
transaction-model scenarios pass. Full Vitest rerun: 624 files / 4,804 tests pass,
two opt-in tests skipped; TypeScript noEmit passes. The initial full run exposed
an outdated diagnostic fixture, updated to the actual durable job interface;
its original failed-download/no-checkpoint assertions are preserved. A UI
timeout did not reproduce in focused or final full reruns. No actual SQL Server
locking/transaction execution verified: the disposable LocalDB helper returned
no private pipe. The opt-in isolated SQL harness is retained, not reported as
passing. Installed recovery, fresh administrator login and hosted CPU acceptance
remain pending. No live configuration, queue, checkpoint or business data was
changed. Final focused fixture/bridge checks, TypeScript and scoped ESLint pass
without warnings. The CI-discovered Vitest bridge executes all 16 native model
cases with a bounded timeout; it never runs the opt-in SQL harness. No live
application, beta merge or deployment has been performed under this approval.

## HOST44 — bounded history response CPU / active

Owner explicitly requests fixing actual Workers CPU below10ms with every
security check/required dependency/data preserved, and sorted demand-driven
reads. PR365/366/368/369 merged after exact checks; permanent integration rule
is now on beta8d9a1231. Full combined suite4782passed. Worker e5c14ace still
failed ordinary POST sync13:54:54.871Brunei at10ms/exceededCpu/503, wall2082ms;
an earlier200 used23ms, so successful status is NOT proof of budget acceptance.

Read-only ROSEGILL pos qhrufhtbeguxydenzfey RPC metadata confirms change_history
uses LEAST(GREATEST(p_limit,10),2000), UUID keyset ordering, and the same bound
for final cursor threshold. Current and v1.4.79 bootstrap/refresh/verifier use
opaque cursor completion, not requested-row-count completion. Proposed bounded
correction: cap only change_history bootstrap RPC p_limit to10 BEFORE SQL
generates rows/cursor, retaining every page, guards, scopes and all other RPCs.
One runtime file sync-endpoint.server.ts plus lossless endpoint/current/legacy
pagination tests. No SQL/schema/data edits, cursor reset, visibility changes,
credentials, billing or installer publication. Root owns docs; agent runtime
and tests; independent review required. Live under10 and complete recovery
remain acceptance gates. Rollback targeted source revert only.

Implemented HOST44 isolated tests:5focused suites/74tests passed; initial
independent review5suites/81overlappingtests passed and SHA-compared all three
captured1.4.79 sources to2f404e6f. Actual guarded endpoint feeds current Operations,
current Management and captured production bootstrap/refresh/verifier loops.
Cases cover53/253rows, minimum100 compatibility, failed-page resume preserving
pending edits, rollback with no premature CT baseline, wrong proof/foreign branch
denial. Added exact20row case verifies final empty RPC and baseline only after
completion. No live business reads/writes used. Final type/full-suite/CI and
deployed CPU/native completion remain pending; do not claim fixed from tests.

## HOST-42 — remaining sync CPU, preparation only approved

Owner further requests fixing actual Worker CPU below10ms without reducing
security, required dependencies or data. Audit proven redundant queries first;
do not cache away revocation/branch checks or claim fixed from synthetic timings.
LOADING43 / audit pending: owner requests sorted demand-driven visible-page
loading rather than bulk fetches. Preserve complete authorized offline SQL
replication separately, transactional snapshots and stable cursor ordering;
do not truncate bootstrap or silently drop rows. Inventory existing loaders and
propose bounded changes after evidence, without delaying reviewed beta fixes.

Owner explicitly requested making prompt incremental beta integration a
permanent rule. AGENTS.md and PROJECT_MEMORY.md now record the requirement,
preserving exact-head checks, scoped diffs, deployed beta acceptance and separate
specific production/database/billing/installer approvals.

Latest owner steering supersedes preparation-only for finalized current fixes:
merge reviewed, passing corrections promptly to beta instead of accumulating
stale PRs; promote only after beta works correctly. HOST42 may therefore proceed
through beta CI/integration after final review/tests. This is no permission to
skip checks, assert hostedCPU acceptance, alter SQL/billing or publish installers.
Production354 still requires complete beta/device/financial acceptance and the
applicable specific-promotion approval; no such acceptance is asserted here.

3November owner approves separate sync-response CPU preparation and isolated
tests only. Actual betaWorker2feb971c request13:29:48.315Brunei returned503,
outcome exceededCpu, CPU10ms/wall943ms after PR367. Sync remains unverified.
Bounded plan: retain pure redaction reference API; add fresh-parsed-JSON-only
in-place redaction and use only on owned successful RPC response.json data in
sync-endpoint.server.ts. Exact privacy, field order, context, settings array
compatibility, rows/cursors and authorization must match. Differential/fuzz
tests and complete parse/redact/serialize measurements, endpoint allow/deny,
types/build and independent review required. No deployment, live SQL, data,
billing, page limits, checkpoint/queue reset or access changes. Root owns docs;
agent owns two runtime files and focused tests. Rollback targeted source revert.

Prepared HOST42 keeps the pure shared helper unchanged and uses owned parsed
containers only after successful authorized sync RPC responses. Objects losing
fields are selectively copied; unredacted owned containers are reused, avoiding
V8 delete/dictionary-mode slowdown. Rows, cursors, key order, terminal secrets,
commerce readiness and Management scopes retain exact output parity. Ten
focused suites/170 tests passed; one benchmark opt-in skipped. The standalone
9-test benchmark passed, seven alternating amortized samples/32 repetitions:
history500 wall4.880→3.853ms ordinary/5.318→3.968ms Management, CPU4.875→3.906ms/
5.375→3.906ms; wide500stock wall5.046→3.700ms/5.136→3.535ms. Smaller history100
and single wide settings cases improved wall, small CPU values are quantized.
These are synthetic Node22 parse/redact/serialize measurements, not complete
Cloudflare/authentication/cold-start CPU acceptance. Types, scoped lint/diff
pass. Independent final-algorithm review and combined full suite remain pending.

PR365 merged cb0f4b55 and PR366 merged fbb6fe42 after all exact-head checks;
both merge trees equal tested source heads. Crash correction PR368 full source
suite4763passed; real admin/sync acceptance remains incomplete. Actual native
profile is production-connected; no real transactions were used for testing.

## Active owner approval — 3 November connection recovery and beta integration

Owner approves checking and merging PR365/366 to beta, fixing the connection
settings crash with agents, and verifying administrator login/sync while
preserving checkout, permissions and existing data. PR367 is merged at
f002d194 and its beta deployment succeeded. One native sync request returned200
at7msCPU; later bootstrap503s confirm recovery is NOT complete. No checkpoints
or queues may be reset. No production, installers, live schema or data repair.

DEV-41 / confirmed High / active: local development Electron cloud:set schedules
the packaged server restart even when DEV_URL owns the external Vite process.
At13:17:46Brunei this required nonexistent dist-desktop/server/index.mjs and
entered recovery. Test-only connection probes are read-only; the captured
failure proves a save/reconfiguration path, not that Test alone caused it.
Baseline f002d194, branch codex/connection-restart-dev-beta. Scope main scheduler
plus focused save/propagation/restart tests. Preserve native vault and renderer
configuration propagation and packaged restart/failure semantics. External
Vite server-side environment remains separately configured. Revert only the
focused source/test patch to roll back; no data rollback is needed.

DEV41 implemented, isolated verified: four-line DEV_URL guard leaves external
Vite untouched. Three focused suites/35 tests, TypeScript, scoped ESLint and
diff check passed. Independent review reran2suites/30tests (overlapping) and
found no blocker. Tests execute actual scheduler/IPC and real connection-profile
save orchestration: unchanged/changed vault pair and renderer override/reset,
read-only Test, rejected persistence, packaged restart ordering/routes/debounce,
quitting/safeMode and error recovery. Real UI/admin/sync verification pending.

## Latest owner decision — PR365/366 beta integration and connection crash

3 November owner approves merging365/366 after checks and fixing the connection
settings crash using agents. Earlier preparation-only text below is historical;
no production promotion, installer publication, database edits or data recovery
is included. Both PRs required documentation-only conflict reconciliation with
beta f002d194 (PR367). Preserve DEV38, REG39 and HOST40 records and runtime fixes.
Full sync recovery is NOT verified: later history/pos_settings503s persisted.
Do not reset checkpoints/queues or change audit visibility. DEV41 captures the
separate external-development-server restart defect; correction is prepared in
its own current-beta branch. Checkout/permissions/branch restrictions remain.

## Current checkpoint — local development module-loading correction approved

REG-39 / investigation / pending administrator unlock: owner reports registered
Electron displays "registration needs review" instead of its staff roster.
Observed login shows saved STR1 branch but roster denial. That wording maps to
401/403 (or missing renderer token); it does not prove revocation or bad PIN.
Exact backend verdict and renderer/Main proof consistency remain unverified.
Do not clear activation, derive replacement identity or fall back around denial.
Independent review identified stale renderer proof and early hydration as
suspected paths only. Actual review navigation was blank because Electron was
served by web-mode Vite, which aliases native recovery components to null.
Corrected local launch configuration only: Windows-mode preview8080, web8082.
Electron recovery now renders its administrator unlock correctly. No persistent
settings/registration changes or test transactions performed. The safe-close
guard also reported activity logs could not save to local SQL; kept application
open, no forced termination or queue clearing. Await user-entered recovery unlock
to inspect the actual saved registration/backend before proposing any fix.

Owner unlocked recovery. Observed renderer registration ammy/STR1, token
d7f3debf-9571-4d95-b547-77a24845d66f, saved activation backend production POS,
cloud qhrufhtbeguxydenzfey. This is production-connected, not an isolated test
target: do not create test sales/stock. Read-only registry confirms used/claimed,
pc/electron, branch assigned, not revoked, both stored proof formats valid and
matching. Direct read-only production roster request returns200 with2 staff;
no names/credentials logged. Preview still shows denial after native-mode fix.
Actual runtime backend may differ from saved activation's historic address.
Owner approved development-only diagnostics and tests: only backend origin,
HTTP status and Boolean outgoing/native identity+proof comparison; no request,
authorization, registration or database changes. Root owns DEV invocation in
staff-admin.ts; agent owns pure allowlist helper/tests. Branch
codex/terminal-roster-diagnostics-beta retains reviewed DEV-38 prerequisite.
Owner also reports administrator sign-in fails: include that in the same
read-only handoff investigation; no credentials or PIN attempts automated.

REG-39 runtime diagnosis confirmed twice on 3 November: actual renderer backend
is HTTPS beta-pos (saved activation summary's production URL is historical).
Outgoing/native terminal IDs match; both have proofs, but valid 64-hex proofs
differ even after case normalization. Roster returns401. No proof values logged.
Owner resumed after physical Escape stop. Proposed separate correction: fresh
Windows sealed proof only when same token/branch identity, fail closed on native
read/identity failure; preserve mobile/legacy paths and server verification.
Await explicit implementation approval; diagnostic approval alone is not a
registration change. Separate compatibility evidence: production2f404e6 lacks
the terminal descriptor required by latest native adoption; that would affect
production-configured clients, but current renderer uses beta, so it is not a
confirmed cause of this current administrator failure. Keep that distinction.

REG-39 correction explicitly approved after diagnostics: shared native proof
helper will prefer the existing Windows Main-sealed proof only for matching
terminal/branch identity; reject mismatched identity or unreadable native store.
Preserve mobile/legacy behavior and all server verification. No registration,
database or production-deployment change. Root owns denial classification and
integration tests; agent owns helper/its tests. Recheck staff list first, then
administrator login by user-entered credentials; no credentials automated.

REG-39 implemented/verified for roster: fresh Main proof with matching token,
platform/branch/mode is used without rewriting either registration. Delayed
binding changes and unreadable/mismatched native data fail closed; typed binding
denials do not become offline-roster fallback. Root observed repeated safe
proof-match=true plus HTTP200 and two staff visible. Final stable full suite:
618 files passed /4709 tests passed, one opt-in skipped (Node22,134.33s).
Types/scoped lint/production build pass; DEV diagnostic markers absent from
release output. Initial in-progress suite mixed pre/post platform edits and had
four failures; final stable-source rerun is the valid result. Independent final
review33 focused tests passed. No sales, stock, grants or registration rewrite.

HOST-40 / confirmed High / investigation only: user reports ECHANGEGAP and
bootstrap503 at11:58 Brunei. Native safe logs confirm non-JSON HTTP503 on
change_history, pos_settings and settings_scoped. Cloudflare beta Worker event
11:58:26.967 has status503/outcome exceededCpu/cpu12ms/wall5938ms, version
605fc32a-c07f-4f3b-ae39-9416b26b8e3b. Other visible CPU failures include
ipc-adopt11:58:44/56 and shift-author-enroll11:58:47. The failed history snapshot
leaves its expired CT baseline intact, causing repeated ECHANGEGAP. Do not reset
checkpoints, clear queues, skip history or infer database corruption. Owner keeps
Workers Free; no billing/limit changes authorized. Administrator connection error
remains unverified end-to-end and hosted CPU failure is a confirmed blocker.
Propose separate lightweight guarded native API dispatch preparation/tests,
preserving existing handlers/authorization/CORS/request-context requirements.
No new HOST-40 code or schema changes approved yet. Historical audit/GLOBAL
visibility correction remains pending and Membership remains on hold.

DEV-38 / confirmed High / active: local Vite development page fails before
database access with `ReferenceError: module is not defined` at the canonical
Electron shift-author protocol's CommonJS export. Two server modules import
that file; production bundling and Vitest did not exercise this dev evaluator.
Owner approved the separate module-loading correction and regression tests.
Baseline beta3dbc0f4d; branch codex/shift-protocol-dev-loading-beta. Root owns
Vite integration and ledger; agent owns a narrowly scoped serve-only interop
helper and tests. Preserve canonical CJS, message domains/bytes, all author,
checkout and branch guards. No database edit or deployment is authorized.
Acceptance: real Vite SSR reproduction/fix, CJS/ESM protocol parity and invalid
input denial, page read smoke, existing author tests and Cloudflare build.
Rollback: revert only this helper/integration/test delta; no data recovery.

DEV-38 implemented and isolated-verified: serve-only exact-file interop replaces
only the reviewed export footer; canonical CJS and production build remain
unchanged. Real Vite SSR test reproduces failure without plugin and succeeds
with it; seven exports, all three signed message byte domains and invalid-input
rejection match native CJS. Root Node22 adjacent suite116 tests passed;
independent review83 passed and real Vite config confirms build exclusion.
TypeScript, scoped lint and Cloudflare build pass. Restarted local server home
returns HTTP200 without error fallback. No authenticated business workflow or
isolated database target has yet been verified. Production stays blocked on its
existing device/CPU/financial acceptance gates. No database edit or deployment.

READ-35 completed: PR364 merged beta3dbc0f4d after all final a57fc422 Actions
passed. Both parent histories are retained and merge tree equals tested head.
Production354 includes it but remains draft pending acceptance. New actual
local page failure DEV-38 blocks device workflow checks; isolated environment
was reported ready but no transactions have been run or target verified yet.

## Current checkpoint — HOST-40 hosted CPU correction approved

3 November owner approved a separate five-runtime-file correction and isolated
tests for confirmed hosted CPU exhaustion. Baseline current beta3dbc0f4d;
branch codex/native-api-cpu-beta in separate worktree native-api-cpu-beta.
Actual beta Cloudflare event11:58:26.967Brunei: /api/v1/pos/sync POST503,
outcome exceededCpu, cpu12ms/wall5938ms, script605fc32a-c07f-4f3b-ae39-9416b26b8e3b.
Other visible CPU failures: ipc-adopt11:58:44/56, author-enroll11:58:47.
Native logs confirm non-JSON503 during change_history/pos_settings/scoped settings
bootstrap. Failed history download preserves expired CT baseline, so ECHANGEGAP
repeats. This does not authorize checkpoint resets, lost pending work, audit
visibility changes, SQL repair, account changes or billing/limit changes.

Approved implementation: Cloudflare-metadata-only exact ordinary sync POST and
existing sync preflight can avoid UI router. Every operation query stays on the
framework path. Extract existing guarded IPC-adopt/enrollment POST handlers into
standalone modules and retain route wrappers; direct CF POST dispatch reuses
those handlers. Preserve their existing absence of CORS/preflight, and preserve
sync CORS, security headers, env initialization, error handling and nonCF paths.
Five runtime files; focused parity/import/build tests plus existing allowed and
denied authorization/branch/signature/replay tests. Root owns server/tests/docs;
agent owns endpoint extractions/tests, independent agent reviews read-only.
No deployment or database change is approved. Local structural/CPU measurements
do not prove hosted success under Free10ms; real hosted acceptance remains.
Rollback: scoped source revert preserving data, registration and queued work.

Other current work: READ-35 PR364 merged beta3dbc0f4d after all final checks,
and its exact cloud read migration is installed. DEV-38 local module-loading
correction is PR365. REG-39 proof correction/diagnostics is PR366 and includes
365 prerequisite: actual stale renderer vs Main proof mismatch was fixed without
rewriting activation; staff roster401→200 and names visible. Final stable suite
4709 tests passed, types/lint/build pass. Administrator attempt still reports
connection failure; hosted CPU is confirmed as a separate blocker. Production
PR354 remains draft; Membership/dependencies and historical359 remain HOLD.
Current Electron profile is connected to real POS, not isolated: no test sales
or stock mutations. Existing audit/GLOBAL visibility scope work remains pending.

HOST-40 implemented and isolated-verified on the five approved runtime files.
Both extracted handler statement bodies are byte-identical after indentation
normalization. Direct entry retains CF-only exact routes, ordinary sync CORS,
all operation-parameter fallthrough (including empty values), nonCF fallback,
env initialization, security headers and catastrophic-response normalization.
Root focused routing/import/endpoint/Management80 tests pass; independent
endpoint/adoption/author93 tests pass (overlapping coverage, not summed).
Final full suite617 files/4695 tests passed, one opt-in skipped, pinnedNode22,
127.84s. Production build passes. Independent final review found no actionable
defect; source security assertion now follows extracted handler and confirms
route delegation. Type/lint final check and emitted import measurement follow.
No hosted deployment, enrollment, business operation or database edit performed.
Real hosted CPU/recovery/administrator acceptance remains pending after separate
deployment approval. Do not claim Free10ms or whole-system acceptance from tests.

Final TypeScript/scoped lint pass. Actual emitted dist/server/index.mjs tested
in fresh Node22 subprocesses with synthetic bindings, fixture-only fetch and
network blocking: guarded bootstrap200 loads25 modules; native adoption200 and
real fixture Ed25519 enrollment200 load22 each. All three exclude UI router,
React, framework server and TanStack libraries. Named app_function400 and
unrelated404 controls load191 modules including framework/UI, proving preserved
fallback. Node cold78-140ms vs516-594ms controls and coarse warm0-1.6ms are local
measurements only, not Cloudflare Free acceptance. No real enrollment occurred.

## READ-35 prior checkpoint and rollout evidence

Owner **approved live READ-35 migration and beta integration** for exact file
20261103023417_management_closing_graph_read_scope.sql / SHA256
386B7023556863224252775FFD19EB2A8FEDBA43324E857989BD8092EC133696,
ROSEGILL / org bjxgimekljzlnwejuawj / pos qhrufhtbeguxydenzfey / postgres.
Apply after current-definition/hash verification, read back unchanged authority
and validators, then merge PR #364 only after final checks. This does not include
installer publication, production promotion, enrollment or business writes.
State: approved rollout starting; earlier preparation-only status is superseded.

READ-35 live rollout completed after exact approval. Migration history version
**20261103025854** records management_closing_graph_read_scope on the identified
POS project. Before application, current graph/read/write validator definitions
matched the reviewed hashes. SELECT-only readback proves the graph body changed
by exactly one admission-call substitution; all pg_proc attributes on all three
routines and both validators' bodies are unchanged. Graph body SHA256 is
9a3dfe5f0f52a3e3b7aa540f4f81b318d42c7e1d755dcbd321ef1bd889fc4a7a.
Owned artifact: shift-rollout-approval-20261103/read35-live-readback.json.
No enrollment, data operation, local SQL upgrade or publication was performed.

All Actions passed on logic head89acb152; exact committed-head local suite also
passed615files/4652tests, one opt-in skipped (115.61s). The final documentation
reconciliation must pass its exact-head checks before authorized PR364 beta
merge. Production PR354 still retains its separate acceptance/release gates.

READ-35 preparation is implemented and isolated-verified after explicit approval.
The shared recognizer now accepts graph downloads with the existing device
proofs; write/mixed-request checks, normal branch locks and redaction are intact.
New additive migration 20261103023417_management_closing_graph_read_scope.sql
changes only the graph RPC's admission call to the existing read validator and
preserves the complete function metadata/body apart from that exact call. It
rejects unknown/mixed bodies, preserves idempotence and handles raw LF/CRLF
migration input. Generator ordering and canonical parity are verified; all six
installed migration files remain unchanged. No live application is authorized.

Evidence: root full-suite baseline passed 615 files / 4,652 tests, one opt-in
skipped (126.39s, two workers). Root's final review found the raw-CRLF reference
literal mismatch before any live change; fixed normalization and independently
passed all 19 SQL scenarios and 69 final API/canonical/SQL-wrapper tests.
TypeScript, scoped lint, notifications23, closure71 and bootstrap32 checks pass.
Independent scoped and incremental review found no actionable defect. Final
full-suite/pushed-head CI remain tracked separately. New migration SHA256:
386B7023556863224252775FFD19EB2A8FEDBA43324E857989BD8092EC133696.
Preparing a separate beta PR; live application requires exact-project approval.
No real keys, business records, local SQL, installer or production deployment
changed. Earlier proposed/pending-preparation entries below are historical.

PR #363 merged into beta as **575092c7b4593ca519cb328ed8e74d0767f7932b** after
all exact-head checks passed on 4d839cc0. Merge tree 7fdc6911 matches the reviewed
tree exactly and retains prior beta 41463049 plus reviewed head as parents.
All beta-push/promotion checks and beta-domain build subsequently passed;
CodeRabbit skipped. Public beta smoke checks: home 200 with security headers,
configuration-presence endpoint 200 with POS URL/service-key flags true, invalid
login payload 400 before PIN verification. These are not valid-login CPU or
transaction acceptance. Production PR #354 now includes all merged beta changes
(633-file comparison) and remains draft under its existing acceptance gates.
No beta installers or production release were published.

READ-35 / confirmed High, pending batch approval: latest unpublished Management
client calls the new closing-graph download during bootstrap/pull, but
managementReplicaScope does not recognize sqlServerShiftGraph as a replica read.
Independent source-handler reproduction with identical valid device proofs:
old pull returns 200, graph read returns 403 STORE_FORBIDDEN without calling SQL.
Separately, isolated PostgreSQL with captured validators accepts the existing
Management read scope but rejects the new graph RPC because it uses the write
validator. These are two new-path defects; existing deployed pull/bootstrap/
counts use their separate read validator and are not an all-Management outage.

Proposed bounded next batch (no application changes yet): recognize the typed
graph read in src/lib/management-replica.server.ts while preserving mixed-write,
receipt, telemetry and ordinary-read denial; prepare an additive migration to
change only pos_sync_shift_graph admission to existing validate_read_scope;
mirror it in canonical SQL and preserve generator ordering. Keep original six
installed migration files immutable, write validators and all grants unchanged.
Test actual Management allow, Operations A/B denial, unclaimed/revoked/disabled/
wrong-proof devices, mixed uploads, SQL branch/graph validation and rollback.
Scope: shared read recognizer, generator, new migration, canonical SQL and
focused tests. Source/isolated implementation approval is pending; applying a
new live migration would require separate exact-project approval. Existing
arbitrary Management subset/replication scope modeling remains separately held
for audit; do not invent broader entitlement while fixing this recognized read.
Recoverable baseline: beta575092c7. Preparation branch:
codex/management-closing-read-beta. No code, schema or business data changed by
this documentation proposal. Membership and historical #359 remain HOLD.

Owner **approved READ-35 preparation and isolated tests**. State: active source
implementation on codex/management-closing-read-beta, clean baseline15377938
from beta575092c7. Agents have separate API/SQL/test ownership; root owns this
ledger and tooling. Preserve every existing write/branch/device guard and all
grants. No live schema application, real enrollment, installer publication or
main promotion is included. The additive migration must be presented separately
before live application. Earlier pending-approval status above is superseded.

## Owner instruction — verify and merge PR #363 into beta

### Completed cloud rollout — supersedes pending statuses below

After renewed exact approval, all six current pinned upgrades applied to
ROSEGILL / pos qhrufhtbeguxydenzfey / postgres. Before application, all 48
captured routine definitions/authority metadata remained unchanged and four
protocol tables were absent. Each separate application returned success.
Recorded live versions, in order: 20261103013712, 20261103013757,
20261103013803, 20261103013905, 20261103013911, 20261103013918.

Live SELECT-only readback: **70 normalized function-body hashes exactly match
the isolated approved rollout**; all 48 existing owners/ACL/config/security modes
remain unchanged. Required public RPCs have service-only execution, four private
metadata tables have RLS and no direct anon/authenticated/service-role grants.
All four new tables contain zero records: no keys, receipts or historical intents
were enrolled/replayed. Stale-reopen, requested-revision, audit-type and role-cast
checks pass. This removes the missing-raw-RPC beta deployment blocker. No local
SQL upgrade, historic repair, installer publication or real business operation
was performed. Owned scratch artifacts preserve readback/history/body hashes.

All Actions passed on 56a3a47f before this documentation reconciliation and
trailing-blank-line cleanup. Final checked head and beta integration follow;
do not infer completed main promotion or whole-system/device/Free-CPU acceptance.
Existing management NULL-scope, financial-as-of and installed-device gates remain.

Owner renewed exact approval for the corrected enforcement SHA256
992E2300C30A71A1DA5B23B9181B17A2BE2E8AED521E2DA942E503EBB18233C6
and start-proof SHA256
A0C99E3FF5EFDFAE80794FCDAAD69A84034789378D40E85739924AC766D23BE4.
All six current pinned files are now approved for the identified cloud project,
after metadata drift check and completed captured-schema isolation. Apply in
order and stop on unexpected state; no local upgrades, real enrollment/testing,
installer publication or historical repair. State: authorized rollout starting.

Owner subsequently **approved the six exact cloud upgrades** pinned in the
go-live checklist for ROSEGILL / pos qhrufhtbeguxydenzfey / postgres. Approval
requires captured-definition checks and isolated verification before applying
the ordered files, stopping on unexpected state, live readback, then beta merge
only after final checks. No local upgrade, real enrollment during verification,
installer publication or #359 repair. Current state: metadata captured in the
owned rollout scratch directory; independent prerequisites/hashes pass; isolated
captured-definition rollout is running. No live DDL has occurred yet.

Captured-schema isolation caught a real type mismatch before any live write:
app_users.role is enum app_role, while two management-author helper calls expect
text. Existing synthetic fixtures used text. The exact six files create cleanly
in isolation, but first signed upload fails resolution before writes. Prepare
only explicit person.role::text at the two existing call sites, matching canonical
blocks and enum regression fixtures; do not change role/grant logic or overloads.
This is a necessary correction under the owner's PR-failure instruction.
It changes two SQL hashes: the previous approval cannot authorize those changed
bytes. Keep all live application stopped pending final captured-schema tests and
renewed exact approval for the two corrected files. Four unchanged approvals
remain recorded. No live migrations, keys or business records were changed.

Corrected source verification complete: root independently reran all **32
captured-schema workflow scenarios** and **30 enduring author SQL scenarios**;
all passed. Agent also verified 23 native full-graph and 25 canonical cases,
lint and diff checks. Independent review confirms only the two runtime casts
and matching canonical copies change, with no signature/grant/policy change.
CI now runs the enduring real-enum author suite. Updated exact hashes are
992E2300C30A71A1DA5B23B9181B17A2BE2E8AED521E2DA942E503EBB18233C6
(enforcement) and
A0C99E3FF5EFDFAE80794FCDAAD69A84034789378D40E85739924AC766D23BE4
(start proof). Await renewed approval for those two files before the full
ordered live upgrade; all six remain unapplied. Root metadata snapshot and
isolated report are in the owned shift-rollout-approval-20261103 scratch folder,
outside this Git worktree; they contain schema definitions, not business rows.

Separate pending scope audit: captured pos_sync_validate_scope requires token
location_id = requested branch, so a NULL-location management token fails this
SQL helper. This is existing deployed behavior, not changed by these six files.
Its complete management-client impact still needs tracing. Preserve the actual
validator in isolated tests and never substitute a permissive management shim
or widen scope silently. Keep this finding separate from the enum-only fix.

Owner explicitly requests CI investigation/corrections and beta merge after
passing checks, with production PR #354 updated. Preserve checkout, permissions
and existing features. Verify the exact head/destination diff and existing-client
hosting compatibility before merge; no live database migration, installer
publication or main promotion is included. Keep #359 and Membership on hold.
Current inspected head: 1e419bed; destination beta 41463049. State: CI and
beta rollout compatibility review active. Separate exact-project schema and
specific production-promotion approval requirements remain in force.

Owner then requests production promotion of this completed beta work, conditional
on stability and preservation of existing features. Record this current
beta-to-production intent for PR #354; do not treat it as live schema approval,
installer publication or permission to ignore unresolved acceptance gates.

All Actions on source head **1e419bed** passed: Security checks (including full
suite, SQL workflows, lint, type/build and dependency audit), Android compile,
iPhone build without publication and destination labels. Independent rollout
review nevertheless confirmed a compatibility blocker: runRelayOp routes
shift_notifications mutations/shifts deletion to the new service-only raw-write
RPC. A SELECT-only check in exact POS project qhrufhtbeguxydenzfey / org
bjxgimekljzlnwejuawj confirms that RPC, author lookup and registry are absent.
Existing summary publication can therefore fail after automatic beta hosting
deployment. Checkout/PIN and old aggregate routes have no new dependency found.
Do not merge this incompatible state merely because CI passed.

Read-only schema inventory or missing-RPC fallback cannot safely bypass this:
enrollment can race the pre-read and direct REST mutation lacks an atomic author
guard. Keep the guarded path intact. Exact six-upgrade proposal is recorded in
the existing go-live checklist; live application needs separate exact-project
approval, captured-definition/precondition checks and isolated verification.
No schema/data/keys were changed. Beta and production merges remain pending.

## 3 November — parallel production preparation and CI follow-up

Owner approved a separate **login CPU correction and isolated tests** after
choosing to keep Cloudflare Free. Recoverable baseline: clean ef2ef784 on
codex/shift-integrity-coordination-beta. Approved runtime scope: src/server.ts,
new cashier-login-endpoint.server.ts, public cashier-login route,
pin-request-throttle.server.ts and cashier-login.server.ts, plus focused tests.
Dispatch only exact POST/OPTIONS public cashier login before framework router
loading; preserve existing validation, CORS/security headers, errors, throttles,
trusted client address, real wrong attempts, terminal/branch permissions, Auth
proof/session/audit and all unrelated routes. Agents implement/review bounded
files with one writer per file. No database, billing, deployment or Membership
changes. Require first/warm isolated build evidence, response/guard parity and
exact-head CI; local timings alone cannot certify the hosted 10 ms budget.
State: active implementation. Rollback: targeted source revert retaining other
beta fixes; no data or queue restoration is involved.

Login correction source and focused verification completed: exact CF-metadata
POST dispatch skips the UI router; non-CF POST retains framework request scope
and original client-address lookup. Shared endpoint keeps route delegation,
CORS/security, PIN/attempt/branch/session/audit behavior. Review caught the
initial non-CF scope regression before commit; it was corrected and covered.
Agent focused checks: **148 tests across nine files**, TypeScript and scoped
lint passed; independent read-only review found no actionable scoped defect.
Root built the final Cloudflare bundle successfully. Actual shipped index
was tested with synthetic bindings and entirely stubbed network: login
200/wrong-PIN 401/preflight 204; 28/27/12 modules loaded respectively, without
router/UI/TanStack. Unrelated-route control loads 189 modules and the framework.
Median warm local Node CPU was about 1.55 ms/login; fresh process CPU was
125–141 ms including filesystem imports/instrumentation. These are **not hosted
Cloudflare CPU measurements or Free-budget certification**. Zod remains about
661 KB. No live requests, credentials, database/billing/deployment changes.
Full-suite and final pushed-head CI remain required before beta integration.

Final source verification: full pinned Node22 suite **613 files / 4,627 tests
passed**, one opt-in file/test skipped (106.72 seconds, two workers); TypeScript
passed. The opt-in actual-engine handover was separately verified earlier and
was not rerun for this login-only batch. Root's first full run exposed a Windows
LF/CRLF mismatch in transfer test setup, not transfer logic: normalized only its
fixture inputs and asserted exact preservation of the lifecycle definition
except the reviewed completion guard. All five original transfer tests and the
final complete rerun pass. Notifications 23/23 and 70-table schema/sync registry
plus installation-order checks pass. Preserve final exact-head remote CI,
live CPU measurement and existing production/migration/acceptance gates.

Exact-head CI on ef2ef784 passed native closing graph, transfer/request and
history scenarios, then failed notification generator parity because its
temporary fixture omitted the five newly required migration source files.
Root added only those fixture inputs; **23/23 notification SQL scenarios pass**
without changing notification logic, generator behavior or live data. Other
existing CI gates still require a complete run on the final corrected head.

Owner asks to prepare/update the existing production PR alongside beta fixes.
PR #354's obsolete authority-plan and SHIFT-34/35 status was reconciled with
actual beta 41463049 and candidate #363 at 3acb0900. #354 remains draft,
unmerged; #363 is not yet beta content. Main remains v1.4.79 / 2f404e6f.
Preserve beta-first integration, exact-head checks and separate ready-promotion
approval. Historical #359 and Membership/dependencies remain HOLD.

Confirmed CI blocker: the standalone trusted Windows closing-graph fixture
does not initialize the new shift authority. Agent correction uses the real
v3 authority/journal path rather than a permissive stub. Exercising it also
reproduces a candidate compatibility regression: the signed start RPC equates
the original opening terminal with the actual closing terminal. Preserve the
existing authorized same-branch cross-terminal close success and independently
validate original-parent identity; do not turn it into an expected denial.
Source correction and regression verification are in progress, not merged or
applied live. No checkout, permission grants or real shift records changed.

Follow-up candidate correction completed in source: start-proof migration and
matching canonical block distinguish immutable opening-terminal attribution from
the registered executing terminal. Both are compared to trusted respective
contexts; only ORIGINAL with validated start proof admits this compatibility.
No earlier migration, permission grant or real record is rewritten. Root reran
the exact failing native graph command: **23/23 passed**; independent read-only
review found no actionable scoped defect and confirmed exact schema/migration
parity and unchanged final privilege hardening. Agent final checks: **28 author
SQL cases, 157 focused Vitest cases**, lint and diff checks passed. Source
preparation is implemented/isolated-verified, not live-applied; remote exact-head
CI, beta integration, physical-device/checkout acceptance and release gates remain.

Read-only Cloudflare inspection confirms production deployment a70a936e maps
to main 2f404e6f. Last-24-hour logs include CPU-limit 503s for both sync and
public cashier login; one login reports 15 ms CPU / 1,462 ms elapsed. Beta's
redaction improvement is not yet deployed to production and does not explain
the separate login failure. Hosting execution budget and exact CPU attribution
were initially unverified; no billing, CPU-limit, database or production setting changed.

Subsequent read-only Workers plans inspection confirms **Free / Current plan**
for the same Cloudflare account and **10 ms CPU per request**. The observed
15 ms failed login exceeds that budget, establishing a hosting-limit mismatch
for this invocation. Source merging alone cannot guarantee recovery; retain
an owner-authorized execution-plan/budget decision and post-deployment checks
as a production gate. No Upgrade button was used and no billing changed.
PR #354 was updated with this evidence, remaining draft/unmerged.

Owner decision: **Keep Free; investigate further optimization**. Do not upgrade
billing or change hosting CPU limits. Continue bounded source/isolated CPU
investigation for login and sync, preserving authentication, branch/privacy,
wrong-attempt handling and complete pagination. Do not claim the Free budget
is met without measured hosted acceptance; report feasibility limits honestly.


## Latest checkpoint — signed shift handover verification

On 2 November beta PR #362 merged as
`41463049eb4d025398cfb273e85046f15c45817c`, tree
`1cf69ced0cb138085e2862f8045f09f67d4e9159`, exactly equal to independently
reviewed head `e80bff567a11c46085b9613027cc55c008f848ba`. GitHub confirms original
PRs #343, #344, #345, #346, #347 and #357 are **MERGED**, with all original
heads retained as ancestors. Android, Windows-renderer, iOS, security and
Cloudflare build checks passed on the reviewed head; CodeRabbit skipped.
Final beta-push and production-PR checks on 41463049 also passed: security
(push and PR), Android/Windows renderer and beta hosting; CodeRabbit skipped.
Metadata is 1.4.81; calculated
next installer beta is 1.4.82-beta.1. No installer was published and main
remains 2f404e6f / v1.4.79. No lifecycle SQL was applied live.

The owner then explicitly approved **both separate correction batches and
isolated tests** before production, after confirmation of source defects below.
Each branch starts from clean, recoverable beta 41463049. Approval covers
preparation/code and isolated tests only, not live PC/cloud schema application,
historical reconciliation, permission changes or production promotion.

| ID / state | Confirmed defect and approved correction | Scope, risk and acceptance |
| --- | --- | --- |
| SHIFT-34 / active preparation | Packaged SQL emits unconditional count uniqueness by shift, unlike cloud ORIGINAL-only uniqueness; native recount duplicate catches can report success without verifying saved facts. Prepare ORIGINAL-only local index parity and truthful recount replay. | Native recount handler and internal graph/replay helper; narrowly scoped SQL Server generator, additive local upgrade and regenerated existing schema/registry/installers; focused tests. Preserve all rows, exact counts, IDs, actor/branch, grants and current drawer. Verify original then multiple recounts, exact and mismatched replay, unrelated uniqueness errors, rollback, concurrency, branch/permission denial and cloud recount download. Unknown index shapes/data conflicts must abort before DDL. No real POS_Local access. |
| SHIFT-35 / active preparation | Independent cloud/local counters can suppress web CLOSED updates while advancing pull cursor; pending protection only checks the journal and misses legacy CT edits. Prepare truthful adoption outcomes and pending-aware convergence. | Shift-specific behavior in cloud-client, pull-worker and change-reader, necessary existing bootstrap caller integration and focused tests, subject to final bounded design. Preserve other tables, branch restrictions, pending journal/CT changes and closing graph dependencies. No unconditional cloud-wins, invented revisions, cursor reset/skip or dropping rows. Test OPEN99/CLOSED5, equal facts, pending journal/CT, complete graph/page boundaries, interrupted retry and branch denial. Any new API/schema/business rule needs separate approval. |

Root owns this existing ledger/memory and coordination branch. Separate agents
own each implementation branch and may not edit each other's files. Reconcile
both immutable diffs, perform independent review and combined regression checks
before beta PRs/merges. Live database changes require exact-project approval;
the lifecycle guard source merge does not authorize its application.

The owner reconfirmed **one effective closing** for old STR1 shift
1a349429-cea1-4f45-8d2b-36678d37ad27: use the original cashier closing
(31 October 21:08:56, cash 687), with the later deliberate web action retained
only as audit history. This clarifies the reconciliation target, not permission
to delete histories or execute the obsolete #359 replay. A new exact audited
plan still precedes any data repair; #359 remains HOLD. Membership/dependencies
stay on hold and all other unfinished tasks remain preserved below.

Later owner clarification: subsequent authorized administrator corrections made
on **web or terminal** must persist and synchronize in both directions; a PC
that is off receives accepted changes on startup/reconnect. Retain one effective
closing and immutable correction history. An older queued opening/closing must
not undo an accepted correction; pending offline changes must not be discarded.
The original-cashier choice above is this historical reconciliation target, not
a permanent rule that cashier facts override future administrator corrections.
Concurrent/conflicting unacknowledged edits need explicit safe conflict handling,
not client-clock guessing or unconditional cloud wins.

SHIFT-35 design refinement: exact outcomes/pending protection necessarily includes
the existing bootstrap caller, which otherwise filters pending rows while
advancing its baseline. Root includes that caller in the approved correction's
necessary dependencies; no new business module, endpoint or schema is authorized.
Reliable lower-counter closing adoption also needs a complete graph consistency
contract: the feed can split parent/children across pages. Do not advance past an
unapplied closing, erase pending work, or wait forever for later children behind
a blocked parent page. Inspect existing read/proof contracts first. If a new
server/API/schema contract is required, present it separately before expansion;
do not claim native convergence complete from safe deferral alone.

### SHIFT-36 — owner-approved protocol preparation and isolated tests

Final 3 November handover checkpoint: complete suite 611 files passed / one
opt-in file skipped; 4,572 tests passed / one opt-in skipped (114.29 seconds,
pinned Node22, two workers). That opt-in actual-engine handover was separately
executed and passed; it is not an unexecuted coverage gap. TypeScript, diff and
changed-file lint checks passed (17 test-only typing warnings, zero errors).
The approved same-registered-terminal A→B source preparation is implemented and
verified in isolated engines. Cross-device handover/physical-device acceptance
are not certified by this fixture. Preserve remaining financial-policy, live
migration, CI and release gates; do not mark the entire POS audit complete.

3 November: native start implementation 3125ede9 and server 6c674ff8/3a169316
are integrated, preserving the separate domain contract. A fresh independent
read-only candidate review confirmed one regression: attaching start evidence to
later recount/variance intents. Root corrected freeze association to ORIGINAL
only; malformed saved non-original associations stay pending rather than being
silently rewritten. Actual combined A-start/B-count workflow independently passed
in 9.92 seconds, including key/connection reconstruction, lost-reply exact retry,
both authors' signature denial paths, two later ordinary recount RPCs, real web
correction and child-only adoption with pending-edit protection. Real LocalDB:
31 cases passed, including 024 idempotence/refusal, atomic A proof/B intent,
rollback/retry and original-only association. SQL authority: 22 cases passed;
156 focused API/native tests and TypeScript passed. Changed-file lint has zero
errors and 17 test typing warnings; diff check passes. Broader suite is rerunning
after adapting the old journal fixture to model 024 without dropping assertions.
No physical-device, installed-IPC, OS-vault or full stock-checkout certification
is inferred from synthetic identity/transport/vault adapters. No live changes.
Financial expected-amount/as-of policy, exact-head CI and approved migration/
deployment/release remain separate gates. Membership and #359 remain HOLD.

Owner approved signed closing-start proof preparation and isolated tests on
2 November, superseding the pending approval below. Preserve the actual person
who starts closing and the different permitted person who finishes offline.
Prepare separate domain-bound, immutable start evidence captured by trusted Main
under the existing start-close permission/session/terminal guard. The final
closing must not retag that earlier author; server verification must bind the
saved start event/shift/branch/project/terminal and enforce existing access without
granting new permissions or permitting unsigned invented history. Cover restart,
different users, forged/replayed proofs, revocation, rollback and retry. Reuse
existing author keys/metadata/contracts where compatible; inspect the concrete
protocol before edits and keep one owner per file. Approval is SOURCE AND
ISOLATED TESTS ONLY: no live enrollment, installed SQL/cloud schema application,
business data repair, production merge or installer publication. Financial
expected-amount/as-of policy and Membership hold remain unchanged.

Reviewed start contract: use optional singular OUTER shiftClosingStart beside
shiftAuthor, preserving existing frozen closing JSON/hash and causal headers.
Separate closing-start.v1 signature binds author/key/project/terminal/branch/
shift/event and exact raw start payload SHA256. Strict payload max16KiB contains
the actual saved business event (only revision/update clocks excluded) plus
original parent identity and closing-start time/by/reason; never money formulas.
Native saves proof atomically with actual start and freezes its exact association
with ORIGINAL metadata. Server checks A's signature/current start permission and
B's existing count permission before new writes. A distinct service-only RPC
uses a bounded private validated-start context to admit only that earlier event;
an immutable receipt binds proof to accepted intent. Existing RPC replay cannot
omit/change an accepted start proof. Historical exact replay retains no-write
semantics, current terminal scope/signatures and original authors. Same-author
legacy compatibility stays bounded; unproved different-author rows stay pending.
Use typed native/PG timestamp representation checks, not arbitrary clock priority.
The independent fresh read-only contract investigation is complete; candidate
review follows implementation/focused tests. Native/server work remains isolated
with shared public protocol owned by native author; root owns this ledger.

Author candidate verification completed for the current scope: fresh independent
review confirmed two actual native/server compatibility defects (missing original
parent closing author and rejected saved closing_started). Both were reproduced
and corrected; the real signed workflow passes. Final broad suite excluding only
the separately executed opt-in engine test: 611 suites / 4,549 tests passed.
Actual signed Main/key/enrollment/API/SQL workflow: 1 comprehensive scenario
passed; isolated SQL authority scenarios: 15 passed; actual LocalDB: 28 passed;
TypeScript/diff checks passed. Exact changed-file lint: zero errors, 12 test-only
typing warnings. No additional formal review cycle or full-system security claim.
Signed-path denials cover forged actor/scope/signature and stale/revoked new writes;
accepted exact history remains no-write acknowledgement. Existing unsigned legacy
compatibility is explicitly unretired, not claimed fixed for all old terminals.

Still pending: owner decision on a separate signed closing-start proof so one
person may start offline and another finish without inventing prior authorship;
authoritative expected-amount/offline refund as-of policy; final reviewed-head CI,
safe reviewed migration rollout with exact-project approval, installed-device
acceptance and release. A question for closing-start preparation is pending;
elapsed time is not approval. No new extension, live migration or real enrollment
has been executed. #359 historical repair and Membership remain HOLD.

Latest continuation: completed native author commit a0f18cbf and atomic server
enforcement eda1802c are integrated as 8f98b5d1/7ffd0e96. Parent reran 92 focused
author/API tests and 12 isolated SQL security scenarios: passed; TypeScript
passed. Disposable real LocalDB checks: 28 scenarios passed, including local023
shape/index preservation, stored signatures, epoch-change rollback and original
offline/pending-edit contracts. A fresh independent read-only candidate review
is active. The cross-boundary fixture owner is updating only its two test files
to exercise actual author signing/enrollment/verified signed RPC; the earlier
unsigned-protocol success must not be called signed workflow verification.
Broad regression excludes that actively edited opt-in test and is running.
No installed SQL, real enrollment, business record or live schema changes.

Cross-boundary engine harness is integrated at 796b7f41; root independently ran
the opt-in actual LocalDB → worker → CloudClient → sync API → in-memory PostgreSQL
scenario: passed in 9.79 seconds. Named SQL arguments are additionally verified
against actual routine parameter names (final component 677eb946 delta). It
exercises actual corrected web SQL and child-only adoption, exact lost-response
replay, retained author labels and pending-note rollback. Identity/transport/feed
adapters remain synthetic, Main functions are source-loaded rather than installed
IPC, and the sale header is not a stock checkout acceptance test. AUTH-37 remains
unverified until signing/enforcement integration and fresh candidate review.

AUTH-37 necessary alias closure: source trace confirmed runRelayOp can mutate
shift_notifications through raw REST outside the 12 graph helper guards. The
root includes a narrowly constrained service-only atomic mutation RPC and the
necessary existing pos-relay.server.ts caller change in the approved author
boundary. Keep safeAuthorizeRelayOp first, exact legitimate upsert/filter/delete
semantics, personal web/mobile flows, OPEN/housekeeping/delivery acknowledgements
and existing grants. No generic proxy, broad graph trigger, new role grant or
financial rule is authorized; test denied sensitive aliases and allowed controls.

Resume verification: full suite including enrollment foundation and both boundary
fixes passed 609 suites / 4,485 tests with one migration-inventory failure (missing
registry filename), not a runtime failure. Separately approved web audit-event
correction 533663b3 is integrated as 2d3d3df0, including that inventory entry.
Root independently reran all 8 isolated SQL scenarios and 33 canonical/admin
tests: passed. Original missing-event failure was reproduced before patch; fixed
real routine retains exact expected amounts, original times, actors/defaults,
ACL/config/OID and idempotent retries; late failure rolls back the full graph.
Unknown shape/missing prerequisite abort without data edits. This is tested source
preparation only; real project application and final complete workflow remain
pending. Main author wiring, atomic authorization enforcement and independent
candidate review remain active. Do not mark whole shift sync fully verified.

Owner separately approved the real-workflow-discovered web correction audit fix
on 2 November: pos_admin_correct_closed_shift omits required activity_events
event_type, causing transaction rollback against the actual canonical table.
Prepare an additive migration and matching schema source adding only
event_type='shift_close_corrected', preserving calculations, administrator/branch
checks, saved audit facts and retry semantics, with isolated SQL tests. Existing
migrations remain immutable. No live application is authorized. The cross-boundary
test must use the actual corrected routine before claiming web correction works;
do not drop the NOT NULL constraint or substitute a synthetic successful action.
web_async_audit owns this separate batch; coordinate shared generator edits with
the author-enforcement agent. All earlier unfinished tasks remain active.

2 November owner continuation: complete pending shift sync and author verification
with agents, preserve checkout/permissions and update existing beta PR #363 with
completed versus pending evidence. The PR was pushed to cccc052e and its body
rewritten around actual current preparation and outstanding gates; no beta/main
merge or publication. Foundation 27b4d387 is integrated as 0e6a8036: private key
registry, verified personal enrollment, stable identity carry and route. Component
13 suites / 169 tests, types and lint passed; integrated four suites / 82 tests,
types and local web build passed. A generated build report was reverted alone;
no unrelated source changes were retained.

Actual cross-boundary Main/worker/API/isolated SQL testing found two confirmed
runtime integration defects missed by unit fixtures: real SQL Server uppercase
aggregate UUID versus lowercase immutable intent failed the single-aggregate
comparison; CloudClient.shiftGraph omitted required organizationId and the real
API rejected it with HTTP 400. Targeted fixes f6916fb8 and f989782a are integrated
as adcccb85/429075c5, preserving single-aggregate/branch checks and strict API
validation. Component focused suites 42 and 48 tests passed respectively; final
actual workflow rerun remains pending. No fixture casing/schema relaxation hides
either failure. The actual harness reached opening → sale → closing → two
recounts with three local acknowledgements and lost-response replay after the
first fix; this does not prove author signing/device registration integration.

Pending: Main stable identity/session epoch/signature persistence and background
queue integration; atomic server signature/current-grant enforcement across
sensitive aliases; cross-boundary complete rerun; fresh independent candidate
security review; final exact-head regression/CI. Separate expected-amount/as-of
financial policy remains unresolved. All new migrations are source-only; no real
enrollment, key rotation, permissions, financial data or installed SQL changed.

2 November continuation checkpoint (isolated coordination source 69fd5769):
Final rerun at 80394dd8 after both fixture corrections: **608 suites / 4,461
tests passed**, pinned Node 22, `vitest run --maxWorkers=2`, 118.39 seconds.
The former 32 failures below are resolved, with original adoption assertions
retained and an added explicit nonclosed atomic-read contract test. This is the
protocol/foundation checkpoint, not acceptance of subsequent AUTH-37 runtime
wiring, financial admission policy or the combined real-boundary harness.
server draft 907ba546 and native coverage draft 61fef763 are integrated, retaining
the non-shift settings-notification correction. Shared sealed-key/public proof
foundation ce7ab218 is integrated without runtime enrollment or key creation on
real devices. Combined five focused suites: 168 tests passed; isolated protocol
PostgreSQL: 24 scenarios passed; existing native/company/event/key CJS checks:
56 passed; TypeScript passed. Full regression: 606 suites passed, two suites
failed (4,428 tests passed / 32 failed). Thirty-one failures are an older
adoption fixture invoking the new graph HTTP path with an incomplete config
stub/missing historical-proof SQL handling; a separate agent owns fixture
adaptation while preserving all branch/pending/rollback assertions. The remaining
old exact-call assertion omitted the newly required observation argument;
assertion updated to require branch, terminal AND observation for journal writes,
and its 12-test suite passes. Full suite is not green; rerun after fixture repair.
These are source/isolated results, not installed-device or live verification.

AUTH-37 server identity/enrollment foundation and native Main/session-epoch hooks
are being prepared in separate owned worktrees. New outer aggregate shiftAuthor
attestation must leave frozen payload bytes/hash unchanged. Canonical user_id
audit labels remain distinct from stable app_users.id; aliases/renames cannot
retag pending signatures. Key/subject mismatch remains explicit review-only.

Financial validation design has an additional source-confirmed constraint:
sale/refund journals upload the current row, so an offline sale followed by a
closing, refund and recount can deliver a refunded sale before the older closing.
Do not claim current-total comparison proves historical as-of totals. Existing
shift locks do not serialize every sale INSERT/UPDATE/DELETE alias. No global
sales lock, checkout/refund trigger, immutable financial snapshot or formula
change is approved/implemented here. Preserve this separate correction-plan gate;
do not weaken validation, invent financial history or rewrite frozen amounts.

2 November reconciliation: PR #359's CPU-failure/shift-conflict commit titles
record diagnostic evidence, not runtime CPU corrections. Its five-file diff is
memory/tracker, the historical recovery review, superseded one-shift replay and
isolated recovery test. CPU #360 and slow-network #361 are already beta ancestors;
do not merge #359 to obtain those fixes. Its original cashier-closing target and
obsolete-replay HOLD remain unchanged.

AUTH-37 pre-patch independent investigation is complete. The selected boundary
is a dedicated Ed25519 Main-only author key, with separate enrollment and intent
signature domains binding configured project, registered terminal, stable
app_users.id, key and exact frozen action/payload. Enrollment derives the author
from verified signed cashierToken.id or verified Auth identity, never an editable
username/email or a terminal transport proof. Username-only legacy session
adoption/checkout remains intact but cannot enroll a protected author key. Both
Operations and authorized Management Electron bindings are supported; enrollment
itself grants no action or branch access. No existing approval/session/iOS key is
reused. Private local material is OS sealed and never exported through IPC;
missing/mismatched key material cannot automatically replace pending signatures.
Current effective permission gates NEW writes; exact accepted history is a
no-write acknowledgement. Revocation never silently discards a pending intent.
Necessary stable-profile fields in existing verified identity responses are part
of this approved source preparation. No live enrollment, device key generation,
database application or legacy compatibility cutoff is performed.

The independent sink trace disproved the provisional raw-shift REST financial
bypass: shifts_guard_client_writes protects lifecycle/count/expected fields and
normal relay shift rows omit those fields. Preserve legitimate opening,
housekeeping and attendance operations; tests must exercise the actual trigger.
Do not add a blanket key requirement to typed personal web/mobile workflows.

Separate confirmed trust gap: draft graph checks establish internal consistency
but do not compare expected amounts to saved transactions. Signatures establish
the author, not correctness of a caller-chosen financial graph. A narrow proposal
must use the existing authoritative formula and account for concurrent sale/
refund admission before claiming this closed. No financial-formula, checkout
trigger, booking-attribution or live-record change is authorized by recording
this finding. Keep this validation/approval gate explicit while independent
author/protocol preparation continues.

**Confirmed authority blocker; keep protocol/release draft.** Native audit
found `terminal:read` classified OPEN in ipc-privilege and returning the complete
sealed terminal-store configuration from Main, including deviceBindingProof.
A cashier-controlled renderer can therefore obtain the transport credential.
CAS graph tokens, unkeyed payload hashes, or an HMAC using that same readable
credential do not prove an authorized historical administrator created a recount.
Service-role SQL tests alone cannot establish per-user authorization. A direct
API caller with that credential could forge RECOUNT/VARIANCE actor fields in the
existing trusted-terminal model and the draft protocol. This is source evidence,
not a live attack or changed account/grant. Do not treat the problem as resolved
by current-user administrator gating, which would break approved background
upload of earlier authorized offline work.

Read-only design is required for a protected, server-verifiable historical author
attestation or rigorously protected credential/request boundary. Inspect existing
installation-key/activation mechanisms first; a public-key registration must not
be authorized by the already-readable device proof alone. No signing key creation,
rotation, provisioning or broad login/setup proxy rewrite is approved by SHIFT-36.
Do not simply remove the proof from terminal reads without replacing required
login/setup/configuration consumers. Present a concrete separately scoped plan
before those changes. Existing operator database credentials and iOS signing keys
are untouched. Independent protocol/schema/race preparation can continue; no
merge/deployment or claim of complete permission safety is permitted meanwhile.

AUTH-37 refined preparation **approved by the owner on 2 November**, superseding
the unanswered terminal-manager-only proposal: bind a separate Main-only signing key to each actual verified
author, terminal and project. Enroll automatically from that same person's first
successful online PIN/password/session adoption, using existing live permission
resolution; management authority cannot bind an arbitrary key to another admin.
Do not repurpose approval OAEP, local-session or iOS keys. No generic signing IPC.
Sign frozen subject/action/intent only inside the existing permitted Main commit.
Server checks registered key/signature plus that author's current effective action
permission before NEW writes. Identity enrollment grants no financial permission;
new grants apply normally, revoked grants retain new uploads for administrator
review. Existing accepted identical receipt replay remains no-write historical
acknowledgement, never baseline regression or effective money replacement.

Offline sign-in and ordinary sales remain available. An author who has never
verified online must do so once before protected shift uploads can be delivered;
reconnect alone cannot authenticate them. Keep those signed local intents pending
without caching plaintext PIN/password, swapping the actor or downgrading to
unsigned upload. Enrollment timeout must not fail login/checkout; asynchronous
completion cannot replace the current signed-in session. Late enrollment of the
same protected author key relies on the trusted installed Main/OS boundary and
is part of the explicit proposal. Preserve pending signatures on key mismatch;
replacement/recovery requires an authorized process, never automatic rotation.

For enrolled terminals require signed sensitive shift writes across v3/legacy
aliases so leaked transport proof cannot bypass author checks. Older un-enrolled
first-close compatibility remains an explicit rollout/cutoff decision, not proof
of complete legacy API security. A version string alone cannot authorize bypass.
The owner approved source preparation and isolated tests, including ephemeral
fixture keys only. No real device key creation/enrollment, existing key rotation,
live database edits, deployment or unsigned-legacy rollout cutoff is approved.
Apply the security fix workflow: a fresh independent read-only boundary and
compatibility investigation precedes editing; freeze the implementation/DTO;
after focused checks use one fresh read-only bypass/regression review and ordered
verification. Report signed-path remediation separately from unretired legacy
compatibility and physical-device/deployment evidence; do not claim the whole
system's terminal authorization is fixed merely by adding signatures.

Necessary offline dependency: capture the **actual OPEN postimage** inside the
normal AggregateRepository opening commit in local protocol metadata. This is
within approved local metadata preparation, not permission to invent an OPEN
from a later CLOSED row. Preserve real OPEN → offline sales → closing/correction
order; sending a closing first makes the existing closed-shift sale trigger deny
valid later-uploaded sales. Include prior CT-only financial uploads and ordinary
opening journals in ordering tests. Unknown pre-upgrade opening facts stay pending
for explicit review; do not weaken sale/stock/receipt or branch authorization.
Metadata and ACK/journal acknowledgement must commit atomically, and proven
accepted CT copies must not globally skip unrelated edits or old history gaps.

Permission evidence must include actual IPC/verified relay paths: graph tokens
are compare-and-swap preconditions, not authorization. A user without recount/
variance permission cannot gain it by forging actor fields; an explicitly
authorized user's offline intent may later upload in the background after a
different cashier signs in, retaining the real historical actor. Preserve
existing granted and denied cases rather than hardcoding role names or granting
new permissions. Complete offline OPEN/sales/close/recounts and in-flight change
cases need actual source boundaries, not only service-role SQL fixtures.

The owner explicitly approved the protocol preparation and isolated tests on
2 November, including the original-count save-path retry verification extension.
Approval covers the API/local metadata/service-routine source contract described
below and isolated databases only. It does not authorize applying any migration
to ROSEGILL or an installed POS_Local, historical repair, production deployment
or publication. Continue from current beta 41463049 plus the reviewed SHIFT-34/35
source dependencies; keep their original commits and scoped regression evidence.
Necessary protocol metadata is included in that approved source/isolated scope:
private append-only server intent receipts bind immutable payload, verified
branch/terminal/shift, frozen base/predecessor and accepted result token/proof;
local baseline and frozen-intent metadata support atomic adoption/offline chains.
No cloud business columns/history are changed, no client Data API table access
is granted and nothing is applied live. Existing project/business identity must
be used; Supabase organization ID must not be invented as an application tenant.
Historical superseded receipt replay can acknowledge its immutable intent but
cannot rewrite effective money or regress a device's accepted baseline.
The agreed contract keeps existing organizationId literal `default` under the
current project database boundary; no invented organizational tenant column.
Atomic read returns six graph tables plus an opaque digest/raw close timestamp.
Protected requests send frozen UTF-8 payloadJson once (no duplicate outer ops),
with base token OR immutable predecessor intent ID/hash; per-shift v3 proof
binds intent/hash, accepted/current token and superseded status. Server pins
existing identity/times for recounts. ACK only marks its accepted intent; only
pending-aware atomic graph adoption installs an observed baseline/generation.
Durable generation/tail order includes in-flight and already-ACKed local intents
to support offline chains; never replace a frozen base at send time. Preserve
legacy first closes and exact historical replay and reconcile only proven CT
copies, without globally advancing unrelated checkpoints.
Root owns the shared contract, existing tracker/memory and integration. Agents
must agree request/proof/receipt and offline ordering before editing shared
dependencies; one writer per file. Do not silently drop superseded/pending tasks.

Independent source review confirms that a read-side revision fix alone cannot
preserve later administrator corrections: queued CLOSED99 can replace accepted
web CLOSED5/6 before the existing v2 acknowledgement inspects it. Comparing graph
membership only at send time is also insufficient because PushWorker enriches
old intents with the current local graph. No existing journal field proves which
effective server closing was known when the correction was made.

Approved bounded preparation:

- Add one service-only, branch-scoped atomic closing-graph read to the existing
  verified sync API. Return parent, complete count/reconciliation/event/summary/
  alert graph and opaque server digest over authoritative effective facts. Keep
  native branch/actor validation and management scope unchanged.
- Persist the accepted digest in separate local metadata, atomically with whole-
  graph adoption; never derive it from local row_version or round PostgreSQL
  microsecond timestamps through JavaScript. Freeze the accepted baseline in the
  protected correction intent/journal at commit, not in send-time enrichment.
- Send that frozen precondition through the existing aggregate endpoint; lock
  and compare it before **any** parent/child write in aggregate/batch/replay
  paths. No new cloud business table/column is inherently required; new service
  read/preflight routines, local metadata/upgrade and request contract are needed.
- Preserve first legacy OPEN-to-CLOSED upload and identical confirmed history
  replay. A different legacy CLOSED with no proven baseline must remain pending
  as a visible conflict; never accept all old closures or reject all production
  first closes. Do not attach today's baseline to yesterday's queued correction.

Likely source boundary: existing sync-endpoint.server.ts; reviewed additive
Supabase migration plus schema/generator parity and service-only helpers in
push/proof/replay routines; existing native cloud/pull/push/change-reader and
bootstrap modules; protected shift journal plus a narrow local baseline
repository/migration/generated artifacts; focused native and isolated database
tests. No live application, credentials, grants, device configuration, historic
STR1 repair or Membership work is included. A precise final file list and
recoverable baseline precede implementation.

Required evidence: stale CLOSED99 versus accepted web5/6; offline admin correction
made before an unseen web change conflicts without losing the queue; correction
made after atomic adoption succeeds despite independent counters; superseded
receipts cannot undo later changes; legacy 1.4.79 first close works; page-split
graphs adopt atomically; simultaneous admins serialize; branch denial; timeouts
roll back and retain baselines/journals/cursors. Preserve configured shift modes
and one effective closing with immutable audit history. SHIFT-34/35 preparation
alone must not be described as completing this convergence protocol.

Related approved extension: the original cash-count path has the same
broad duplicate-key success shortcut as recounts. Generalize saved-intent replay
verification to ORIGINAL without requiring a CLOSED parent (its initial variance
review state is valid); verify the original saved reconciliation/event and
preserve later recount money. Do not reuse the CLOSED-only recount validator
unchanged or alter initial counting/variance permission rules. The owner included
this extension in the later protocol preparation/test approval above.

### SHIFT-34/35 combined preparation checkpoint

Source components: native recount `e15ec1fd11c613909563e02de3088668976a71c2`
and safeguards `ccbd338d53efe76832398144f1191ef0bb4ecc28`; isolated integration
`0a670f58` plus subsequent approval/documentation and fixture adaptations.
Root pinned-Node22 full run passed **606 suites / 4,362 tests** in 80.61s.
The first sandbox run failed generated SSR temporary-module imports; unchanged
unsandboxed rerun exposed one outdated exact-call fixture, updated to assert
the verified branch and complete changes argument. No behavior assertion was
removed. Final full run passed. Types passed; full lint has zero errors and two
explicit-any warnings confined to the new SQL fixture Row aliases.

Root reran **24 actual disposable LocalDB scenarios** with the combined guarded
CloudClient: the harness now creates real synthetic journal/checkpoint/CT tables
and an explicit fixture baseline instead of bypassing pending checks. It touches
only a random owned LocalDB instance/database, which is cleaned afterward.
Root isolated PostgreSQL closure **71 cases** passed; native Main/full-graph
**19 cases** passed after adapting the thin download fixture to matching/deferred
outcomes and verifying the retained OPEN99 boundary. The exact reviewed LF #357
artifact was used; no migration content or assertion was weakened. Existing
known lower-counter convergence stays unimplemented in these safeguards.

Independent review separately passed 50 recount/journal and 37 safeguard cases
and identified two index guard gaps, corrected and retested on the real fixture
engine. Unknown filtered/composite/operator-configured indexes now stop before
DDL and preserve rows/configuration. No installed POS_Local or cloud data was
accessed. New protocol work remains source preparation in separate native/server
branches, not production readiness, live migration approval or historical repair.

Draft beta PR #363 head d903342b exposed a genuine non-shift regression in CI:
the new outcome return could suppress initial settings-loaded notifications.
Root restores the original void/result handling for non-shift writers/bootstrap,
keeping exact outcome checks limited to the six closing tables. All **80 native
CI scenarios**, including the unchanged shared-identity announcement test, pass;
the complete **606 suites / 4,362 tests** pass again (85.23s). This correction
preserves existing settings behavior; no assertion or runtime guard was relaxed.
Native protocol author is required to retain it in subsequent integration.

Latest controlling update, 2 November 2026 — **REL-31 pending beta PR integration**.
PR #360 is merged as `cdc7bbed`; PR #361 is merged as `0bc58a16`, and its final
platform/security/hosting checks passed. The owner now also requests the pending
dependency bumps and prepared lifecycle source through beta before production,
with Retail 1.4.81 metadata. REL-31 supersedes the earlier REL-30 exclusions for
those reviewed source changes only. Superseded recovery PR #359 remains HOLD;
no live migration, recovery, production merge or installer publication has run.
The owner's later release request expands the earlier code/test-only approval to
these two beta merges and production preparation; installer publication, main
promotion and live repairs retain their separate gates. CPU source branch
`codex/sync-response-cpu-beta`
starts from beta `fd41a37fc63613931aae58e11bd833c8634618e4`. Runtime scope is
`src/lib/sync-download-redaction.ts` plus focused tests; root owns this existing
memory/ledger update. Independent agents own implementation and read-only review.
Production Cloudflare `retail-pos`, deployment `a70a936e`, recorded
`/api/v1/pos/sync` HTTP 503 with outcome `exceededCpu`, 141 ms CPU and 4,026 ms
wall time at 2 November 11:23:28.055 Brunei. Supabase's sampled
02:06:58–03:06:58 UTC window showed 304 bootstrap RPCs returning 200 (maximum
3,651 ms upstream), no logged API status >=400 and no PostgreSQL error. These
windows do not establish request-by-request correlation or helper CPU attribution.
Local `ECHANGEGAP` blocks pull and snapshot failure prevents baseline recovery;
the warning must not be hidden or its checkpoint reset.

CPU acceptance: preserve byte-equivalent masking for normal/management callers,
deep table context, secret/e-commerce handling, property order, nulls/arrays and
prototype safety; do not mutate input or lose any row/ID/cursor. Measure complete
synthetic parse/redact/serialize work; local timings do not prove hosted CPU-limit
acceptance. Require focused regressions, independent review and exact-head CI.
No database, grants, device settings, schema, pagination or shift-mode changes;
publication and production promotion need their separate approval. Rollback is a
targeted source revert before deployment; no live records changed by this batch.

Preserve separate pending tasks and newer evidence tracked in draft PR #359. Its
metadata-only old STR1 repair is HOLD after the confirmed deliberate web closure;
both full private graphs are captured and original cashier facts selected, but
reconciliation needs a new audited plan and separate execution approval. Existing
multiple-shift setting enforcement, native recount replay/uniqueness, web-to-PC
independent-counter convergence and legacy CT protection are separate findings,
not authorized runtime scope for SYNC-CPU-01. Membership remains ON HOLD.
Read [../AGENTS.md](../AGENTS.md) and [PROJECT_MEMORY.md](PROJECT_MEMORY.md).
This is the single current task ledger. Existing audit/checkpoint documents remain
supporting evidence, not competing completion lists. Batch 0 authorized documentation
only; the owner's subsequent Batch 1 approval below authorizes its bounded fixes.

## Active plan and approval boundary

| Order | Batch / current state | Exit requirement |
| --- | --- | --- |
| 0 | **Verified: owner-approved documentation only** | Original rules preserved; memory/ledger linked; carried-forward tasks and branch-lock decisions recorded; documentation-only checks and independent review completed. See evidence log. |
| 1 | **Implemented: owner-approved trusted terminal identity and native branch boundaries** | Code commit `608398c6` pushed to beta PR #341; isolated regressions and CI passed. Preserve real-device and alternate-authority acceptance limits below. No live DB change or publication. |
| 2 | Pending approval: management/account scope and alternate authority paths | Correct assigned/selected/terminal scope without blanket role grants; review direct database and legacy RPC boundaries. |
| 3 | Pending approval: settings and permission lifecycle | Section/path/tier ownership, live permission semantics, revocation and saved-state checks agree. |
| 4 | Pending approval: atomic booking collection and receipt recovery | One authoritative financial/stock/link transaction; stable replay; canonical payment identity; ambiguous legacy records remain review-only. |
| 5 | Pending approval: received-payment accounting and remaining sync/inventory gaps | Deposits counted once when received; pending-origin integrity; reviewed warehouse/cluster findings. Split into smaller batches where dependencies require. |
| 6 | Scoped UI refinements DEC-23 through DEC-30 implemented/verified; broader UI audit pending approval | UI-08/10/11/12 scoped verified as recorded below. Broader audit and final physical-device regression remain separate. |
| 7 | Report-only correction implemented / scoped-verified, DEC-32 / FIN-11 | Separate commit after c514762d; align report scope/refund totals and adjustment/sponsorship labels. Preserve checkout/receipts/stock, records and formulas. Publish source to the beta PR and check CI. Owner compares originals for suspected missing bills. |
| 8 | Approved Archive UI clarification DEC-38 / INV-08, committed / scoped-verified | Separate active/archived totals, mode and search/advanced filter context use the authorized catalogue. Commit `45893068` pushed to beta PR #341; tests/types/lint/build passed and desktop/390px render checked. Its CI is running. Stored-count completeness and final live filter interaction remain unverified. |
| 9 | PERF-12 committed / scoped-verified | `6defed4f`: single refresh ownership, settings readiness and cancellation fences. Preserve genuine trailing changes, offline SQL and all authority scopes. Physical-device acceptance remains separate. |
| 10 | UI-15 committed / scoped-verified | `14cd2c9a`: loaded-zero summaries hide;220ms appearance/reflow with reduced-motion support; All Shops remains complete. Desktop/phone synthetic-browser checks passed without interaction network reads. |
| 11 | FIN-13 follow-up committed / migration applied | `43d114f5`: authoritative branch-scoped cashier picker and native proof validation. Exact approved cloud migration applied/permissions verified; actual signed-in form/device check pending. |
| 12 | SHIFT-14 v2 source verified / live applied after approval | ec4e3e7e fixes the v1 independent-revision regression. All seven actual shift triggers are installed in24 passing isolated cases. Owner approval received31October; exact reviewed helper applied with livehistory20261030234442. Read-only live proofs return v2/cloud4/requested9; service-only access preserved, no business rows rewritten. Installed-device reconnect acceptance separate. |
| 13 | HISTORY-16 / SHIFT-15 committed/pushed/scoped CI verified | ff94abb8 removes Shifts sign-in-history entry and adds store-day range shortcuts. Real browser Previous/Next moved both dates31→30→31 on ReceiptHistory; no transaction submitted. Shift/mobile interaction checks remain. |
| 14 | INV-18/19/UI-20 committed/pushed/scoped CI verified | 2ce39509 compact low/negative number actions, reviewed count handoff and exact current-stock search across Active+Archive. Permission/branch denial and retry recovery tests passed; no live quantity changes. Actual UI checks remain. |
| 15 | REFRESH-17/PERF-18 shared-popup correction approved / active | Owner approved scoped shared popup wrappers/context and isolated browser tests31October. Keep mounted same-scope drafts, gate-owned portals inside the pause guard, release focus/pointer locks for Retry, preserve native offline access. Ordinary row refresh does not navigate/reload; exact intermittent freeze cause not yet proven. |
| 16 | LOC-21 committed / NOTIF-22 additive correction prepared and independently verified | New20261030234813 fixes existing-event foreign-branch acknowledgement;23 isolated PostgreSQL/generator cases,6 real independent-session races and44 related tests passed. Activity-only canonical/generator parity and CI step included. Live application NOT approved/applied; core rules remain unchanged/unactivated. |
| 17 | PERF-24 committed/pushed/scoped verified | 8b840192 fixes first-paint report completeness, restored-session landing and scoped-settings initial readiness/retry. Independent review passed; 11 focused suites/96 tests passed. Latest PR checks are green. No formula/grant/Membership change. |
| 18 | AUTH-12 committed / exact-head CI passed | afcf92d1 shared public PIN response boundary covers both transports, alias, lockouts and validation probes. Private counters, grants and offline handling remain.13 suites/157 tests plus12 isolated SQL scenarios passed. Exact-head securityCI:578suites/3765tests passed/1skipped; Android, Windows, iOS and Cloudflarebeta checks passed. No merge/publication. |
| 19 | TERM-13 implemented / focused verification and independent review | Protected recovery links, awaited saved-profile status, retry/stale-read fences, strict Electron store restore and verified roster503 classification. Preserve saved bytes, true denials, branch authority and checkout; all-platform automated route/gate cases pass. Physical-device acceptance remains separate. |
| 20 | TRF-15 merged into beta / approved live upgrade applied | PR350 head610df65e passed exact-head checks and merged as c15fdd21; merge tree equals the tested head. Atomic dispatch/request completion, immutable retry intent, verified native actor and safe errors; migration history20261031074715 verified. Installed-device acceptance remains separate; the reported transfer remains undispatched. No installer publication or main promotion. |
| 21 | TRF-16 merged into beta / approved guard and exact repair applied | PR350/c15fdd21 includes the new fulfilment-ID correction; shared checkout IDs unchanged. Guard history20261031083126 and one audited request-line restoration verified; request-integrity read returns true. Full592 suites/3987 tests and exact-head platform/security checks passed; beta website deployment passed. Physical-device acceptance remains separate. |
| 22 | SQL-08 implemented / isolated and signed-in local Settings verified | Separate approved typed adoption/read-error correction preserves terminal binding and cashier authority. Full595 suites/4091 tests, TypeScript and full lint pass. Owner-approved HTTPS beta backend plus original native origin43117 permits normal verified sign-in and seals the recovered existing proof; Approvals and Settings open with STR1/local SQL ready. Other devices/offline real-sale acceptance, commit and beta PR remain separate. |
| 23 | SQL-09 active read-only investigation / correction not approved | Separate expired change_history Change Tracking and HTTP503 bootstrap warnings remain after SQL-08 sign-in recovery. UI reports local SQL ready and queue0/errors0, but this is not proof of successful bootstrap. Identify exact failed table/stage from existing jobs/logs without resetting cursors, resyncing, changing Membership dependencies or touching pending/business data. |
| 24 | SHIFT-28A merged beta b31c74e4 / PR #353; SHIFT-28B read-only affected-PC inspection | Full 600 suites/4,193 tests, TypeScript/lint, 68 PostgreSQL scenarios, exact-head CI and Codex code review passed. Preserve checkout, receipts, branch/actor identity and v2 acknowledgement. Existing stuck shifts are not repaired. Owner resumed UltraViewer inspection; credentials remain user-entered. TERM-29 is owner-verified in latest beta. |
| 25 | SHIFT-31 merged beta 423950b4 / PR #355 | Complete-history All/Open/Closed and permitted column filters before paging, clear retained filters, precise row/dialog identity. Full 601 suites/4,204 tests, TypeScript/lint, independent review and desktop/390px synthetic browser interactions passed. Exact-head platform/security/deployment checks and Codex code review passed. Merge tree equals reviewed e334fc52; installed-device acceptance remains separate. |
| 26 | SHIFT-32 prepared / independently verified / draft beta PR #357 | Two existing service-only routines prevent stale reopening and validate existing-receipt replay.71 canonical/captured SQL scenarios,16 real concurrency cases,19+19 full graphs and94 focused tests passed. Updated head a5d31e67 includes required test inventory registration and beta ead66f30; integrated602 suites/4,249tests passed. Remote CI rerun pending. No live application or historical recovery approved; native convergence remains separate. |
| 27 | REL-29 cumulative production draft PR #354 / not signed off | Separate beta-to-main draft labelled production/awaiting-owner-approval. Explicit version proposal, installed Windows acceptance, exact live dependencies and unresolved critical risks remain gates. No exact promotion/main merge/release approved. |
| 28 | SHIFT-33 merged beta ead66f30 / scoped-verified / PR #356 | Five approved files; current native errors defeat zero-queue green claims. Root full602 suites/4,249tests, TypeScript, scoped lint and independent desktop/phone/IDB checks passed. Exact-head CI and Codex review passed; merge tree equals tested a3945e5f. No polling/retry/queue/schema/data/permission changes. Installed-device acceptance remains separate. |
| 29 | SYNC-CPU-01 merged beta cdc7bbed / PR #360 | Merge tree equals reviewed head 651348bb. Exact-head platform/security/hosting checks passed; CodeRabbit skipped. Combined 604 suites / 4,305 tests, 79 native/release tests, types/lint/build and independent patch-risk review passed. Common synthetic history CPU improved; wide stock maps did not materially improve. Hosted acceptance remains separate. No main promotion or installer publication. |
| 30 | SHIFT-28B fresh evidence captured / old replay HOLD / draft PR #359 | Complete original PC manifest and current cloud graph captured privately; digest independently verified. Owner confirmed a later deliberate web closure and selected original cashier facts while retaining web history. Never stage the superseded replay; propose and obtain approval for a new exact reconciliation. Current drawer, queues, checkpoints and business data remain untouched. |

Membership is **ON HOLD** throughout. Each future batch requires a recoverable
baseline, specific files/dependencies, expected behavior, risks, regression tests,
recovery plan and owner approval. This roadmap does not grant implementation,
database, merge, release or production-promotion approval.

## NET-02A/B — approved native slow-network correction, 2 November 2026

**Implemented and locally verified; beta PR/CI and installed-device acceptance
remain separate.** The owner explicitly approved code and isolated tests for
`electron/telemetry.cjs`, `electron/sync/cloud-client.cjs` and focused tests only.
Branch `codex/native-slow-network-beta` starts from current beta
`fd41a37fc63613931aae58e11bd833c8634618e4`. Root owns the existing tracker/memory;
separate agents authored each runtime module and independently reviewed both.

Telemetry now shares one complete active beat across local status reads and HTTP,
keeps the latest presence, absorbs duplicate timer/presence calls, and bounds
transport/body cleanup to 30 seconds. Stop aborts transport and fences subsequent
HTTP/trailing work; restart waits for already-running local reads without
overlapping SQL. Existing local query timeouts remain unchanged. A stuck stream
cancellation promise cannot retain ownership forever; its late rejection remains
observed. Payload and the 60-second cadence are preserved. Telemetry remains
best-effort and never blocks trading on remote acknowledgement.

CloudClient.request now preserves successful-status body timeout/abort failures
as ETIMEDOUT, as for header timeouts, and retains unrelated body-stream failures.
A known HTTP refusal remains authoritative. Malformed JSON is still failure;
real non-JSON 503 diagnostics retain their existing bounded recovery. Complete
JSON acknowledgement is required before pending uploads can be acknowledged.
No retry policy, queue, cursor, permission, branch or checkout file was changed.

Pinned Node 22.22.2 verification on this Windows development PC:

- Root: all **604 suites / 4,294 tests** passed with `vitest run --maxWorkers=4`
  in 86.43s; native sync/startup/event/shutdown **63 tests** passed.
- Root: `tsc --noEmit`, scoped ESLint, both CJS syntax checks and diff checks passed.
- Independent reviewer: four focused suites / **84 tests** passed, including
  actual CloudClient/page-policy backoff and PushWorker pending/replay integration.
  The uncooperative body-cleanup hang was reproduced, corrected and independently
  retested. Extra probes found zero retained application abort listeners, no
  deadline timer after completion/stop and only the expected interval on restart.
- No live HTTP, SQL, profile or business-data operation was used for these tests.
  This is not full physical-device, slow-network or hosted acceptance. Exact-head
  CI/builds remain gates; no merge, manual deployment or publication was performed.

Root also simulated integration with CPU PR #360 head `651348bb` using
`git merge-tree --write-tree`, without changing a branch, index or working tree.
The first simulation found only a task-ledger header conflict; the native scoped
notes were kept separate from the concurrent global reconciliation header. The
subsequent simulation was clean and retained both patches' exact runtime/test
files and dated instructions. This is textual integration evidence, not a merged
branch, combined-runtime acceptance or deployment authorization.

Frozen SHA256, matched by root and independent reviewer:

| File | SHA256 |
| --- | --- |
| electron/telemetry.cjs | 4D405400CD1F66D7CD4C76F903E8536319D2B036B50E40020E591BE5CEE0BB41 |
| electron/sync/cloud-client.cjs | B19B4F3074FDF4DF38E060CF291CFEA60F454803F9E5AB691F71EF99202071FE |
| native-telemetry-lifecycle.test.ts | F9EB38DEC3D0B368EFC9051832FAB8743CC6878F17504C18F3DE6441CE56E5B2 |
| native-cloud-response-timeout.test.ts | DF6DE29E4A9B10C92E4B612327CC006C8672978BE62E2D1EBB0A8137C6502949 |

Prior read-only audit evidence remains in draft PR #359: 14 idle client
connections at 12:11 Brunei, no idle transactions/lock waits; 91 focused web
tests and four synthetic native checks passed. Pools are not one-per-terminal.
NET-02C/D request cancellation and obsolete catalogue work, NET-02E sync-pass
budget risk, and health()'s older body-failure labeling remain separate pending
paths. The request-only fix does not change health/readiness semantics. Preserve
Membership and its dependencies on hold; no database/pool/settings/grant changes.

Separate CPU draft PR #360 head `651348bb` passed Android, Windows renderer,
iOS, security and hosting build checks; CodeRabbit skipped. It remains unmerged
and is not production deployment approval. Original STR1 repair remains HOLD:
the owner confirmed a later web closure, selected original cashier facts and
requires both histories preserved. Never stage the old replay; a new exact
reconciliation plan and execution approval remain necessary. Preserve all other
unfinished tasks. Rollback for NET-02A/B is a targeted source revert, retaining
subsequent unrelated changes; no live data rollback is needed.

## REL-30 — owner-approved beta integration and production preparation

On 2 November the owner requested merging the completed fixes into beta,
updating the beta version and preparing a production release if readiness is
satisfied. Scope is reviewed CPU PR #360 and native-network PR #361, preserving
existing features through targeted PR merges. Do not include held preparation
PR #357, superseded recovery PR #359 or unrelated dependency upgrades. No live
database repair, main promotion or installer publication is implied; beta
installers retain the explicit "Publish beta now" gate and main retains approval
for the exact separate promotion. Current work is merge preparation, not a claim
that the cumulative production candidate is fully verified.

Combined immutable local candidate `efe5b6c21b1382e1e3e4d9dd752f6f56521f414d`
from beta `fd41a37f` contains exactly the two reviewed patches: eight changed
files, identical runtime/test blobs and no migration/workflow/version change.
Root pinned-Node-22 verification passed 604 suites / 4,305 tests (84.96s),
79 native/release safeguard tests, TypeScript, scoped lint, diff checks and web
build. Build-generated report was excluded after private preservation; its two
informational numeric-input notes remain unverified separate follow-up. Both
individual PR heads passed platform/security checks; CodeRabbit skipped. Remote
merge SHAs, final exact-beta CI and actual hosted acceptance remain to be recorded.

PR #360 merged to beta as `cdc7bbeda87d4ccfef9b3fb313cdcf5de5c76d63`; root verified
its tree equals reviewed head `651348bb`. That beta was then merged into the
existing PR #361 branch without conflict, preserving both source patches. Relative
to the tested combined candidate, only release-tracker/checklist documentation
changed. Exact new PR #361 head checks are required before its merge. The bound
eight-file patch-risk assessment was independently schema-validated via stdin:
recommendation merge / human_review_required; high impact, low likelihood,
partial rollout protection, managed recovery and moderate confidence. Exact
patch SHA256 `04c3625f3c1490bea1474411c0bdef2635955763707d3a67824ff1a5bd3b0300`.
This is not a cumulative production security scan or installed-device acceptance.

Next beta calculation is `1.4.81-beta.3`; committed source remains `1.4.80`.
Do not commit generated beta version files. Proposed stable `1.4.81` still needs
a reviewed metadata decision; changing beta's base first would change its next
beta identity to `1.4.82-beta.1`. Production draft PR #354 must retain installed-
device, hosted CPU/recovery, exact database dependencies, lifecycle/convergence
and unresolved critical audit gates. Preserve all pending work and Membership
hold; never clear queues or restore an older database as release rollback.

## REL-31 — remaining beta/chore upgrade reconciliation, 2 November 2026

The owner requests checking the other beta PRs and version/core/chore bumps,
keeping beta consistent and moving validated upgrades through beta to production.
Continue the latest request; the earlier interruption did not cancel pending
tasks. Current beta is `0bc58a16`; production remains `2f404e6f` / v1.4.79.
Review dependency PRs #343–#347 and prepared #357/#359 individually; do not
equate an open PR or old green checks with current compatibility. #343 currently
has failed checks; #359's repair premise remains superseded/HOLD. Live database
application still requires its exact-project approval; source merging is not
repair execution. Membership and dependencies remain on hold.

Isolated integration branch `codex/beta-upgrade-integration-20261102` starts from
current beta `0bc58a16be9398ec14eecb636e8d3e1aac2b36e3`. Do not install or rebuild
dependencies in the shared node_modules junction used by active previews. Use
separate dependencies, preserve lockfile integrity, inspect direct/transitive
changes and verify React/renderer agreement, popup module ownership and native
compatibility. Preserve all source fixes already merged in #360/#361.

Record per-PR disposition, exact reviewed heads, tests, beta integration and
production gates before promotion. Do not silently include an obsolete data
repair, widen grants, rewrite existing worktrees, rotate signing keys, change
operator configuration or declare full installed-device acceptance from CI.
The production promotion's version/readiness constraints remain in PR #354 and
the existing go-live checklist; no publication tag/dispatch has been created.

The owner clarified that this means the pending beta PRs, including the prepared
lifecycle guard and chore/dependency bumps, and selected Retail **1.4.81** for
production metadata. Source-only #357 integration is in scope after fresh checks;
applying its SQL to ROSEGILL still needs separate exact-project approval. #359's
obsolete recovery is not a valid data correction and stays HOLD. Prepare a
reviewable version-metadata update; preserve the next-beta calculation and do not
create installer/publication tags without the separate publication request.

REL-31 integration evidence: candidate `5bb6c488` preserves all six original
PR heads (#343–#347 and #357) as ancestors of one combined branch, starting from
beta `0bc58a16`. Tabs/Toggle had only adjacent manifest conflicts; both requested
upgrades were retained. React PR #343 originally failed because React DOM still
resolved to 19.3.0. Corrective head `f250d9e9` pairs both at 19.3.1; its exact
security, Android, Windows-renderer, iOS and hosting checks passed. No existing
dependency is removed or downgraded; popup runtime aliases remain unchanged.

A fresh, separate dependency directory was installed with pinned Node 22 and
npm 11.4.2 (`npm ci --ignore-scripts --no-audit --no-fund --prefer-offline`).
Root verification on the combined dependency/source candidate passed all
604 suites / 4,305 tests, full TypeScript and full ESLint. Native/release tests
passed 79 cases. Independent real-browser synthetic fixtures passed 46 popup
and 10 terminal-login cases with no external requests or browser errors.
Independent isolated SQL checks passed 137 closure/full-graph/notification/
canonical scenarios; they did not read or change live data. A first guard run
failed because the Windows checkout converted the reviewed SQL artifact to
CRLF; restoring the exact reviewed LF Git bytes made the unchanged assertions
pass. This is an artifact limitation, not a portability fix. Optional fresh real
concurrency/captured-live runs and physical devices remain unverified this cycle.

The owner-selected 1.4.81 preparation changes only the five existing generated
version sources; the two SQL files change version text only, with no new local
migration. Next calculated beta is consequently 1.4.82-beta.1; do not force the
older beta identity or publish installers without the explicit publication
request. Final platform builds, immutable-head CI and independent diff review
remain required before the combined beta merge. Use a merge commit to preserve
original PR ancestry, then verify each original PR's actual merged state; do not
mark a merely closed PR as merged. No old recovery script is included.

Production PR #354 remains a separate cumulative promotion. Existing local
recount uniqueness/false-replay, independent-clock convergence, hosted/device
acceptance and exact live-migration dependencies remain explicit gates. This
dependency/source integration does not correct them or authorize applying #357
to ROSEGILL. Preserve original STR1 and web closing histories; do not execute
the superseded #359 replay. Rollback is a reviewed targeted revert of this
integration, preserving subsequent work; no business-data restore is involved.

Version-prepared web and Windows-renderer builds passed. Web approval boundary
verification passed for 360 JavaScript files; SQL Server registry verification
passed for 70 tables. All 56 focused version/beta-publication/database/sync tests
passed unchanged outside the sandbox: the first run's two failures were Git Bash
MSYS namespace permission failures before assertions. The build-generated
logic-health report is excluded after private preservation; its same two
informational notification numeric-input notes remain separate/unverified.

## How to maintain this file

- Capture each new instruction/correction before dependent implementation; add or
  update an ID, source/decision reference, affected scope, acceptance and next step.
  Use the decision log below when it supersedes earlier wording. Update memory for
  an approved lasting rule, not every experiment or suspected defect.
- Preserve unfinished tasks through new requests, pauses and handoffs. Record
  cancellation/supersession explicitly; never remove an unresolved row to tidy up.
- Keep a single editor per file during agent work. Delegate bounded investigation
  or implementation with explicit authority, then independently reconcile evidence.
- A defect record needs expected/actual behavior, reproduction, roles/branch/
  warehouse scope, files/API/DB objects, confirmed cause or remaining uncertainty,
  business impact, proposed correction and regression acceptance. Use IDs in PRs
  and verification notes. Link a detailed artifact instead of duplicating it.
- Completion requires evidence for the stated acceptance at the stated revision/
  environment. Separate code implemented, isolated tests, runtime/device checks,
  SQL applied, PR merged, website deployed and installers/OTA published.
- Source-confirmed means a traced implementation path, not an executed production
  exploit. Never run financial/stock mutations against real data to demonstrate it.
  The same distinction applies to imported security findings and static test checks.

| Status | Meaning |
| --- | --- |
| Pending | Unfinished, awaiting investigation/approval/verification; next step recorded. |
| Active | Work currently in progress within its approved scope. |
| Blocked | A named prerequisite prevents the next step; preserve the task and blocker. |
| Implemented | Source exists or prior execution is recorded, but stated acceptance is not fully verified. |
| Verified | Stated scope passed recorded checks at a specified revision/environment. Never implies all platforms or future changes. |
| On hold | Owner explicitly deferred work; no activation/redesign/change without approval. |
| Superseded / Cancelled | Owner explicitly replaced/cancelled it; keep reason and successor. |

Severity follows the owner's business-impact scheme: **Critical** = security/data
isolation/financial or inventory integrity; **High** = important broken workflow;
**Medium** = inconsistent/confusing behavior; **Low** = minor cosmetic/usability.
This is not a CVSS assessment or a completed formal security scan.

## Decision and instruction log

Earlier conversation decisions are reconciled here on 2026-10-27; dates of the
original statements are not invented. See memory for the full approved semantics.

| ID | Owner decision / correction | What it supersedes or constrains |
| --- | --- | --- |
| DEC-01 | Normal Electron/mobile Operations terminal is permanently branch-locked for all roles, including admin/manager. Enforce every backend/offline path with trusted registration. | Overrides any assumption that a wider role or warehouse permission permits ordinary branch switching on a normal till. |
| DEC-02 | Management admission, account-authorized scope and selected view are distinct; web has no native terminal registration. | Neither NULL assignment nor management type alone grants all branches. |
| DEC-03 | Management local SQL retains authorized shop data; physical co-location does not grant access; retries preserve origin. | Replaces old documentation claiming management SQL synchronization is always blocked. Integration remains defective, not fully verified. |
| DEC-04 | Existing Electron and mobile terminal activation, including Normal/Operations and Management, must be reviewed together with temporary registration/pairing. | Owner clarified the “number two” reference on 2026-10-27; AUTH-09. Do not create a duplicate mechanism or infer removal approval. |
| DEC-05 | Staff management is delegatable through saved `can_manage_staff`. | Later correction supersedes temporary admin-only wording; existing global staff-management scope is not silently changed. |
| DEC-06 | Role presets initialize users; individual additions/denials remain editable. Management sign-in switches belong at bottom of Edit account. | Supersedes earlier placement in Edit permissions; device admission is not an action grant. |
| DEC-07 | Page/action visibility belongs in Edit permissions; approver users/limits belong in Approver rules. | Avoid duplicate “manage elsewhere” controls and invented approval gates for ordinary grants. |
| DEC-08 | Store/system timezone and saved currency govern business display/filtering. | Supersedes earlier viewer-region/timezone suggestion. |
| DEC-09 | Central notification rule table includes WhatsApp and selected users/roles; personal Clear preserves immutable event/delivery history. | Supersedes shared-team clearing and duplicate alert controls. New events must not replay old toasts. |
| DEC-10 | Sponsorship needs selected approval at any amount except configured admin/direct issuers; include discount, reference, receipt, recipient and once-only stock. | Later configured exceptions supersede absolute approval-for-everyone wording. |
| DEC-11 | Deposits count in payment/drawer totals when actually received; merchandise sale counted once at collection. | Approved, not yet implemented consistently. Do not infer historical shift allocations. |
| DEC-12 | Selected approver may approve on the same offline PC only when offline approval policy is enabled. | Preserve identity/action/branch/limit/replay checks and audit; offline phone tokens do not create offline phone billing. |
| DEC-13 | Booking receipt/tag editing stays in Booking Rules & Services; sales receipts separate. | Customer slip plus separate racket tag is intentional, not a duplicate-barcode bug by itself. |
| DEC-14 | Stock quantities in product catalogue are view-only; use purchase/receiving or authorized movements. E-commerce administration management-owned. | Do not silently change opening stock or widen cost/e-commerce visibility to cashiers. |
| DEC-15 | Try configured local SQL before Electron opens; automatic online fallback approved for unavailable SQL, preserving pending/uncertain writes. | Supersedes explicit Continue-online-only recovery choice and older no-fallback documentation. Never retry a business denial as connectivity fallback. |
| DEC-16 | Update availability/install applies to all users, signed out included; circular native indicator near profile/bell/login, hidden after completion. | Supersedes admin-only update controls; publication still requires separate authorization. |
| DEC-17 | Membership is ON HOLD; critical shared dependency changes require approval first. | Supersedes earlier membership tier/email enhancement requests for now; existing data/features stay preserved. |
| DEC-18 | Read-only audit first; small approved batches; preserve unrelated functionality; no silent rules/settings/grant changes. | Supersedes blanket assumptions that earlier “fix everything/publish” requests authorize new unreviewed corrections or promotions. |
| DEC-19 | Owner approved documentation-only Batch 0 on 2026-10-27. | Authorizes the instruction/memory/tracker and targeted documentation reconciliation only. |
| DEC-20 | One clear management home per setting/field responsibility; consolidate genuine duplicate editors after tracing persistence/consumers. | Preserve necessary fields, distinct scopes and separate permissions/approver and sales/booking receipt responsibilities. No application-change approval implied. |
| DEC-21 | One concise update on task start, entry into verification and completion; show completed/working/pending. | Preserve honest verification states and avoid repeated unchanged updates. |
| DEC-22 | Owner approved Batch 1: check Electron/mobile activation for normal and management terminals, fix trusted branch locking, preserve cashier checkout and other functionality, use agents and beta first; Membership stays on hold. | Supersedes Batch-0-only application-work pause for this narrow batch. Does not approve unrelated fixes, live SQL/data changes, native publication or production promotion. |
| DEC-23 | Owner explicitly requests removal of all added sales-breakdown panels, including Home, Selling, All Shops and Reports, while retaining normal totals and receipt details. | Supersedes the earlier request to add those reconciliation panels. Apply as a separate UI-only change/commit, not mixed into branch/security logic or financial formulas. |
| DEC-24 | Show financial breakdown through small hover/click information icons on Revenue, Gross Profit and related summary totals instead of standalone panels; explain original amounts, deductions and resulting value using existing data. | Refines DEC-23. Keep icons compact, keyboard/touch usable, and calculations/receipts unchanged; do not fetch new item histories merely to open a tooltip. |
| DEC-25 | Combine adjacent Products and Categories inventory metrics into one compact card on Live Dashboard and other existing inventory summary cards. Hide zero inventory indicators after loading and reveal changed nonzero values; prevent numeric overflow at desktop and mobile sizes. | Refines UI-08. Preserve calculation, scope, permissions and meaningful loading/empty states. This concerns inventory summaries, not removal of zero sales/payment totals. |
| DEC-26 | On Live Dashboard and Live Business Board, hide loaded zero financial/count cards too; reveal changed positive data and keep nonzero negative financial values visible. Keep All Shops cards even when their values are zero. Align Bills with peer cards. Show Expand table only on phones and align Columns beside the table/section heading. | Supersedes DEC-25's zero-sales exclusion on these two live pages only. Preserve loading/error/empty states, filters, formulas, grants, normal table actions and mobile expansion. Shared table presentation changes need adjacent regression checks. |
| DEC-27 | On smaller screens, summary-card groups (including Inventory position) should swipe sideways with no visible scrollbar; owner clarified an infinity slide, interpreted as a manual loop from last card back to first. Desktop keeps its normal layout. | Refines the mobile stacking/grid presentation of DEC-25/26. Reuse the existing carousel capability; no automatic movement, extra data loading, duplicated business records or widened visibility. Respect reduced-motion, touch/keyboard and too-few-cards behavior. |
| DEC-28 | Owner reinforced DEC-27 for all cards. An intermediate assistant interpretation included whole graph cards after ambiguous wording; the owner then explicitly corrected this in DEC-29. | Superseded interpretation, not continuing permission to loop chart cards. Preserve full form/table workflows and desktop presentation; inventory implemented card groups before marking coverage complete. |
| DEC-29 | Controlling correction: do not implement infinite scrolling on graphs or charts; apply it to other cards. Exclude graph/chart card containers too and preserve their existing finite behavior. | Supersedes DEC-28's ambiguous graph-card interpretation. New loop applies to non-chart summary, inventory, financial and shop card groups only; no plot/chart/container behavior change. |
| DEC-30 | Apply the non-chart card loop on Windows too whenever cards would otherwise wrap into another row/column. Detect available container space rather than relying only on a phone/device breakpoint; retain the ordinary row when all cards fit. | Refines DEC-27's desktop exception: a Windows/desktop group that cannot fit must slide too. Keep card widths readable, loop real existing nodes, preserve graph exclusions and respond to window/container resizing and hidden-card changes. |
| DEC-31 | Investigate conflicting sales/payment/sponsorship totals. Owner corrected expected all-method total collected to **6,851**, not 6,841; reported revenue around 6,489 and collected 6,468. Show without-sponsorship and including-sponsorship values clearly when applicable. | Manual expected total is evidence to reconcile, not permission to force values to match. Trace branch/cluster/date/timezone/status/payment/refund/rounding/discount sources before proposing financial corrections. Preserve checkout/receipts and original records. |
| DEC-32 | Owner approved report-only fixes: same authorized branch scope for sales/sponsorship, consistent refunded-bill totals, and clear before/after Extra Discount and sponsorship labels. Preserve checkout, receipts, stock and stored records. | Separate reviewed commit/baseline after UI work. No permission, schema, historical financial data or checkout/receipt change; manual source of 6,851 remains a pending clarification, not a target to force. |
| DEC-33 | Owner suspects some cashier bills were never entered and requests an Add missed bill option alongside Corrections. | Record a separate historical-sale workflow, not a fabricated report adjustment or edit of an existing bill. Investigate reuse first; stock-already-corrected handling, already-received payments and original/closed shift attribution require explicit decisions. No historical data entry, grant change or new financial write implementation in DEC-32. |
| DEC-34 | Owner confirmed missed bills are historical sales already paid and handed over, with a required stock-handling choice. | Distinguish deducting unrecorded stock from stock already corrected; never charge or deduct twice. |
| DEC-35 | Owner selected Review the design before implementation for Add missed bill. | FIN-13 remains proposal-only. Administrator correction access, original branch/date/cashier, received tenders, reason, optional original-shift link and current-drawer preservation were proposed, not approved for implementation. Present any migration separately before application. |
| DEC-36 | Investigate Archive showing only four products and an inactive product apparently absent from the top metric. | Check archived versus zero-stock status, retained filters/pagination, metric definition and authorized branch/cluster scope. Do not archive, unarchive, change stock or widen access during investigation. |
| DEC-37 | Owner clarified the expected 6,851 may include bills never entered and will check the originals. | Missing bills are suspected, not confirmed. Do not force reports or create transactions to bridge the difference; link genuine omissions to the separately reviewed FIN-13 workflow. |
| DEC-38 | Owner approved a separate UI-only clarification: explicit Archived products count, clear Active/Archived mode and visible active filters. | Baseline eb970d1b; preserve product status, stock, branch/cluster scope, valuation and filter behavior. Does not authorize automatic archiving, ownership repairs or database changes. |
| DEC-39 | Owner superseded the new Catalogue status box: remove it, keep search/filter/actions, and show only Total / Active / Archived product counts at the bottom. | Supersedes DEC-38's box, mode and filter-chip presentation. Preserve filters, pagination, metric cards, status/stock and authorized catalogue scope; totals refer to the accessible catalogue, not inaccessible other companies. |
| DEC-40 | Owner reports over 100 Supabase products below zero. | Negative stock is not equivalent to archived status. Trace archived-negative exclusion from metrics, zero-stock lifecycle and branch/cluster read scope before proposing corrections; do not alter real quantities, widen access or claim the loaded five rows exhaust database records. |
| DEC-41 | Use ROSEGILL only for this chat; before any Supabase edit identify organization, project, ref and URLs and present the proposed change for approval. | Connector routing still denied the POS ref, but owner-opened Chrome independently exposes pos in rosegill0011@gmail.com's Org (bjxgimekljzlnwejuawj), project qhrufhtbeguxydenzfey. Do not use unrelated Primary projects as substitutes. Browser inspection is read-only; database writes need separate approval. |
| DEC-42 | Owner confirmed the 592 hidden archived products belong to STR1 / 361 Degree Sports and requested preparation of the targeted repair for review. | STR1 ID a611a328-2217-4d77-944a-5f6a637d123b verified in the live stores table. Record ownership confirmation, capture exact IDs and inspect deployed triggers/sync before proposing application. This confirms provenance and authorizes repair preparation, not live execution. See database/archive-ownership-repair-review.md. |
| DEC-43 | Private stock must not hide a cluster's own catalogue: products belonging to a cluster remain visible within that cluster until an explicitly approved transfer/merge changes availability. | Separate product catalogue membership from branch stock quantities. Preserve normal-terminal branch restrictions, action permissions, private-stock settings and other clusters' isolation. The ownership repair must use STR1's configured cluster, not merge catalogues or expose other branches' protected quantities. |
| DEC-44 | Owner requests checking and correcting the location Private catalogue / Private stock behavior against cluster-shared products and private branch quantities. | Actual STR1 edit dialog shows cluster 361 DEGREE SPORTS and both privacy switches on. Keep saved switches; explain their distinct effects. Audit confirms same-cluster catalogue sharing already implemented but privateStock only affects All Shops stock presentation; Inventory Other Sources and raw product stock-map reads lack that policy. Required management-scope exception clarification is pending. Present a bounded correction batch; do not silently redact mutation inputs or apply live schema/data changes. |
| DEC-45 | Owner confirms authorized management keeps stock access within its granted branch scope; normal branch terminals see only their own quantities. | Resolves DEC-44 management clarification. Management terminal type alone is not an entitlement: require verified account scope and existing function permission. A manager using a normal terminal remains branch-locked. Preserve same-cluster catalogue sharing, private quantities, transfer workflows and authoritative lifecycle/checkout data. This decision does not approve live DB execution or the 592-row ownership repair. |
| DEC-46 | Owner approved the proposed first code-only stock display/copy/regression batch: Okay, do it. | Baseline HEAD 9e65a0c6 with existing footer/doc drafts preserved. Share one display scope between Inventory Other Sources and All Shops, clarify privacy copy and test terminal/user binding precedence and granted management scope. Preserve table column positions, selected-cluster stock export, catalogue visibility, stock maps, lifecycle and checkout. This fixes presentation only; backend read privacy and 592-row live repair are separate pending batches. No DB writes, installer publication or production promotion. |
| DEC-47 | Owner clarified Other sources: show only sources with stock available, IN RESPECTED CLUSTER. | Narrow Other Sources to positive-stock, active, permitted locations in the currently selected branch's own cluster. Exclude zero/negative quantities, current branch, inactive and other-cluster sources; an approved transfer does not turn this popup into an all-clusters stock view. Keep management scope and normal-terminal restrictions; All Shops management card access remains separately authorized. |

## Current work register

DEC-57: owner APPROVE for administrator Add missed bill implementation after
reviewed design. New branch codex/add-missed-bill from current beta bce925a2;
preserve all unrelated untracked files. Capture historical branch/date/cashier/
items/prices/discount/tax/receivedpayments/reason/originalref and required stock
choice. Dedicated atomic/idempotent online service; no providercharge/drawer/
autoprint and no reuse of normal checkout bypass. Preserve closed-shift guard:
sale.shift_id NULL, validate/store originalShiftId in correction audit metadata,
so historical reports gain record without today'sdrawer or issuedZ rewrites.
Web/mobile/Electron use hosted online endpoint; offline atomic entry is pending,
not silently queued. Live schema application remains separately approved.
Use agents for backend and native/report review; Membership remains ON HOLD.

DEC-56: owner requests updating beta. Prepare reviewed source commit/PR341 update
and merge into beta only after required checks pass. No production promotion,
installer/OTA publication or live sync migration application. Final candidate
14suites/126tests plus29 sync and11 repair checks passed. Exclude .pending business
backups, unrelated booking helpers/empty migration and supabase temp files from Git.

Beta source1d24dae7 pushed. Initial CI: web/compile/windows/iOS/label passed;
regression failed only on expected migration-list and superseded global-export
source assertions. Corrected those two tests retaining payload/permission checks.
Full local isolated suite passed551files/3422tests. Unrelated empty SQL draft was
temporarily held and restored in finally (zero bytes) to match shipped CI files.
Push follow-up and require fresh CI before beta merge. No live sync migration or
installer publication performed.

DEC-55: owner reports1/2 stock filter still not selecting quantities. Confirmed
actual JSX heading plainText creates Stock ·  HC (double space), while parent
columnValues uses Stock · HC; unknown-key fallback skipped filtering. Normalize
column-label whitespace before matching and parse complete quantity token.
Regression covers actual spaced label,1versus2 and scientific decimal quantities.
No branch/data/checkout change.

DEC-54: owner reports stock-column1/-1/0 filters return wrong quantities.
Confirmed substring matching erroneously matches10/-10 etc. Match plain numeric
stock queries by exact quantity, retaining textual stock searches and the current
branch/cluster/Active-Archive scope. No stock/data/checkout changes.

DEC-54 implemented: signed decimal stock terms use exact numeric equality;
other column/text filters retain text matching. 3suites/22tests and scoped lint
passed, including1/-1/0/fractional cases, text warnings and AND filters. Zero and
negative matches remain under selected branch Archive, not Active. No DB writes.

DEC-53: owner reports Inventory column filters ineffective and requires each
column filter to match only that column while main search remains cross-field.
Confirmed shared table filters run after Inventory slices pageRows. Add opt-in
parent filtering callback so Inventory filters full authorized catalogue before
pagination; preserve other tables' default behavior, scopes and checkout.

DEC-53 implemented: optional shared-table label-keyed filter callback delegates
Inventory filtering before usePagination. Per-column text covers Product,
Category/Sub-category, visible monetary columns, branch stock and permitted
same-cluster Other Sources; global search remains cross-product-field. Table's
default internal filtering retained for other callers. 6 suites/36 tests,
TypeScript, scoped lint and diff checks passed; previewHTTP200. Actual signed-in
browser interaction remains unverified. No database or checkout changes.

DEC-52 (2026-10-29): owner approves selected-branch Inventory Active qty>0,
Archive qty<=0 with negative-stock warning. This is a read-only classification;
never mutate shared is_archived flags, other branch status or checkout. Update
rows/footer/cost-review/export classification consistently; preserve shared
valuation formulas and label any existing global Archive/Restore actions clearly.
Use agent review and fixture tests; no database change required.

DEC-52 implemented locally: inventory-branch-view.ts canonical branch quantities
classify rows, cost review, footer and Inventory export. Negative branch stock
gets a warning banner and red labeled badge; product/negative counts use branch
classification. Shared valuation helpers, product flags/maps and checkout untouched;
global archive/restore actions explicitly labeled. 7 isolated suites/73 tests,
TypeScript, scoped lint and diff checks passed. Local preview HTTP200. Browser
visual/device verification is not established; no live DB data/status changes.

DEC-51 (2026-10-29): owner authorizes ownership sync durability correction,
Electron/mobile archive read checks and agent review; preserve checkout. Prepare
minimal NULL/blank-owner upload protection in product sync conflict assignment,
generator and local renderer upsert. Preserve insert semantics, nonblank owner
assignments, version ordering, stock exclusions and authoritative cloud pulls.
Live routine application requires exact change disclosure/approval. Inter-cluster
barcode collision request is investigation/advice, not authorization to merge
products or reassign ownership. Membership remains on hold.

DEC-51 candidate implemented: migration20261029064933 updates only conflict-owner
assignment in public.sync_apply_products(jsonb) to preserve established ownership
when EXCLUDED.owner_store_id is NULL/blank. Same fix in contract generator/canonical
schema and product-only native renderer upsert; authoritative cloud pull unchanged.
29 isolated PGlite checks passed; 7 focused suites/82 tests passed (600 archive
pagination, cluster/native scope, offline sync, ownership and checkout). TypeScript,
scoped lint/syntax and diff checks passed. Live SELECT remains600archived/600visible/
0hidden ownerless; migration NOT APPLIED. Need project-specific routine-update
approval; installed Electron/mobile cache/replication and real checkout unverified.
Transfer audit: existing product_id retained, quantities moved by branch, posted
receipt grants destination availability, global SKU/barcode unique. Legacy verifier
matches exact barcode and destination bucket; do not auto-merge similar names or
different items. Duplicate/alias conflict review is separate proposed hardening.

DEC-50 (2026-10-29): owner explicitly approved execution of exact594 ownership
repair in ROSEGILL pos. Applied successfully after 594/594 fingerprint backup
check. All594 before/after images differ only owner/version/time. Post-read:
2169total/1569active/600archived/600 STR1-visible; repaired foreign-cluster visibility0,
audit594/feed594; archive/stock/SKU/prices preserved, checkout code untouched.
Before/after business backups remain local .pending files, excluded from commits.
INV-09 ownership data correction is applied/DB-verified; signed-in UI and native
SQL propagation not verified. Higher-version NULL-owner sync durability and raw
stock-read enforcement remain pending; do not claim those fixed or replay repair.

DEC-49 (2026-10-29): owner requests completing archived ownership repair, exact
database change disclosed before application, agents and checkout preservation.
ROSEGILL project pos qhrufhtbeguxydenzfey / org bjxgimekljzlnwejuawj is now
accessible through connector link_6ab102f426708191b544bc0e70170ba0 (connector label
beta; database is live). Latest SELECT: 2169 total /1569 active /600 archived /
6 visible to STR1 /594 hidden ownerless archived zero-stock candidates. Frozen
594-ID/full-row-MD5 manifest prepared in database/str1-archive-ownership-repair.review.sql.
Preflight: no canonical stock map drift, quantity mismatch, transfer projection
drift, foreign nonzero stock or conflicting legacy productOwners. Do not apply
until isolated tests/review and project-specific approval. Owner confirmation
previously covered 592; latest 594 cohort must be explicitly presented. Newer
NULL-owner replica uploads can undo ownership; sync preservation remains a
separately reviewed change, not silently bundled in data repair. Membership hold.

Owner decision DEC-48 (2026-10-29): normal terminals may read positive available
stock at other active branches/warehouses in their registered branch's cluster.
This supersedes DEC-45/46's own-quantity-only display rule, not terminal branch
locking for sales, mutations, settings or protected reports. Other clusters stay
hidden. Authorized management scope remains unchanged. Keep SKU allocation one
global sequence; use agents for implementation/review. No live data migration is
approved by this code-change instruction. Membership remains ON HOLD.

DEC-49 repair candidate verified: independent agent review plus root execution of
11 isolated PGlite cases passed against final guarded SQL, including target-store
FOR SHARE lock, frozen row fingerprints, stock/price/SKU/archive/sale preservation,
same-cluster allow/foreign denial and failure rollback. Test harness uses synthetic
representative triggers; no live UPDATE occurred. Await owner approval for exactly
594 candidates in ROSEGILL pos; do not silently expand if manifest/data drifts.

DEC-48 implementation: added separate clusterAvailableStockLocations for Inventory
Other Sources; trusted terminal/account branch anchors its same-cluster read-only
availability. Full stock reports retain stockDisplayLocations restrictions; no
checkout/write/branch-switch guard changed. Updated privacy copy and tests.
Agent SKU audit confirmed singleton global range allocation, with one stale
cross-tab cache defect: readLease preferred memory over an advanced persisted
cursor. Fixed persisted-cursor precedence while preserving quota fallback and
added shared-storage two-module A1/B2/A3 regression. Final 9 focused suites /88
tests passed; full raw-data read enforcement and archive ownership repair remain
unapplied. SKU leases reserve ranges, so global uniqueness does not imply gapless
chronological numbering across offline terminals. Source remains local/uncommitted.

Source anchors below refer to checkpoint `1af373f5` unless stated otherwise.
“Existing tests” means reviewed source coverage, not a new executed test result.
No earlier chat-wide “completed” message is treated as blanket verification.

### Documentation, source and approval

| ID | Status / severity | Requirement, evidence and next step |
| --- | --- | --- |
| DOC-00 | Verified / High | Documentation-only Batch 0 completed on 2026-10-27: original AGENTS content retained verbatim; 10 Markdown files checked; local links valid; 75 unique task IDs, 21 decisions and eight terminal cases recorded. Two agent reviews reconciled PRIVATE settings, subset-scope and revocation wording. No application/runtime acceptance implied. |
| DOC-01 | Pending / High | Maintain verified feature/dependency, per-operation permission and settings-scope matrices using existing `audit/feature-inventory.md`, audits and generators. Current 123-route/45-settings inventory is not an end-to-end pass. Expand evidence without duplicating trackers. |
| SRC-01 | Implemented / High | Batch 1 source commit `608398c6` follows documentation `d0519d5a` and source baseline `1af373f5`, package 1.4.80; older primary folder remains 1.4.65. UI refinement follows separately. Refresh refs/source/release identity before each batch; no old folder cleanup/reset authorized here. |
| REL-01 | Active / High | Beta PR #341 includes report-only eb970d1b and separate Archive UI `45893068`, pushed on 2026-10-29. Report commit gates all succeeded, CodeRabbit skipped; Archive commit checks are running. GitHub connector unavailable, so authorized GitHub CLI updated concise PR summary/status. Inspect new-head CI before merge. Broader security review remains SEC-02; no merge, installer, OTA or production promotion in these batches. |
| REL-02 | Pending / High | Any beta merge, paired installers or native OTA: select checked immutable source and follow release runbook. Batch 0 grants no publication; exact “Publish beta now” gate remains. Record actual version/artifact/feed verification separately. |
| REL-03 | Pending / Critical | Any new production promotion: separate beta→main PR and owner approval for that specific promotion. Earlier approvals or passes do not authorize this roadmap. |
| REL-04 | Pending / Medium | Old build/source cleanup and signing-key preservation: prior cleanup request not fully reconciled. Inventory active checkouts/builds and unrelated work before any separately approved removal; never delete/rotate signing material. |

### Branch, terminal, management and permission integrity

| ID | Status / severity | Expected versus actual; scope; next step / acceptance |
| --- | --- | --- |
| AUTH-01 | Implemented / Critical | Batch 1 now retains persisted raw/cashier-session terminal identity when a request token is omitted; rejects contradictory, revoked, missing or reassigned activation and validates device proof for terminal-only/unbound issuance. Isolated hosted RPC/sync tests preserve cashier A and deny foreign branch B. Remaining: browser-shaped unbound Auth issuance is not native attestation; direct database/RLS/legacy boundaries remain AUTH-04/SEC-01, not certified closed. See evidence below and physical-device acceptance TST-01/04. |
| AUTH-02 | Implemented / Critical | Main now rejects ordinary token/mode/branch/alias reassignment, verifies canonical activation descriptors, preserves operator-managed config/secrets, and checks account scope before local reads. Legacy missing proof is repaired only after server validation. Clearing removes usable identity while retaining non-secret origin; replacement requires administrative recovery, clean pending/failed/conflicted SQL work and local diagnostic attribution. Installed wrapper→Main isolated tests cover denied substitution and granted cashier access. Real DPAPI/SQL/device/restart acceptance remains TST-01/04; legacy plaintext import is not OS-user tamper protection. |
| AUTH-03 | Pending / Critical | Assigned web manager A must not receive B scope. `relay-policy.server.ts:301,326` conditions restriction on terminal ID and then supervisor role. Current account scope principally represents one branch or NULL/all, not an explicit A+B-excluding-C subset. Verify actual representation and owner intent before any scope design; test assigned and all-authorized cases without inventing grants. |
| AUTH-04 | Pending / Critical | Direct authenticated database/RPC paths must match terminal/account restrictions. `schema.sql:4418` `store_visible` grants supervisors broad visibility; generic cloud proxy does not establish terminal branch. Deployed definition inspected read-only. Trace all alternate consumers; do not blindly remove legitimate management access. |
| AUTH-05 | Pending / High | Generic approval scope must allow authorized all-store supervisors while keeping bound admins A-only. `authorization.functions.ts:192,202` admin-only broad scope ignores normal-terminal binding. Align verified scope without granting action/approver rights; include sponsorship and product/transfer approvals. |
| AUTH-06 | Pending / High | Sparse/null permission matrices must resolve the same way online, native and frontend. `permissions.ts:393` frontend supervisor defaults versus explicit-only `relay-claims.server.ts:19`. Confirm legacy cases; no automatic grant expansion or silent saved-matrix rewrite. |
| AUTH-07 | Pending / Medium | Revoked/deleted/expired identity must be distinct from network unavailability. `session-permissions.server.ts:37` catches rejection as unavailable; `pos-auth.tsx:1320` preserves cached rights. UI staleness confirmed; native-write consequences unverified. Preserve legitimate offline behavior and test revocation. |
| AUTH-08 | Pending / High | Correct warehouse role/access classification. `pos-auth.tsx:1509` treats ordinary web `staff` as warehouse; :1567 permits unassigned warehouse switching while relay may deny writes. Verify actual role slug and explicit scope; independent warehouse ACL remains unproven. |
| AUTH-09 | Implemented / High | Existing preclaim/manual/QR pairing, claim, PC/mobile Operations/Management descriptors, issuance, adoption, revalidation and revocation/re-pair paths reviewed under DEC-04/22. Preclaim discovery remains separate from completed activation; NULL branch needs explicit management designation and saved account admission. Compatibility proof handoffs repaired for staff rosters, approval credentials, recovery PIN and Operations replication. Typed registry outage stays unavailable; authoritative activation denial cannot trigger cached-login fallback. Real-device acceptance remains outstanding; no new activation mechanism or live records changed. |
| AUTH-10 | Pending / Critical | Reassignment must handle pending/failed/conflicted offline transactions across remote reissue and all IPC paths. Local Unpair UI checks pending work; remote `20261021013221_terminal_reissue_and_mobile_tokens.sql:12` does not establish equivalent recovery. No data deletion proven. Require audit and recovery without relabeling old A work to B. |
| AUTH-11 | Implemented / High | Role defaults, consolidated Edit permissions, account management-admission flags and delegated `can_manage_staff` exist. Complete create/edit/save/reload/revocation, direct URL/API and checkbox→actual-operation matrix; preserve explicit denials, cashier sale grant and admin's intentional authority. |
| AUTH-12 | Implemented / High | Per-user approval PIN/soft-token paths exist; prior delayed-first-PIN/token failures were addressed in earlier patches but not certified on affected phone→offline Windows pair. Test eligibility, branch, limits, expiry/clocks, replay, attribution and unavailable-versus-incorrect messaging without sharing credentials. |

### Settings and persistence

| ID | Status / severity | Requirement / evidence / next step |
| --- | --- | --- |
| SET-01 | Pending / High | Section/path ownership: `relay-policy.server.ts:709` checks label/lock but not contained fields; `branch-settings.ts:223` merges entire patch; native `operations.cjs:317` analogous. Test unlocked-tax payload carrying locked rounding/terminal fields, unknown labels, tier/lock checks and valid saves. Do not silently change settings. |
| SET-02 | Pending / Medium | Scope-switch save race: `SettingsFrame.tsx:252` clears saving unconditionally after an old request. Confirm with isolated slow A/B save tests before correction; draft ownership and authoritative acknowledgement must survive late replies. |
| SET-03 | Pending / Medium | Delegated e-commerce/global-save UI mismatch: `settings.catalog.tsx:302` offers a write backend may deny; optimistic settings can remain changed. Verify rejection rollback and management-only visibility; preserve actual e-commerce data. |
| SET-04 | Implemented / High | Three Payments pages loaded read-only: payment methods, bank transfer details, payment accounts. Earlier save bugs were patched; no live save done in latest audit. Verify all three save/reload/error paths with isolated settings, tender account scope and checkout integration. |
| SET-05 | Implemented / High | Sales receipt designer, QR, typography/custom font size, extra sections, printer width/margins and permanent preview require integrated save/reload/print verification. Prior SettingsFrame context crash must not recur. Do not alter receipt/payment business logic for appearance. |
| SET-06 | Implemented / High | Booking rules/deposits, services/fees and booking receipt/tag settings remain together, separate from sales receipts. Verify compact section editing, terms/content/fonts and persistence; avoid duplicate controls and excessive scrolling. |
| SET-07 | Implemented / High | Identity deletion must persist cleared registration/taxpayer fields; saved country/currency/store timezone must apply to display and date queries everywhere. Recheck scoped save/cache/reload and receipt/report formatting; no migration or live value change in Batch 0. |
| SET-08 | Pending / High | Complete all 45 settings-route/subpage checks: scopes/inheritance/locks, stale refresh, defaults, previews versus explicit Save, operational policies and hidden controls. Reuse existing section map; warehouse/company tiers not assumed. Source inventory is complete, runtime acceptance is not. |
| SET-09 | Pending / Medium | Latest owner request DEC-20: inventory every setting/field's management home, saved value and consumers; identify duplicate editors and unused/unwired controls. Propose minimal consolidation with links and necessary fields retained; no blind removal or collapsing distinct scopes. |

### Financial workflows, bookings and sponsorship

| ID | Status / severity | Requirement / evidence / next step |
| --- | --- | --- |
| FIN-01 | Pending / Critical | Atomic booking collection: `pos-store.tsx:2497,2510,2546` separately completes payment/status, sale/stock, then link. Failure/retry can leave incomplete or duplicate effects. Shared ID helper/empty migration are drafts only. Require authoritative atomic native/cloud operation, both legitimate action permissions, concurrency/replay and closed-shift read recovery. |
| FIN-02 | Pending / High | Canonical booking payment identity: RPC generates UUID, provider appends another without retaining idempotency key; later `bookings-db.ts:166` history save can duplicate/conflict. Test deposit→edit/save without reload, duplicate acknowledgements and authoritative response reconciliation. |
| FIN-03 | Pending / High | Approved received-payment accounting: 40 cash deposit in shift1 +60 card in shift2 must report 40/60, not final-method100. Fully prepaid handover must not add new cash. `pos-store.tsx:2518`, `shift-close.ts:29`, `daily-payment-summary.ts:8`. Preserve full merchandise sale once; no guessed historical allocation. |
| FIN-04 | Pending / Critical | Legacy booking RPC scope: `booking_balance_state`, `booking_net_paid`, `booking_collect` lack full branch/terminal checks. Deployed catalog confirmed authenticated execute, anon denied, definer authority bypasses table RLS. Secure all entry points with live permissions; test A→B denial and authorized management without invoking real bookings. |
| FIN-05 | Pending / Medium | Persist booking reference: provider :2524 sets `bookingRef`, `pos-db.ts:837,932` mapping omits it, `pos-print.ts:438` expects it. Reprint/reload must retain correct reference/service details; ambiguous historical links remain Needs review, no auto-rebilling/stock repair. |
| FIN-06 | Implemented / Critical | Cashier online/Electron Complete & Print, persisted sale/tender/line order, draft-payment errors and printer/drawer separation: earlier fixes/test coverage exist. Verify two successive bills during catalogue sync, late acknowledgement/retry, no-print drawer pulse and correct granted/denied action combinations. Do not require catalogue-edit/stock-adjustment grants to sell. |
| FIN-07 | Implemented / High | Sponsorship: named approvers/direct issuers, limits/any-amount approval, selected stores, discounts, configurable reference, handover/retry stock-once and receipt exist. Earlier mobile Unknown app operation was reported resolved by owner; recheck compatible backend/build, not unrelated endpoints. Physical printing/current full workflow still unverified. |
| FIN-08 | Pending / High | Offline sponsorship request/selected approval/handover/history/printing and sync remain incomplete. DEC-12 permits selected approver on PC only with offline approvals enabled. No fake zero history, unreviewed stock transaction or automatic historical repair. |
| FIN-09 | Implemented / High | Racket/general booking intake: simplify unnecessary repeat fields; racket-only/customer-owned-string behavior, stocked materials, reservations, ready/collected/payment flow and customer display need per-workflow verification. Separate customer slip/tag is intentional. |
| FIN-10 | Pending / Medium | Legacy records apparently saved under wrong branch or missing shift link need owner-reviewed evidence and explicit data-correction approval. Preserve original rows while diagnosing; UI branch fixes do not authorize historical rewrites. |
| FIN-11 | Implemented / pending record reconciliation / High | DEC-31/32: owner expects all-method collected 6,851. Bounded live SELECT confirmed configured Asia/Singapore period 2026-09-28..2026-10-27, STR1, 79 nonrefunded bills: cash 2,311 + card 3,489 + bank transfer 668 = 6,468; header/tender JSON/paid-minus-change/ledger agree. Net before saved Extra Discount adjustment 6,489.50; adjustment -21.50, tax 0; one issued sponsorship 348 yields combined 6,816; separate refunded bill 220. No broken header equations/orphan sale links found in this cohort; unexplained owner delta 383 is not auto-adjusted. Report-only scope/refund/label corrections committed and pushed as eb970d1b, scoped-verified below. Owner will compare originals for suspected unentered bills (DEC-37); no missing bill is independently confirmed. Preserve checkout, receipts and stored records. |

| FIN-12 | Pending / Medium | Independent report review found an unchanged tender-display inconsistency: `PaymentsReport.tsx` sums gross `Payment.amount`, while `daily-payment-summary.ts` subtracts represented cash change. A valid 90 bill paid with 100 cash/change 10 can therefore show collected 90 but Cash 100. Confirm affected saved representations with isolated fixtures and reuse retained-tender semantics in a separately approved correction; do not alter checkout or assume this explains FIN-11's observed zero-change cohort. |
| FIN-13 | Implemented / scoped-verified / live migration applied / High | DEC-57 supersedes original design-only boundary. Administrator-only original-day already-paid entry, explicit stock choice, atomic/idempotent service and audit are implemented. Cashier picker now uses authoritative eligible accounts and preserves native proof. Exact owner-approved live migration applied30October21:34Brunei; service-only/RLS checks passed. No real historical entry created by tests. Current drawer/normal checkout preserved; signed-in form and installed-device acceptance remain pending. Original proposal remains below as historical evidence. |

### Inventory, warehouse, reports and data loading

| ID | Status / severity | Requirement / evidence / next step |
| --- | --- | --- |
| INV-01 | Implemented / Critical | Cluster-owned catalogue visibility, branch stock isolation and trusted transfer provenance exist. Verify every picker/import/scan/receive/sale/report path, private legacy zero-stock ownership and inter-cluster named approvals. Ambiguous owner rows require review, not automatic reassignment. |
| INV-02 | Pending / High | Candidate: importProducts indexes all products before branch ownership at `pos-store.tsx:2835`; purchasing barcode lookup :540 similarly broad. Trace backend effects before confirming cross-cluster mutation. Test identical barcode in private catalogues and approved transfer reuse. |
| INV-03 | Pending / Critical | Warehouse hierarchy/picking exist, but independent subordinate ACL coverage is not established. Verify receiving/adjustment/reservation/transfer/return/reversal source and destination, branch ancestry and concurrency without changing real quantities. Clarify unsupported subset scope before design changes. |
| INV-04 | Implemented / High | Catalogue quantities view-only; costs/e-commerce columns/action grants/management-terminal ownership must match saved settings and backend enforcement. Verify ordinary cashier versus warehouse/supervisor/admin combinations; do not widen access by role alone. |
| INV-05 | Implemented / High | Purchase cost, Total Unit Cost and retail on-hand values have calculation tests and UI; verify branch/cluster/date semantics at scale, negative signed quantities, archived items and historical cost estimates. Current source review found no separate Home-vs-Inventory formula; readiness issue is DATA-01. |
| INV-06 | Implemented / High | Bulk import/purchase finalization progress, failure recovery, decimal costs/rounding/conflict matching and workbook-sheet selection need unified acceptance across import surfaces. Prior UI/workflow improvements do not certify concurrent native finalization. |
| INV-07 | Pending / High | Default category/group/subcategory naming and starting quantity via purchase must be reconciled against current imports/creation paths. No real catalogue renaming or stock initialization authorized. |
| INV-08 | Implemented UI / pending completeness / Medium | DEC-36/38: source and preview show five archived products, no four/five-row cap; retained filters/catalogue scope apply. New InventoryCatalogueStatus shows separate active/archived counts, mode and search/advanced matches/filter labels. Counts use authorized catalogProducts before filters; active-only valuation remains unchanged. Eight focused suites / 59 tests, TypeScript, three-file ESLint and web build passed; desktop Active/Archived and 390px Archive display observed with no panel/document overflow. Preview signed out before final live search interaction; fixture filter tests pass. Supabase read unavailable, so stored-count completeness remains unverified. No lifecycle/scope/stock/backend changes. Revert only the separate UI commit for recovery. |
| INV-09 | Confirmed discrepancy / repair preparation / High | DEC-40..43: read-only ROSEGILL Chrome table filters on 2026-10-29 showed 2,169 products, 597 archived, 596 stock_quantity=0 and 597 stock_quantity<1; 592 archived, non-deleted, stock_quantity=0 records have owner_store_id IS NULL. Inventory STR1 shows 1,577 / 1,572 active / 5 archived. The ownerless zero-stock cohort exactly matches the 592 count gap; source branch-policy and SQL catalogue rules exclude ambiguous zero-stock provenance, and the isolation migration deliberately had no ownership backfill. Owner confirms these 592 belong to STR1; prepare guarded identity-frozen repair, do not apply yet. Check stock_by_store, legacy productOwners, transfer evidence and deployed triggers/sync before execution; stock_quantity alone is not the lifecycle input. Archived-negative exclusion from inventoryMetrics is a separate confirmed calculation limitation awaiting its own approval. Do not widen cross-cluster access or silently change quantities/status. Review: database/archive-ownership-repair-review.md. |
| INV-10 | Display implemented / scoped verified; backend pending / High | DEC-44..47 approved code-only batch: shared stockDisplayLocations enforces terminal binding, then account binding, then authorized management directory; unknown binding fails closed. Inventory Other Sources uses permitted product-catalogue locations, selected-cluster scope, active locations and qty>0 for rows/count/total; no hidden counts masquerade as zero. All Shops management stock cards retain authorized access; stock export remains selected-cluster scoped. Clarified private toggle copy; table column positions, authoritative stock maps, checkout, lifecycle and saved flags unchanged. Final 14 isolated suites /114 tests, TypeScript, scoped ESLint and diff checks passed; independent candidate review found no actionable regression. Preview signed out, so real signed-in popup/native behavior is unverified. Backend raw product stock maps still lack privacy projection, and the 592-record ownership repair is unapplied. No live migration or data change. |
| REP-01 | Implemented / High | Complete paginated sales/shift history, current-shift/date-range receipt filters, branch/cluster totals, store timezone, full selected/all-shops totals and profit were patched. Verify thousands of records, midnight shifts and simultaneous management/normal clients; inspect final PR CI. |
| REP-02 | Pending / High | Management report service exists, but `ipc-privilege.cjs:638` blanket business-channel guard blocks its installed handler with MANAGEMENT_ONLINE_ONLY. Test installed wrapper→repository with scoped complete replicas; preserve operations restrictions. |
| REP-03 | Pending / High | Replica scope/completeness: current management discovery (`sync-endpoint.server.ts:257`) enumerates all stores; arbitrary configured subsets are not established. Separate desired scope from actual model. Do not infer completeness from schema-ready or bootstrap_7300 job name alone; verify compatible no-cutoff contract, counts/checkpoints and failed bootstrap behavior. |
| REP-04 | Implemented / Medium | Display line-wise subtotal, discounts, tax-if-applicable, rounding and collected total; keep sponsorship value separate from cash, follow inclusion policy and hide zero rows. Verify home/selling/report/shifts graph consistency without rewriting sale amounts. |
| REP-05 | Pending / Medium | Some audit/history readers remain bounded (including large booking payment histories); identify/document truncation and paginate required histories. Estimated legacy profit may use current costs; label estimates instead of asserting captured historical cost. |
| DATA-01 | Pending / High | Readiness race: directory load sets ready in `pos-store.tsx:760` before full snapshot; dashboard :131,:233 renders unloaded inventory as zero while independent sales history is complete. Gate unknown/failed/partial data explicitly; test cold sign-in, delayed catalogue, currency/default hydration and retry. Navigation-to-Inventory is not proven the cause. |
| DATA-02 | Implemented / High | Query caching/coalescing/date predicates/indexed financial metadata and quiet refresh improvements exist (performance report). Continue full-freeze/slow staff/notification/database-loading investigation on phone/PC; use measured profiles, not process-count assumptions. |
| DATA-03 | Pending / High | Electron startup SQL ready versus actual trading/bootstrap readiness, automatic online fallback, reconnection and long cashier-PIN latency need isolated integration/affected-device evidence. Network/verifier errors must not become incorrect PIN; preserve uncertain transactions. |
| DATA-04 | Pending / Medium | Separate success/failure diagnostic files and clearer live connection/status terminology were requested; reconcile current logging implementation before another mechanism. Preserve credential redaction and useful state/stage/code evidence. |

### UI, notifications, policies and security follow-up

| ID | Status / severity | Requirement / evidence / next step |
| --- | --- | --- |
| UI-01 | Pending / Medium | Observed inventory summary amounts wrap mid-number at ~1155px. `styles.css:1454` allows arbitrary wrapping. Fix only presentation in an approved UI batch; test realistic large amounts and currency labels without changing calculation. |
| UI-02 | Pending / Medium | Observed mobile staff cards have excessive height/stacked actions and duplicated Last login label. Compact essential fields and accessible controls; test 15–20 users and no lost actions. |
| UI-03 | Pending / Medium | Bank-transfer form has seven unassociated input/textarea labels (read-only DOM check; `settings.payment.tsx:53` onward). Associate accessible names and test keyboard/assistive interaction; do not change bank details. |
| UI-04 | Implemented / Medium | Selling/card reflow, bill reference, readable before/after item and bill discounts, compact colored buttons/icons, barcode/camera/mobile search and flexible labels were improved. Audit actual rendered cart/charge controls without real transactions; no oversized/hidden critical actions. |
| UI-05 | Implemented / Medium | Login keypad collapsed behind circular control, minimum six PIN dots expanding for long PINs, bounded staff list, branding, splash and sidebar collapse need physical Electron/mobile acceptance. Remove special @ shortcut while preserving plain usernames/email and cashier PIN. |
| UI-06 | Implemented / Medium | Native update indicator is global for signed-in/signed-out/nonadmin users, progress ring near login/profile/bell, hidden once completed. Verify availability/download/install/restart at all platforms/channels; web/native boundaries and signing keys preserved. |
| UI-07 | Pending / Medium | Complete page/subpage/modal audit at mobile/tablet/desktop sizes, direct links and keyboard. Prior double app-shell/navigation reports and alignment/overflow require per-page evidence; do not include Membership redesign. |
| UI-08 | Verified (scoped UI) / Medium | DEC-25: Dashboard/Inventory share one Products/Categories card, hide loaded zero inventory indicators and preserve nonzero/signed values, loading/error/empty states and visibility grants. Home/All Shops zero inventory hints reflow without empty warning cards. Existing AnimatedMetric reused; no formula/API/global CSS changes. UI tests 12 files / 69 passed; full candidate 544 files / 3,354 passed. Live Inventory at default desktop, 390px phone and 768px tablet had no card or summary horizontal overflow; zero negative-stock card absent. DEC-26 financial-card hiding is separate UI-11. |
| UI-09 | Pending / Low | Confirmed dev warning: exported RulesSettings route reused by staff prevents code splitting. Profile production impact and isolate only in an approved batch; not proof of a runtime freeze. |
| UI-10 | Verified (scoped UI) / Medium | DEC-23/24: standalone SalesReconciliation panels removed from Home, Selling, All Shops, Reports and Shifts. Compact hover/click info icons explain existing financial totals, including Live Business Board, without new detail requests or cost-permission widening. Financial/visibility regression tests passed; live admin preview verified desktop and 390px phone-sized Revenue/Gross Profit tooltips plus Dashboard deductions. Calculations, receipts and loaded filters preserved. Physical phone/native rendering remains TST-04; DEC-25 inventory refinement is separate UI-08. |
| UI-11 | Verified (scoped UI) / Medium | DEC-26: loaded zero live financial/count cards hidden; negative values and zero-price bill counts preserved, All Shops zero-valued cards retained. Bills/peer values align; Dashboard Columns uses existing right-hand heading targets, shared Expand is phone-only. Twelve focused files / 64 tests, scoped lint, TypeScript and web build passed. Live Dashboard empty totals observed; both Columns buttons vertically aligned within 0.01px; desktop Expand hidden; at 390px phone Expanded table opened and closed with permitted columns intact. Viewport restored. No table data/actions, calculations or authorization changed. |
| UI-12 | Verified (scoped UI) / Medium | DEC-27/29/30: adaptive manual loop implemented for non-chart summary/inventory/shop/category groups, normal rows when cards fit. Graph components/helpers retain finite behavior; no extra records/fetches. Eleven focused files / 69 tests, 19-file lint, TypeScript and final web build passed. Real preview: narrow Windows first→last via ArrowLeft succeeded after fixing Embla spare-width edge gaps; phone 390px last→first returned Catalogue to x0; at 2200px loop disabled and six cards shared y0 without overflow. Viewport reset. Physical touch hardware remains TST-04. |
| NTF-01 | Implemented / High | Single rule table with selected users/roles, in-app/push/WhatsApp routes and no duplicate controls. Prior additive upgrade applied with owner approval; verify rule save/reload/delivery/disabled channel and only-selected audience using isolated fixtures, not sending real messages. |
| NTF-02 | Implemented / High | Personal Clear/unseen queue/immutable audit and token-owner/admin notifications were patched. Verify new-event-only toasts, stale offline acknowledgements, restart/concurrency and unauthorized recipient denial; retain delivery audit even after personal clear. |
| NTF-03 | Pending / High | External WhatsApp/push/device delivery and offline audit→cloud notification timing remain unverified. No real external messages authorized for this batch; provider/device tests need reviewed isolated recipients/configuration. |
| OPS-01 | Implemented / High | Operational policies consolidated under Staff & Permissions; global restrictions/duplicate authorization controls retired previously. Verify every saved policy actually drives backend/native behavior, including negative stock, authorized other-user shift close, table columns and offline approval—not UI alone. |
| SEC-01 | Pending / Critical | Reconcile all 10 findings in the original supplied Security Review against latest source/evidence (matrix below), especially finding #10. Earlier fixes are not proof the original report is fully remediated. Do not silently mark imported findings confirmed or fixed. |
| SEC-02 | Pending / High | Broader system/security review and requested PR Codex/ChatGPT Security review remain outstanding. Record exact scope/revision, validated findings, coverage and unavailable checks; initial agent source audit was not a formal completed scan. |
| SEC-03 | Pending / High | Supabase advisories/warnings, dependency vulnerability checks and historical error reconciliation need fresh scoped evidence before corrections. Keep migration/code/runtime failures distinct; no live SQL change authorized by Batch 0. |

### Required verification and owner-held work

| ID | Status | Acceptance / next step |
| --- | --- | --- |
| TST-01 | Pending | Execute all eight terminal cases in PROJECT_MEMORY.md with allowed/denied roles, omitted/forged token, shared SQL, direct APIs/RPCs/IPC, offline/retry/reconnect and safe reassignment. Existing test filenames are not pass results. |
| TST-02 | Pending | Establish isolated fixtures/environments for role/branch/warehouse matrices, transactional failure and concurrency tests. A beta database label is not isolation; never mutate real sales/stock/credentials to demonstrate a bug. |
| TST-03 | Pending | After each approved correction, targeted regressions then appropriate shared suite/type/lint/build checks, installed IPC integration and final diff review; broaden tests when changes/failures justify it. Record revision and actual commands/results. |
| TST-04 | Pending | Full end-to-end/page/device/printing/customer-display/SQL-failure acceptance and final system regression remain unfinished. Track unavailable access or evidence explicitly; do not declare global verification from browser/admin smoke checks. |
| HOLD-01 | On hold | Membership tiers, custom member email, table consolidation and related redesign requests are deferred by owner. Preserve existing behavior/data. Only a confirmed critical shared dependency with explicit Membership-change approval permits modification. |

AUTH-01/02/09 are implemented under Batch 1 with the verification limits below;
UI-08/10/11/12 are separately approved, scoped-verified UI changes. FIN-11 has
approved report-only corrections; its unentered-bill hypothesis is not verified.
FIN-13 remains design-only. Other corrections require separate approval.
No task is currently designated Blocked merely because it is difficult or pending;
record a concrete environment/access/decision blocker if it actually stops work.

## FIN-13: original proposed design (approved and superseded by DEC-57 implementation)

This is a proposal, not implemented functionality or a new permission grant.

- Entry point: an Add missed bill option beside the existing Audit/Corrections
  links. Keep the current posted-record administrator correction boundary for
  this first proposal; any future delegated permission needs its own decision.
- Capture original branch, date/time interpreted in the saved store time zone,
  original cashier, items with actual historical prices/discounts/tax, already
  received tender amounts, original reference when available and a required
  reason. Preserve the verified entering actor and entry timestamp separately.
  Do not infer historical prices/costs from today's catalogue without disclosure.
- Required stock choice, approved in principle by DEC-34: deduct unrecorded
  quantities exactly once, or stock already corrected (no stock movement).
  For the latter require an explanation and related adjustment reference when
  available. Never silently alter starting stock or bypass stock policies.
- Branch-locked terminals remain within their registered branch, including
  administrators. Management may select only authorized branches. Product and
  warehouse scope still follow the approved branch/cluster rules.
- Proposed shift treatment: link the actual original shift if reliably known;
  otherwise retain a clearly marked historical correction with unresolved shift
  attribution. Never attach it to today's open shift just to satisfy checkout.
  Closed-shift corrections must be visible as later adjustments, not rewrite a
  previously issued Z report invisibly. This reporting treatment needs review.
- Use a dedicated atomic authoritative operation with a stable idempotency key,
  deterministic child/movement identity and an append-only audit trail. Reuse
  existing mappings/journaling, not the ordinary checkout's current-time/open-shift
  assumptions. Warn about a possible matching branch/reference/date/items before
  entry; enforce persisted retry identity without conflating legitimate duplicate
  reference numbers. Resolve concurrent online/local retries before acceptance.
- No payment-provider charge, drawer pulse or automatic print. A later explicit
  reprint may show the original sale date and that it was entered as a correction.
  Proposed received-payment reporting belongs to the original payment context;
  it must not add fresh money to today's drawer. Unknown attribution is explicit.
- Acceptance before release: allowed/denied scope and correction access, both
  stock choices, closed/unknown shift behavior, exact reports, timeout/retry,
  duplicate/concurrent submission, native offline/reconnect and audit/reprint.
  Use isolated fixtures only. Any cloud/local schema change requires a reviewed
  migration and separate application approval; no live rollout is authorized.

Existing source evidence: `audit.tsx` links to existing-record correction;
`sale-corrections.functions.ts` requires an existing sale ID/version;
`pos-store.tsx` ordinary recordSale requires a matching open shift and stamps now;
`pos-db.ts` commitSale already has stable transaction identity/atomic posting.
Do not bypass those safeguards to implement historical entry.

## Original supplied security report reconciliation

Source: owner's attachment titled **Security Review: retail-pos-main**, 10
reportable findings. Original severity/confidence are not silently carried forward
to a new revision. Preserve the report; do not commit credential-bearing evidence.

| Original finding | Current ledger disposition |
| --- | --- |
| 1. A valid device proof can mint a session for another employee | Pending latest-code validation; related device identity work is not a complete closure. |
| 2. A requester can inflate the baseline used for relative approval limits | Prior amount/provenance fixes reported; reconcile all entry points and regression evidence before closure. |
| 3. A stock aggregate can modify unrelated product fields | Stock-only update guards reported implemented; verify native/cloud alternate paths. |
| 4. Per-record history reads do not check branch ownership | Pending complete read-boundary reconciliation; AUTH-02/04 overlap only where proven. |
| 5. A denied parent write can authorize a child write by ID | Prior persisted-parent/ownership fixes reported; revalidate current contract and retry tests. |
| 6. A revoked server session can fall back to a still-valid cashier token | Verify proof precedence and rejection classifications, including AUTH-07; UI refresh alone is not the whole issue. |
| 7. Authenticated callers can forge actor identity in central audit events | Pending actor/provenance boundary validation across relay/native/sync. |
| 8. Clearing terminal enrollment reopens privileged first-run IPC | Pending installed-wrapper and enrollment-clear/restart/reassignment validation. |
| 9. Terminal SQL synchronization can modify stores outside its branch | Prior scoped contracts exist; revalidate omissions, alternate paths and replay origin. |
| 10. A staff branch lookup can fail open to company-wide comparison data | Explicit original investigation remains pending; verify failed/missing branch lookup fails closed without breaking authorized management comparisons. |

## Verification / deployment evidence log

| Evidence | Actual scope and limits |
| --- | --- |
| DEC-46/47 stock display candidate, 2026-10-29 | 14 final focused suites /114 tests passed: stock display scope/render, canonical IDs, management branch switching, same-cluster/private catalogue, archive lifecycle/metrics/footer, cashier-sale permission and checkout contracts, exports, table columns, native catalogue predicates. TypeScript and six-file ESLint passed; git diff --check passed. Independent candidate review found no actionable regressions. Existing footer draft preserved. User preview was signed out during final render inspection; no user permissions/settings or transactions were changed. This proves the code-only display batch, not cloud/local raw-data isolation or installed end-to-end behavior. |
| DEC-32 report-only candidate, 2026-10-27 | Independent read-only correctness review completed. Full isolated Vitest: 547 files / 3,381 tests passed after correcting two obsolete label assertions, with amount/permission/negative-visibility checks preserved. TypeScript, 14-file scoped ESLint, diff and web build passed. Sponsorship uses the sales report's authorized store IDs; completed summaries deduplicate/exclude refunds, while history/export retain explicit status in the original Bill column. No checkout/pricing/receipt/stock/formula or database writes. |
| DEC-32 browser check, 2026-10-27 | Settled Bills/Payments matched at 80 completed bills; a new sale arrived after the earlier 79-bill snapshot. The saved Extra Discount reconciled before-adjustment net to final collections; sponsorship remained separate. At 390px the tooltip and report document stayed within the viewport, and temporary viewport was reset. Initial settings/currency hydration flicker remains DATA-01. No live business mutations were performed by the audit. |
| Resumption, 2026-10-29 | Verified latest root/branch/HEAD/dirty files against c514762d; report changes preserved. The earlier documentation-update attempt failed because automatic approval review hit an account usage limit; it did not execute and was not an unsafe-action determination. Decisions DEC-34..37 now recorded. Restarted only the owned preview after sandbox socket/Wrangler errors; outside-sandbox server returned HTTP200 using existing .env.local without exposing values or changing configuration. New Archive investigation is read-only. |
| Report candidate recheck, 2026-10-29 | Eight focused report/financial/cashier-permission suites / 50 tests passed after replacing test amounts with synthetic fixtures. The final application diff is the same candidate that passed the 547-file broad run; report helpers/formulas, scoped visibility, refunds and table-column positions retained. Generated build report preserved separately in stash ad285e6d16afa83078aac1c30ee6ffe4223fc9ef. Documentation checks: 77 task IDs / 37 decisions unique; Membership hold and untouched zero-byte booking migration confirmed. |
| DEC-38 Archive UI candidate, 2026-10-29 | Root independently reviewed the three-file presentation diff after agent implementation. Eight final focused suites / 59 tests passed (status, inventory metrics/summary, catalogue loading/isolation, lifecycle, export and shared controls); TypeScript, scoped ESLint, diff and web build passed. Desktop preview showed active/archived modes and five archived rows; 390px panel scrollWidth350 <= clientWidth350, document390 matched viewport390. No product/stock/permission setting was saved. Final live search interaction remains unverified after preview sign-out; temporary viewport reset and server left running. This targeted UI pass does not replace the separate report candidate's 547-file broad run or certify every installed platform. |
| Source delivery, 2026-10-29 | Report correction eb970d1b and UI `45893068` are separately committed/pushed to existing beta PR #341; concise PR description updated. At the last read, Archive CI compile/role/windows/iOS remained running, label passed, CodeRabbit skipped. Worktree has no application changes left; unrelated drafts/empty SQL migration and all three generated-health stashes preserved. Rollback is a separate reviewed revert of `45893068` for Archive or eb970d1b for reports; neither requires a database rollback. Membership remains on hold. |
| Documentation-only Batch 0, 2026-10-27 | All 10 intended Markdown files checked for local links and allowed diff scope; original HEAD AGENTS retained as exact text prefix, below 32 KiB; 75 task IDs and 21 decisions unique; eight required cases and explicit Membership hold present; git diff --check passed. Two independent agent reviews completed and actionable corrections applied. Pre-existing drafts preserved, empty booking migration unchanged and signing-key path still ignored. No app tests/build/SQL or runtime data changes performed for this batch. |
| Batch 1 + DEC-23/24, 2026-10-27 candidate | Independent pre-patch boundary investigation and one fresh candidate review; concrete compatibility findings corrected. Full isolated Vitest: 543 files / 3,344 tests passed; TypeScript and touched security/UI ESLint passed; web production build passed with existing bundler/config warnings. Post-review native attribution/compatibility follow-up: 8 files / 72 tests passed; financial/source-contract follow-up: 11 files / 94 tests passed. No real checkout, stock, credentials, terminal enrollment or database writes performed. |
| Test-environment qualification | Windows sandbox module collection failed before assertions; authorized external-sandbox mocked runs succeeded. Initial broad run also exposed five obsolete source-contract assertions, now corrected, and the pre-existing empty untracked booking migration. Final full run temporarily held only that zero-byte draft under a non-SQL filename and restored it unchanged in finally; it is not part of the PR or applied SQL. Generated build health report restored; no test failure was hidden by deleting a draft or changing business logic to satisfy strings. |
| Batch 1 remaining architecture limits | Persisted terminal identity retention and Main enforcement are tested; this is not a full security certification. Native/browser requests using the same unbound account bearer are not cryptographically distinguishable here. Legacy sessions/plaintext migration require separate reconciliation; direct RLS/RPC scope, arbitrary management branch subsets and installed Management report denial (REP-02) remain pending. Remote installed phone/Windows, DPAPI/shared SQL failure/reconnect and physical checkout/printing have not been executed in this batch. |
| DEC-25 inventory refinement, 2026-10-27 | Full isolated candidate suite: 544 files / 3,354 tests passed; focused shared financial/inventory/render suites: 12 files / 69 tests passed; TypeScript, 14-file UI lint, diff and final web build passed. Inventory cards verified at 390/768/default desktop using actual render and DOM scroll/client-width checks; temporary viewport reset. No live inventory/setting/payment edits. |
| DEC-26 zero cards/table controls, 2026-10-27 | Twelve final focused files / 64 tests passed, including negative and zero-price bills, loading/errors, shared table columns/loading/export. Scoped ESLint, parent TypeScript and web build passed. Actual desktop heading alignment and 390px phone expanded-dialog checks passed; no live business mutation. Brief secondary read-only browser tab had no sign-in and was closed; primary later required reauthentication, supplied by owner. No causal cross-tab sign-out defect is claimed from that observation. |
| DEC-31 financial investigation, 2026-10-27 | Connected beta account/project URL verified as the existing POS qhrufhtbeguxydenzfey project. SELECT-only aggregates matched displayed 79-bill cohort and reconciled ledger/header/sponsorship as FIN-11. No financial code, schema, records or settings changed. Configured display currency is read from UI/settings, never inferred from geography. Await report-batch approval and manual/local 6,851 evidence; do not silently force totals. |
| DEC-27/29/30 adaptive card rails, 2026-10-27 | Eleven final focused files / 69 tests, scoped lint, TypeScript and local web build passed. Runtime initially exposed a real Embla finite fallback at exact gap-based sizing; spare width now excludes all edge gaps, and actual Windows/phone wraparound succeeded. At 2200px fitting cards restored a single untransformed row, no slide overflow. Global carousel, chart helper, pricing and financial-math helpers unchanged. No auto movement, duplicate business records or new backend queries; temporary viewport restored. |
| Source checkpoint `1af373f5` | Branch write/shift guards, cluster ownership/provenance, paged reports/shift history, timezone and settings/notification changes previously committed/pushed to PR #341. Newly audited defects remain. |
| Prior automated runs (conversation record) | 531 files / 3,266 tests before final focused follow-ups; compatibility 29 and reconciliation/guards 27 checks; TypeScript, lint and web build reported passed. No fresh full run during read-only audit/Batch 0; untracked drafts not certified. |
| Prior sync checks (conversation record) | 70-table registry/contract verified; 31 sync-pipeline checks passed. Not a field SQL Server failure/restore acceptance. |
| 2026-10-27 read-only audit | Three bounded agent reviews plus parent source review; 123 route files, 20 APIs, 45 settings inventoried. Browser admin/read-only screens inspected at representative sizes. No full permission-by-operation runtime matrix or formal security scan completed. |
| Read-only deployed catalog checks | Booking balance/collect/net-paid routine grants/definitions and store_visible inspected. No exploit call, financial mutation or security bypass performed. |
| Browser observations | Staff, Home, Inventory, Selling landing, Approvals/Bookings and three Payments pages inspected to varying depth. Reauthentication restored session; no live save, checkout, approval, stock post, print/drawer or credential change performed. Temporary viewport overrides reset. |
| Latest owner confirmation | Earlier mobile Sponsorship/account-save issue reported successful by owner after backend-address/account correction; not independent full-platform certification. |

Four migrations were **recorded by the prior session as owner-approved, applied
successfully to the connected POS project and checked against financial/stock/
permission invariants**. This is historical application evidence, not a Batch 0
database action or an assertion that every pending migration is applied:

1. `20261026161839_honor_configured_cross_cluster_transfer_approvers.sql`
2. `20261026162030_isolate_cluster_catalogue_reads.sql`
3. `20261026231535_verified_native_transfer_approval.sql`
4. `20261026232513_paged_secure_shift_history.sql`

Other notification/sponsorship/security migrations require their own history
reconciliation before another rollout. Never replay a migration based on a filename
or old report alone. In particular, the following are **unfinished untracked drafts**:

- `supabase/migrations/20261026235201_atomic_booking_collection.sql` — empty,
  officially generated filename, no implementation and not applied.
- `electron/booking-collection-ids.mjs` and `.d.mts` — helper draft only.
- `src/lib/__tests__/booking-collection-gap.repro.test.ts` — isolated reproduction
  draft, not the completed replacement workflow.

Also preserve pre-existing `.pending-*` notes/backups and `supabase/.temp/`.
Do not stage, delete or treat them as part of documentation-only Batch 0.

## Current handoff

- Latest 2026-10-29: DEC-41..43 supersede the earlier account-access blocker for
  read-only browser inspection only. ROSEGILL pos and STR1 identities verified;
  the 592 ownerless archived zero-stock records match the missing count, and the
  owner confirms STR1 provenance. Repair preparation is documented in
  [the review plan](database/archive-ownership-repair-review.md), not applied or
  tested as executable SQL. Same-cluster catalogue visibility must coexist with
  private branch stock. Finish manifest/live trigger/sync preflight and isolated
  repair tests before application approval. Connector routing remains denied;
  no Primary project, credentials, stock or grant workaround is authorized.
- DEC-46/47 display-only stock correction is implemented and scoped-verified
  (14 suites /114 tests, types/lint/diff, independent review). Preserve its
  explicit backend-read limitation and unapplied legacy repair. Worktree source
  remains local/uncommitted with earlier approved footer draft; do not claim PR
  delivery or installer publication. No additional live action is approved.
- The activation clarification is DEC-04; newer refinements are DEC-20 (one clear
  management home per field responsibility) and DEC-21 (concise transition updates).
  They refine coverage/reporting, not the approved application-change boundary.
- DOC-00 is verified and committed locally as d0519d5a. The owner separately
  approved Batch 1 (DEC-22); no approval is inferred for other AUTH/FIN/SET work.
- Batch 1 baseline/code: d0519d5a → 608398c6, followed by independent UI
  commit c514762d, pushed to beta PR #341 with all reported CI gates successful
  (CodeRabbit skipped). Preserve pre-existing booking/scratch drafts. Origin/beta
  e86bf889 remains the inspected PR base. Continue without mixing older source.
- AUTH-01/02/09 source corrections and isolated regressions implemented. Preserve
  recorded limitations; do not mark all eight device scenarios globally verified.
  UI-08/10/11/12 are committed as c514762d. Approved report-only FIN-11/DEC-32
  corrections passed local checks and are pushed as eb970d1b; reported CI passed
  (CodeRabbit skipped). Preserve
  original records/calculations; show sponsorship separately from cash receipts.
  Owner will compare originals for suspected unentered bills behind the expected
  6,851 (DEC-37); no missing bill is independently confirmed.
- FIN-13 is proposed design only. INV-08's five-row Archive list was observed;
  source has no row cap or zero-stock exclusion, but stored-count completeness
  could not be checked because Supabase read permission is unavailable.
  Its separately approved UI counts/mode/filter clarification is DEC-38.
- DEC-38 code is now committed/pushed as `45893068`; finish its CI and the optional
  live search interaction after the owner signs in. Database source-count checking
  needs the connected read access restored; do not retrieve or expose credentials.
- Generated UI-build health metadata was preserved in scoped Git stash
  c935d915326ba6f7563dd391b7e195adcf8b3b18 after approval review rejected a restore.
  Later report-build metadata is preserved in stash
  ad285e6d16afa83078aac1c30ee6ffe4223fc9ef; Archive-build metadata is in
  d6a65a6d6104d3ff4c10e87b47ef67ef3c9bc914. Do not drop these stashes.
- Recovery: code-only batch must be a separate reviewed commit, reversible without
  rewriting business data; no live SQL migration, role grant or terminal reassignment
  is part of Batch 1. An expanded architecture/schema need requires new approval.
- Keep the local preview process unchanged/available for owner review. Starting,
  restarting or checking a server is not proof of correct SQL or authorization.
- Before stopping, record any new decision, task change, approval and verification
  limit here. Preserve Membership hold and every unresolved row.

## FIN-13 implementation handoff — 2026-10-29
DEC-57 supersedes earlier design-only statements above. Implemented on codex/add-missed-bill from beta bce925a2. Administrator-only online historical entry, required stock choice, original attribution, atomic retry protection and historical receipt marking are implemented. Original shift is audit-only; operational sale/payment shift remains NULL to preserve issued shift reports and the current drawer. No live migration or real sale was performed.
Verification: 554 suites / 3,430 tests passed; 11 isolated PGlite scenarios passed; TypeScript and scoped ESLint passed; final registry/dialog checks 3 tests passed. Installed Electron/mobile transport, replica propagation and physical printing remain unverified. Browser interaction unavailable because browser use is disabled in Work settings. See database/add-missed-bill-review.md. Live database application requires separate project-specific approval. Membership remains ON HOLD.

## AUTH-10 — cashier PIN reliability (2026-10-30, owner approved investigation/fix)
Active: distinguish confirmed wrong credentials from connectivity, missing synced SQL PIN hash, validation and session errors. Preserve real lockouts, permissions, branch binding and checkout. Owner also requires verifying Electron offline sign-in and local SQL verifier storage; use independent agent review. Confirmed: missing local terminal hash enters failed-attempt mutation in synced-staff-login.cjs. Suspected: uncoded UI refusals consume local attempts. No live credentials/settings/data changes approved. Membership remains ON HOLD.


AUTH-10 implementation evidence: missing/blank synchronized terminal PIN hash now returns missing before failed-attempt mutation, after existing lock enforcement; uncoded UI refusals no longer count as wrong PIN; malformed successful cloud RPC data returns central_unavailable. Independent agent reviewed/implemented native guard. 8 focused suites / 70 tests passed; TypeScript passed. No live SQL, credential or permission change. Online verify_terminal_pin still uses empty results for multiple refusal causes: exact lock/missing/wrong-PIN classification needs a separately reviewed database contract upgrade. Physical offline Electron acceptance remains pending. Local SQL sync supplies hashes; compatibility roster/enroll IPC calls do not enroll credentials.

AUTH-10 online read-only audit (2026-10-30): ROSEGILL pos project qhrufhtbeguxydenzfey / organization bjxgimekljzlnwejuawj verified healthy; pg_get_functiondef confirms deployed verify_terminal_pin conflates locked/missing/inactive/wrong PIN into empty results and missing hash consumes canonical attempts. No PIN submitted; no live rows changed. Online browser and Electron deadlines are 6 seconds while verification, Auth proof, session/settings and audit calls are serial and lack a shared server deadline; latency/session-after-abort risk is confirmed in source, not measured as affected-user cause. Successful empty profile response is mislabeled inactive. 3 online suites / 30 tests passed outside sandbox; sandbox rerun had temporary SSR-cache ENOENT failures. Database status-contract change and bounded login/session/audit handling need a separate reviewed correction batch; never bypass lockouts or drop audit evidence.

AUTH-10 owner authorized both online/offline fixes after audit (2026-10-30). Prepare additive typed service-only verifier without changing old RPC; do not apply until exact project/migration approval. Limit deadlines to login callers, preserve global relay and checkout behavior, retain awaited audit delivery, preserve locks and branch guards. Independent agents own SQL contract and client timing; root owns server integration.

AUTH-10 current verification: browser/Electron login budget30s (no automatic credential retries); missing/malformed successful profile reads report unavailable, notinactive. 8 focused suites62tests, TypeScript and scopedlint passed. New service-only verifier migration20261030075132_typed_terminal_pin_verification.sql prepared; 11real-pgcrypto isolated cases passed and canonical schema24tests passed. Old live verifier unchanged. New routine correctly separates locked/missing/invalid and matches local independent credential source; unsupported2b/2y hashes return credential_unavailable withoutattempt, nohashrewrite. Direct switch to absentRPC was rejected by automatic approval review; keep old endpoint active until additive routine applied under explicit project-specificapproval, then integrate/testdeploy. Full serverdeadline/audit reliability remains pending; no claim30sclienttimerfixes databaseperformance. LocalpreviewHTTP200. No production or installer publication.

AUTH-10 live application approved by owner and completed2026-10-30: migration typed_terminal_pin_verification applied to ROSEGILL pos qhrufhtbeguxydenzfey (orgbjxgimekljzlnwejuawj). Post-apply catalog privileges: old/newRPC service_role=true, anon/authenticated=false. No real PIN submissions or financial/account mutations. Local code now uses typedRPC; focused7suites61tests+TypeScript+scopedlintpassed. Independent second agent found no critical integration issue; branch/device/permission/session guards intact. Fullregression running. Earlier directswitch rejection is resolved by approved application and privilegeverification. Existing deployedbinaries/backend stillneedcodeupdate. Remaining separate improvement: bound fullserverlogin/audit pipeline;30sclientlimit alone doesnotprove this complete.

AUTH-10 final local regression: 554 suites / 3,443 tests passed, plus11isolated real-pgcrypto scenarios, TypeScript/scopedlint/diffchecks. Existing empty booking draft restored after temporary discovery hold. New verifier applied and accessverified; localpreviewkeptlive. Device/end-to-end credential checks and deployed backend/native rollout remain unverified. Rollback: revert this login commit to oldserviceRPC (preserved); do not erase attempts, credentials or newroutine blindly.

DATA-LOADING-20261030 active: owner reports supervisor/inventory loading and SupabaseGateway/PostgREST/Auth/Realtimeerrors; requestsagentinvestigationandfix. ReadonlyROSEGILLlogs last24h:315Postgresstatementtimeouts,304PostgREST57014,6schemacachetimeoutentries,Auth/user504,Realtimepoolqueue11.6s. Bootstrap dominatespg_stat_statements2258calls/mean3097.6ms; currentactivitysnapshot noquerylockblockers. Agents tracingRLS/helpercost and syncpagination retryamplification. NoDBdata/configrestartchangesapproved. PreserveMembershipHOLD and donotblank/fabricatedataorweakenRLS.


DATA-LOADING-20261030 prepared fixes: timeout retry backoff250/500/1000/up to2000ms, no retry for permission errors and no cursoradvance;16Vitest+11event-sync tests passed. Prepared NOTAPPLIED migrations20261030081625_product_bootstrap_uuid_keyset.sql (products/barcodes UUID seek only) and20261030081804_optimize_catalogue_read_policy.sql (sameauthorizedproduct-IDset computed once; SELECT policy only). Root independently ran7+8isolated PostgreSQL scenarios; exact visibility/page equivalence,3,108products,deniedscopes,archived/negative/transfercases andplanspassed. No stock/status/price/ownership/permission/checkoutmutation. Livefloor10 alreadycorrect, sourcefloor100drift notruntimecause. Need exactprojectapproval beforeapplyingreadroutines/RLSpolicy; million-rowperformance and affecteddeviceacceptance unverified.

DATA-LOADING-20261030 verification/review: independent cross-reviews found no actionable scope/cursor issue. Isolated15scenarios+16syncVitest+11event-syncpassed. Canonical/catalogue/syncgroup62/63initiallypassed; remaining textualmin-page invariantfailed onlyonmigrationguardliteralorder, equivalentchecksreorderedand22syncscope tests+7keysetscenariospassed. TypeScriptpassed. Exacttwo-migrationROSEGILLapprovalrequested; neitherapplied. Currentdatabaseactivitysnapshotnoactivequeryblockersdoesnotnegaterecordedintermittenttimeouts. No claim UI fullyrecoveredbeforeliveoptimizationandaffected-sessioncheck.

DATA-LOADING-20261030 owner approved both read-performance migrations for qhrufhtbeguxydenzfey pos. Applied product_bootstrap_uuid_keyset successfully; readback confirms UUIDkeysetactive. optimize_catalogue_read_policy twice returned connector Invalid/expired requestState. After firstfailure, helperNULL and oldpolicy verified, so secondattempt was justified. After secondfailure verification itself timedout; finalstate unconfirmed, stopblindwrites. No restart/sessionkill or rowmutation. Need lightweightreadback/recoverconnector, then apply onlyifabsent and approved. Do notmarkcatalogueoptimizationappliedwithoutcatalogproof.

Catalogue confirmation2026-10-30: successful livecatalogread showed readable_catalogue_product_ids absent and old product_catalogue_visible_to_me(id) policyactive. Reusedownerapprovalforretry; apply_migrationfailed initializinghistorytable dueconnectiontimeout. Subsequentreadbackalsotimedout. LastconfirmedstateNOTAPPLIED; do notclaimoptimizedpolicyactive. Approvalretained; DBconnectivity/migrationhistoryinitializationblocksrollout.

DATA-LOADING-20261030 extended ownerrequest: useagents, inspectcurrentDB and all24hAuth/Realtime/Gatewayerrors, fixconfirmedcausespreservingfunctionality. Exactwindow2026-10-29T09:10Z..2026-10-30T09:10Z:388PGtimeouts;Auth44requesttimeout504,16other500,3unexpectedfailure500; parsederrorsconfirmAuthsupabase_auth_adminlocalhost5432connecttimeouts/cancellation. ProviderDBunavailabilitynotincorrectcredentials. FreshSELECT1viaManagementtimeoutcontinues. Agentsauthorizednarrow transientAuthproofpreservationandRealtimejoinrefreshcoalescing; noMembershipchange, no restart/termination/permissionswidening. Historicalerrorscannotbeerasedorclaimedresolvedwithoutnewruntimeevidence.

AUTH-11/DATA-loading adminextension: owner requestsadministratorpasswordlogin also. ConfirmedUIthrownlogin leavesbusyflagset, duplicate submissionspossible,post-authprofile503classifiedpermissiondenied. Agent implementingguard/finally+preciseclassificationandboundedprofilequery. RootboundedserverAuthfetch/body8s andmalformedresponsehandling. Incident evidence/recoveryboundaryrecorded docs/database/2026-10-30-loading-incident.md. No realcredentials entered orliveaccountsettingschanged.

DATA-LOADING/AUTH-11 applicationfixes: transientAuthresume proof/bearer preservation,20sweb/mobilevalidationcap (Windows8s), serverAuthfetch+body8sbounded, branch-existence tri-state8sbounded forlogin (unavailable!=deleted) with synccompatibility preserved, Realtimejoincoalescing250ms/max1s. AdminUIguard/finally+profiledeadline15s andnetworkclassification implemented. Fullsuite checkpoint556suites3466testspassed beforelastbranchtests/serverextension. Twoearlierfullfailureswere obsolete inlineidentityassertionandauditpolicytestcountingunrelatednewhelper; updated toactualhelpercalland3exactauditpolicystatements,keeping4staffgateassertions. Remainingserverdeadline/usernameauditactiveagents. No realcredentialsubmissions, providerrestart, usergrantchangeorMembershipedits.

Ownerdecision2026-10-30: Leave Membership dependencies unchanged (explicitreply toshared-loaderexceptionrequest). Do NOT isolate/remove/modify Membership bootstrap reads. Retainconfirmedrisk thatmembers/tiers denial canblocksharedsnapshot; thisisdeliberatelyunmodified, notverifiedresolved. Continuelogin/Auth/Realtime/performanceworkonly.

AUTH-11 finalscope: cashier20score/25sdownstreamrequest +username20slookupAuth/25sthrottlebudget; optionalsharedsignalsleaveothercallersunchanged. ServerAuth/branchchecks8s; adminprofile15s; browser/mobilevalidation20s. Agentindependentreviewnofoundauthorizationregression. Recent17:26:12–17:31:12logwindowhas7PGtimeouts+5Realtimeerrors; providerrecoveryNOTverified. Fullsuite3493/3494initiallypassed; remaininglegacyterminal-callargtestcaughtemptyoptionaloptionschange, fixedruntimehelpertohonororiginaloneargumentcallwhennoSignal. Twofocusedfiles10testspassed; fullrerunactive. TypeScript/lintpassed. NoMembershipchanges.

AUTH-11/DATA-loading finalapplicationverification2026-10-30:560suites/3,494testspassed afterdeadline/default-contractfixes; TypeScript/scopedlint/diffchecks and independentsecurityboundaryreviewpassed. Noassertionofproviderrecovery oractualnewadmin/cashierlogin: realcredentialsnotentered; latestfreshDBcatalogreadstilloldpolicy/nohelper and17:26–17:31logsongoingPG/Realtimeerrors. UserdeclinedMembershipdependencychange; preserved. Thisbatchupdatesbetareviewonly, no installer/OTA/mainpromotion. Incidentreportprovidesoperator/providerrecoveryevidence.

HEALTH-20261030 exactwarningaudit: local/inventoryHTTP20081ms atlatest49f0aebb; standaloneconfiguredSupabasepublic_flagsGET20011,416ms (publishablekeyneverlogged). Warmwebhealthbudget8s canrejectaslowrespondingbackend; heartbeatSDKalsoawaitsstaffAuthmutexbeforepublicread. Agentimplementingauth-independentconfiguredpublicprobe+15sweb/mobilebudget+HTTPstatusclassification; desktop5sfailoverpreserved. Rootcorrectedgenericconnectivitytoastnotopromisealltillscontinueoffline/automaticretryofeveryaction. No warninghidden/protectedreadbypass/Membershipchange.

## Health probe correction — 30 October 2026
Implemented: public health reads use the operator-configured resolver and public key without waiting for staff Auth. Warm web/mobile checks allow15seconds; desktopfive-second fallback is preserved. HTTP408/429/5xx are not treated as credential rejection. Protected reads and Membership are unchanged. Connectivity wording no longer promises offline operation or automatic replay for every action.
Verified:560suites/3,504tests passed, TypeScript and scopedlint passed. The credential-hardcoding guard remains intact; startup fixtures use short unmistakable placeholders. Local runtime serves the new probe. Cloud request latency and the unapplied approved catalogue policy remain separate outstanding issues.

## Loading recovery follow-up — 30 October 2026
Owner clarified the stuck screen alternates between central-service delay, loading data and restoring connection, including after failure. Independent agents traced each boundary. Implemented IndexedDB Auth open/read/write deadlines (2.5 seconds per operation), late-result fencing and explicit-removal tombstones; no credential rewriting. Initial POS bootstrap has a 60-second deadline, visible stalled/failed recovery and synchronous retry invalidation. A location directory or healthy SQL pool no longer counts as a complete business snapshot. Read identity includes person, backend mode and branch; branch changes retire old reads before publishing the new view. Existing matching confirmed data may remain usable with a warning. Membership reads, grants and checkout mutations are unchanged.
Verification: 563 suites / 3,521 tests passed outside the sandbox, TypeScript, scoped ESLint and diff checks passed. The first sandbox run could not read generated Vitest temporary modules (ENOENT); it is not a passing run. Browser confirmed the current local timeout screen and usable Try again control. No real credential submission, sale, stock adjustment or installed-device acceptance was performed. Preserve the unrelated empty booking migration, restored after the test discovery hold.
Live infrastructure remains degraded: dashboard showed CPU approximately 91–95%, severe memory commitment warning, and an about-to-deplete Disk IO Budget warning (5 MB/s baseline after depletion). These are pressure indicators, not proof of one exclusive cause. Quota restriction banner is dated 21 November and must not be described as a current imposed restriction.
The connector continued to time out. The exact already-approved catalogue policy transaction was submitted once through the ROSEGILL pos SQL editor as a fallback; it remained Running when last observed. A subsequent catalog read timed out. Application/rollback state is UNCONFIRMED, not successfully applied. Query reference: 36802140-949a-47b1-bb5a-cccd02f34360. Do not resubmit until catalog state and any pending execution are checked. Manual SQL editor execution does not establish a migration-history entry. No compute upgrade, project restart, session termination, billing change or extra database repair is authorized.
Recovery: revert only this code batch to the prior commit if needed; do not roll back business records or blindly remove the approved catalogue function/policy. Beta PR update is separate from merge, production and installer publication.

## CPU-20261030 — active incident investigation
Owner requests tracking/reducing database CPU and restoring both preview and production, which share ROSEGILL pos. Read-only live inspection at 18:26:35 Asia/Brunei confirms the previously approved catalogue helper and SELECT policy are now active; anon EXECUTE=false, authenticated=true verified at 18:27:04. This supersedes the unconfirmed application state above; migration-history reconciliation remains separate. Database size approximately269MB. Cumulative highest execution cost: sync bootstrap, Realtime list_changes, product reads, delta pull; these are not CPU measurements or window-specific attribution. One active PostgREST query was SELECT name FROM pg_timezone_names; later snapshot finished, no active application query. Two scheduled cron jobs observed (daily and hourly), not proven responsible. Agents auditing source amplification and SQL patterns read-only. No restart, compute/billing change, session kill, new live schema/data edit or Membership change approved.
CPU-20261030 preparation boundary: automatic approval review rejected writing the new branch-sync migration because visibility/sync routines are security-sensitive and prior approvals covered only two named migrations. Owner then explicitly approved preparation and isolated tests ONLY for 20261030102943_optimize_branch_catalogue_sync_reads.sql on ROSEGILL pos; live application remains unapproved. Agent owns migration/schema/test preparation, root cross-review required. Separate client amplification correction is within the requested loading/CPU work: resolve unknown branch before full snapshot; prevent foreground/idle refresh racing first bootstrap. Membership and checkout unchanged.
At 18:29 read sampling the expensive bootstrap, product, pull and Realtime cumulative counters were unchanged since 18:27; historical totals cannot establish current CPU source. Dashboard last10min18:20–18:30 has NO CPU data, memory sample18:27 shows1.46GB severe commitment, IO Budget warning persists. Do not claim91% is a current instantaneous reading or that CPU was reduced to3.21% (older chart value). SQL database size268,643,475bytes; actual application data size is not host RAM/IO workload. Latest10minute log window records13PGtimeouts and Auth internal failures, plus slow dashboard catalogue/extension queries. Limit expensive dashboard polling.
CPU-20261030 checkpoint: direct cause of current shared production/preview outage confirmed PostgREST schema-cache load57014/PGRST002, not operator permission refusal. Existingschemaspublic/graphql_public present; runtimePostgREST14.5 timezone metadataquery47/54seconds observed. Relevantupstreamissue5100 documents expensivetimezonecaching. No upgrade/restart byagent. OwnerapprovedonecontrolledROSEGILLposrestart; browser tool disappeared before submission and connector has no restart. Owner renewed request to try and restart localserver; localserver restartedlatestsource, InventoryHTTP200. At18:42 DBstartstill26October; publicREST5039.642seconds/Authhealth200430ms. Membership/checkoutunchanged.
Implemented client request coalescing/cold branch resolution; full563suites3526testspassed with2workers, TSC/lintpassed, prior secret-scantimeoutpassedisolatedandfullrerun. Prepared new branch-sync migration passed8isolatedscenarios plusindependentreview; liveapplicationNOTapproved. ExistingcatalogueSELECToptimizationconfirmedactiveandprivilegechecked. Need betaPRdelivery ofthisnewbatch, then owner/APIrecovery verification and separate liveSQLapplicationdecision. Keep all other pending tasks.

## Post-restart verification — 30 October 2026
Owner reports FAST restart completed and requests production/local loading, CPU and all-service error checks while preserving checkout/permissions. Database restart verified: pg_postmaster_start_time=2026-10-30T10:48:29.717085Z (18:48:29 Brunei). Initial57P03/shutting-down and not-accepting-connections checks reflected restart transition; do not trigger another restart. LocalInventoryHTTP200117ms andproductionhomepageHTTP200734ms establish website delivery only. DataAPIpublic_flags still503 afterrestart (13.45s latest probe); Authhealth200417ms earlier. UseraskswhypluginconnectedbutexecuteSQLfails: connector authorization is distinct from SQLserver/runtime availability. Currentdiagnosticsconfirmconnectiontimeouts, not SQLsyntax/permission failures.
WindowsinspectioninitializednewComputerUse skill, buttool stoppedbecausecurrentbrowserURLcouldnotbeverified; no furtherUIactions thisturn. Actual visualdata-loading acceptance unavailable. Metricsendpoint returned401 twice usingexistingserversecret anddocumentedBasicuser variants; noCPUmeasurement obtained, no newcredentialcreatedorrotated. Do notclaimCPUrecoveredfromold91%display.
Serviceaudit10:48:29–10:53:41Z: Auth4DBlookup/refresh500/504timeouts, zero42501/invalidcredentials. Realtimehealthrecovered10:48:39, replication10:48:55, noerrors; laterorderlyshutdownbecause no connected users. Storage19health200and2abortedhealthwarnings, nopermissiondenials. PostgRESTschema-cachePGRST002/57014persists includingtimezone/columnmetadataqueries. Systemcatalogstatsavailableandpg_depend0.5MB; currentevidence doesn'tjustifyblindcatalogmaintenance/grantchanges. One management advisoryqueryobserved190seconds thenfinished; donotcancelunknownsessionsorcontinuouslyrunexpensiveadvisors.
Independent agentfoundtworecoverygaps: transientfailedbootstrapmaynotretrywhenhealthyprobeleavesconnectivitycategoryonline; focuscanreplaceonline/reconnecturgencywithfive-minutethreshold. Approvedremainingloadingfix scope includes narrowtransient-onlycooldownrecoveryandOR-latchedresumeurgency, with denied/branch/cancellation tests. Membershipreads/grantsunchanged. SeparateCItest-onlyfix prepared: event-syncNodefixturemustwait250mscoalescing; branch/logout/stalechannelassertionsretained, failedCIgroup78/78passed.

### Authentication-first checkpoint (owner direction, 30 October)
- Owner restart verified at 18:48:29 Brunei; no additional agent restart.
- Auth role login/expiry/connection-limit and required table/schema privileges checked at 19:01:52: valid. IPv4/IPv6 listening and sampled connection capacity are normal. No evidence supports changing staff permissions or passwords.
- Auth-to-local-PostgreSQL timeout/connection failures remain, including 19:00:39; shared Data API schema-cache failures remain separate. Membership unchanged. Realtime and Storage health recovered in the audited post-restart window.
- Implemented bounded transient-only recovery, reconnect urgency retention and typed directory errors; 563 suites/3,534 tests, Node78, types/lint and independent review passed. Visual verification and fresh CPU metrics unavailable; do not claim live loading or Auth fixed.
- CI stale notification timing assertion corrected without weakening branch/logout checks. Keep all other unfinished items, prepared-only SQL and financial migration approvals separate.

### Backup-first database repair request — 30 October 2026
The owner explicitly requests a backup before attempting schema/configuration recovery and preserving all current tables/records. No new live repair is permitted before a complete recoverable backup is obtained and verified. A full restore could erase post-backup sales, so preserve subsequent transactions and require a reviewed recovery point and maintenance plan; do not automatically restore on any error. Current authority is to obtain backup and investigate targeted repairs, not reset/recreate tables, widen grants, rerun the full canonical schema or replay already-applied migrations. Membership hold remains.
Initial backup capability check: connected Supabase tools expose SQL/logs but no backup/export action; restore_project is not a selected-backup restoration tool. No DATABASE_URL/SUPABASE_DB_URL/SUPABASE_DB_PASSWORD/SUPABASE_ACCESS_TOKEN configured in process environment. Direct pg_dump/psql/Supabase executables not found on PATH. API public/secret keys are not database dump credentials. Backup is NOT created or verified. Discover supported backup access and continue read-only drift review; never substitute incomplete JSON exports for a restorable database backup. Never store dumps in Git or print credentials/business records.
Backup setup decision: owner chose help configuring a secure local backup connection. Created .private-backups with inherited access removed, current Windows user and SYSTEM full control only, and self-ignoring .gitignore (*); no credentials or database records stored yet. Direct PostgreSQL DNS resolution failed on this PC; support exact-project Session pooler on5432, not transaction pooler. Local setup GUI preparation uses masked password and Windows DPAPI CurrentUser encrypted configuration; owner enters existing password locally. No password reset, API key creation or database changes authorized. CLI discovery failed npm DNS in restricted environment; official portable PostgreSQL client discovery is in progress. Complete backup and restore verification remain pending.

### Read-only manual-SQL chronology and I/O investigation — 30 October 2026
Owner paused repair, then authorized investigation of yesterday's changes only. Owner clarified that SQL was run manually through this same chat/SQL Editor, not necessarily recorded as migrations, and reports CPU about 97%, mostly I/O wait about 91%. These percentages are owner observations, not independently sampled measurements. Retain backup-first and all unfinished tasks; no new application, live SQL, configuration, restart, rollback or permission changes are authorized by this investigation. Membership stays ON HOLD.

- Completed investigation: an independent agent paginated the actual chat history through every 29 October turn and the preceding 27 October application turn. The cluster-catalogue isolation migration was applied on 27 October morning (07:14–07:57 Brunei turn), not yesterday evening. On 29 October, SQL Editor checks at approximately14:07–14:27 were SELECTs. The confirmed live write was the exact594-product ownership repair at14:43:49 Brunei; its invariant-checked SQL completed in6.095seconds and the immediate count read in2.267seconds. Owner-preserving sync and missed-bill migrations were prepared but NOT applied. No other29October schema/policy DDL was found in the recovered chat; unrecorded/outside-chat changes cannot be excluded. A filename, migration-history gap or Git date is not proof of manual execution timing.
- Live readback19:31–19:34 Brunei: browser products SELECT uses readable_catalogue_product_ids; service bootstrap/counts still use per-row product_available_in_catalogue. All four inspected product-owner/transfer indexes are valid and ready. Catalogue helpers are owned by postgres with BYPASSRLS, so the suspected direct RLS recursion was not demonstrated. The sync owner-preserving assignment remains absent; this separate known risk was not changed.
- Confirmed costly query shapes: repeated product/branch/privacy/transfer checks in sync; casted barcode-to-product UUID lookup; global ID invalidation fan-out; per-product transfer projection on writes. They can amplify work but do not establish a persistent loop or explain the full current outage. Do not undo cluster isolation or the verified ownership repair speculatively.
- Current wider bottleneck: PostgREST timezone metadata query observed active23seconds without a blocker. No POS bootstrap was active in that snapshot. pg_stat_statements reset with restart at18:48:28 and contains no completed matching bootstrap/count/delta/Realtime entries afterward; historical cumulative sync cost cannot be used as current CPU attribution. Pooler authentication and migration-history reads remain slow. The log-query connector returned internal errors twice; exact yesterday-evening onset could not be reconstructed from new log reads.
- I/O: track_io_timing is off, so zero SQL I/O timing does not prove fast storage. Owner's high I/O wait makes disk latency/burst budget and memory/swap pressure priority hypotheses. Existing SQL counters do not identify host system-disk/swap or filesystem time-zone reads. Fresh aligned host metrics are still needed; do not claim disk budget exhausted or a single root cause proved. See database/2026-10-30-loading-incident.md.
- Backup remains BLOCKED: local setup window failed because Windows script execution is disabled; no bypass or policy change performed. Official PostgreSQL portable ZIP downloaded and checksum verified, not extracted/executed. No credentials saved and no backup/export or restore verification completed. No live repair may proceed yet.

### Time-zone dependency clarification — 30 October, 19:43 Brunei
Owner suspects receipt/time-zone SQL introduced the slow dependency. Read-only live inspection confirms application uses as well as PostgREST's built-in use: v_sale_line_facts and v_daily_store_sales reference pg_timezone_names in their region CTEs; save_notification_rule_table uses it for validation. These match migration20261017083528_reconcile_business_analytics (committed17October) and notification_rule_table. Analytics and All Shops lifetime reads consume the reporting views; nested view calls can repeat zone-name validation. Earlier explanation covering only the service's startup use was incomplete. This establishes an additional application dependency, not the root cause of the outage or evidence it was applied yesterday. No active pg_timezone_names query was present in the19:43:09 snapshot. Removing application lookups would not remove PostgREST14.5's separate unconditional schema-cache lookup. Investigate an isolated equivalent report optimization preserving saved business/store time zone, date buckets, monetary calculations, RLS and grants; no preparation/application or rule change approved by this clarification. Do not drop the built-in system view, use a nonexistent14.5 disable flag, or switch reports to the viewing user's zone. Backup-first boundary and Membership hold remain.

### PostgREST recovery investigation — 30 October, 19:47 onward
Owner asks to check/fix continuing unhealthyPostgREST and production warnings, keeping cluster rules unchanged; authorizes direct dashboard inspection. Fresh DataAPI503/PGRST002 confirmed twice (2,437ms;19:49:57follow-up1,355ms). Authhealth200doesnotproveAuthDBtokenrecovery. Database snapshots show no open transaction/blocker, six clients, and later the barePostgRESTtimezonequery. ManagementACTIVE_HEALTHYdoesnotmeanDataAPIready.

Dashboard browser access recovered. Refreshed health and aligned last-ten-minute19:41–19:51window: CPU66.73% mostlyI/Owait, memorycommit1.41GBSEVERE, dataIOPS1/throughput22.3KB/s, sixconnections. Separate Infrastructure weeksummarydiskIObalance98%,diskspace29%used,Nano up-to0.5GBRAM. Do notclaimdiskfull,creditsdepleted,memoryleakorswapthrashing. Committed_ASisnotphysicalRAM; allocatedswap415.23MBat19:13doesnotmeasurecurrentpagingrate, displayed95.69%usesRAMdenominator. Different chartwindows/hover/missingpointsaccountfornoncomparablefigures; noSupabaseUIcalculationbugconfirmed. Pending: actualhostswaprates/deviceawait, currentcachefailureSQLlogs (plugininternalerror;UIloading), provider-supportedservice/hostrecoveryproposal and verifiedbackup. Prepared providerescalationdraft in existingincidentreport; NOTsent. AvailableUI17.11PostgresupgradeisnotPostgREST-onlyupgradeapproval. No app/liveDB/service/billing changes, restart, additional grant or backup performed. Membership hold and all other unfinished tasks preserved.

### Local backup execution — 30 October, owner renewed instruction
Owner explicitly requests creating a local backup before a targeted repair; any restore must preserve newer transactions and have a separately reviewed recovery plan. Yesterday's migration investigation is FINISHED, not restarted. An old-named agent was briefly reused for backup review; owner objected to the misleading status, so it was stopped and replaced with a clearly named backup-only reviewer.

Verified official PostgreSQL17.11 archive SHA256, extracted only native client executables/dependency DLLs under the ignored/private backup directory, and verified pg_dump/pg_restore versions. No installer/service/PATH/security-policy changes. Downloaded official curl CA bundle and verified its published SHA256 (796F1389BFEA13C0ED78F663B765BAAFF54A508E5483786BD6ECE73C5E3E3CBE). Exact ROSEGILL pos Connect dialog confirms Session pooler aws-0-ap-southeast-2.pooler.supabase.com:5432, user postgres.qhrufhtbeguxydenzfey, database postgres. Password is entered locally only, never chat/arguments/logs; no password reset.

Native pg_dump attempt at20:20:52 used verify-full TLS, read-only session, one connection, custom archive and five-second lock wait. PID17832 exited; database.dump.inprogress is zero bytes. Capture metadata exists only in private pos-20261030-202052 folder. This is a FAILED/UNVERIFIED attempt, not a backup. No roles export, archive decoding or isolated restore has occurred. Correct the interactive console launch and retry only after the owner's current project restart completes. Preserve failed artifact; do not repair/restore based on it. Full backup coverage must include schema/data/ACL/RLS/routines, separately captured roles without passwords, Storage-object coverage and compatible isolated restore acceptance.

### Pro plan verification and owner restart — 30 October, 20:15–20:24
Owner reports adding Micro/Pro, asks to fix current database/Storage timeouts, then reports another self-performed project restart. Browser confirms organization Pro but the existing pos project still Nano; SQL20:17:31 still shows original18:48:29 start, max_connections60/shared_buffers224MB. Official compute documentation confirms paid plan does not automatically resize existing Nano, to avoid unrequested downtime. No paid resize or restart performed by the agent.

Fresh pre-restart probes20:16: Data API200 in11,195ms, Auth health200 in3,117ms, Storage status200 in1,051ms. This supersedes earlier continuous PGRST002 as the current state, without certifying sign-in/protected reads. Working logs now identify pos_sync_bootstrap timeouts20:10:27/20:10:52/20:15:48/20:18:49, and anon terminal_token_heartbeat57014 failures20:16–20:18. Storage warnings are aborted internal health reads (~4.6–5seconds), not observed permission denials. The prepared set-based branch-sync helper is still absent; current counts use per-row catalogue checks. No live optimization applied.

At20:23:50 Management status is RESTARTING, public Data API521, Storage status200. Do not conflate restart-transition failures with steady-state corruption or repeatedly restart. Next: verify new start/actual compute and fresh allowed/denied read readiness, complete local backup, then present the exact supported correction. Current schema-cache outage, later application RPC timeouts and current restart are separate stages. Backup-first, branch/cluster isolation, checkout permissions and Membership hold remain intact.

### Owner stopped backup and repair work — 30 October
Latest instruction: stop all backup preparation/database repair because the app is now working; owner wants to focus on further changes/updates. Backup and repair tasks are PAUSED at the owner's request. Do not launch another backup prompt, request the password or run repair/restore automatically. Earlier pending password-entry question is superseded. Preserve private preparation files and incomplete zero-byte attempts; no verified backup exists. No repair, live migration or restore was applied. Keep unrelated pending tasks and Membership hold; next implementation scope awaits owner instruction. Leave the local preview unchanged.

Preserve investigation evidence for later, without resuming it: owner restart verified20:25:21Brunei; PostgREST logs confirm schema cache queried2,288.6ms/loaded19.1ms at20:25:58, including1,196timezones. Subsequent57014 contexts20:27–20:28 identify change_history bootstrap JSON-ID text sorting specifically. Live read-only EXPLAIN WITHOUT ANALYZE shows SeqScan+Sort(~19,288estimatedrows) for existing expression order, versus existing valid change_history_pkey IndexScan for bareUUIDorder. No actual history scan, row rewrite, index creation or routine change was executed. Targeted pagination proposal remains unimplemented/unapproved and must preserve scope/JSONcursor contracts, collation/order equivalence and future generator consistency; never replay the whole generator/schema. Separate heartbeat source review found duplicate ten-second monitor instances on Updates and global feed/broadcast per heartbeat; preserve revocation cadence and verify any later correction separately.

Latest native console backup attempts did not complete: pos-20261030-202747 archive0bytes, exitcode1. A private user-operated Run-Pos-Backup.cmd was prepared/reviewed, inherited service/host overrides cleared, and no-connection self-test passed17.11tools; it was NOT handed off for execution before the owner stopped the task. No manual launch should now be requested. Isolated restore/Storage-object coverage remain unfinished. Pro organization was verified while compute remained Nano; no agent resize or billing change was made.

### Local live preview requested — 30 October
Owner requests the latest working code running alongside the chat with live updates. Started Vite dev from D:/Retail POS/retail-pos-main/retail-pos-main/work/security-review-fixes-beta, branch codex/add-missed-bill, HEAD bf4460dc, package1.4.80, POS_RELEASE_CHANNEL=beta. Existing .env.local loaded without printing values. Loopback sandbox restrictions required the authorized outside-sandbox server. URLhttp://127.0.0.1:8080; strictPort; Vite8.3.4; managed exec session51105; port ownerPID24852 command independently matches this checkout. Homepage, Inventory and /@vite/client returnedHTTP200. First requests included dev compilation warm-up, not a measured database regression. Keep this dev server running; backup/repair stays paused, no application/database changes or deployment performed. Actual signed-in business functionality and a browser hot-update interaction are not certified by HTTP readiness alone.

### PERF-12 — Repeated client data loading, 30 October

**Active, narrow owner-authorized correction.** Owner reports data loading then
loading again, asks to fix unnecessary reloads, explicitly requests agents and
preservation of functionality. Recoverable baseline: `bf4460dc`, version1.4.80,
`codex/add-missed-bill`; preserve the pre-existing incident documentation and
untracked artifacts. Backup/database repair remains paused; no live database,
Membership, checkout, payment, print, permission or business-rule changes belong
to this batch. Beta first; no publication or production promotion authorized.

- Confirmed by isolated actual QueryClient/QueryObserver reproduction: root
  meta-table refresh and per-hook refresh both consume one event, starting two
  report reads (slow case also aborts the first). `cancelRefetch:false` alone
  does not prevent two sequential fast reads. Affected observed-query consumers:
  shift history, shift sales, All Shops lifetime and sponsorship totals.
- Confirmed startup amplification: ScopeIds depends on the stores array object,
  reinstalling an initial settings read even when effective scope IDs are equal;
  scoped settings start before directory resolution. Shared settings reads may
  run during the primary bootstrap. A second full catalogue bootstrap for an
  unchanged valid identity/branch has NOT been demonstrated.
- Implementation scope: a single owner/coordinator for the affected active
  query refreshes, preserving offline eligibility, authorized query keys/store
  filters, sponsorship60-second reconciliation and genuine trailing changes;
  scalar settings-scope dependencies and readiness-aware shared settings reads.
  Imperative report readers, mutations, source-switch/session cancellation and
  explicit print reads must retain their behavior. Independent bounded agents
  own query refresh files and settings files separately; root owns this ledger.
- Acceptance: one committed hint gives one refresh for fast and slow readers;
  newer committed data during an in-flight read retains a trailing pass;
  lifecycle bursts reuse fresh data, reconnect catches up; local SQL refreshes
  offline while cloud-only reads remain gated. Equal scope IDs do not restart
  settings; actual branch/user/source changes remain isolated; no early empty
  scope read before authoritative directory discovery. Test allowed/disabled
  readers, scope transitions, existing checkout/permission/print regressions.
- Recovery: revert only this batch's client changes, preserving unrelated work;
  no schema/data rollback is needed. Pending: implementation, independent diff
  review, isolated regressions, type/lint checks and preview verification. Do not
  call the entire app or all real devices verified from these isolated checks.

### UI-15 / FIN-13 follow-up — 30 October owner request

Owner requests loaded zero/no-data summary cards/sections to hide and appear
smoothly when values become positive, without extra loading; run local SQL and
latest live preview alongside; make Add missed bill available for original-day
transactions recorded while the older POS operates in parallel. Owner separately
reconfirmed **All Shops must keep every shop visible even at zero**. Preserve
meaningful negative balances, real loading/error states, permission visibility,
branch/cluster scope and Membership hold. Do not animate charts as sliding cards.

**Active approved narrow implementation:** reuse shared summary-card UI for
lightweight appearance/reflow motion and correct remaining summary visibility
guards; preserve directory/shop listings. Reuse existing FIN-13 historical-sale
implementation rather than adding another checkout path. Agent found its cashier
picker reads legacy `useAuth().staff`, while StaffManager uses managed database
accounts; investigate and correct that confirmed connection with the same
administrator/branch authority. Previously approved historical-payment, stock
choice, original-time, audit and retry contracts remain controlling. A required
live migration must be identified and presented for exact-project approval first;
this UI request is not approval to create real financial records or apply SQL.

Baseline remains `bf4460dc`, version1.4.80, `codex/add-missed-bill`. Preserve and
finish interrupted PERF-12 regressions before declaring the combined preview
verified. One agent owns refresh code, one summary motion/JSX, one historical-entry
investigation; root owns tracker and dev process checks. No publication/production
promotion, backup/repair restart or Membership work. Local service inspection
confirms MSSQL$LCRPOS Running; app SQL connection/readiness and live preview still
require verification. Preserve operator database configuration and credentials.

#### Verification and rollout evidence

- PERF-12 completed source safety checks: synchronous cancellation now fences
  stale dirty work, hidden/offline commits survive, initial/lifecycle hints do not
  duplicate a read, real newer commits retain a trailing pass. Agent tests and
  independent review completed. Root integrated run:32 files/276tests passed;
  `npx tsc --noEmit` passed. Actual physical Electron/mobile acceptance remains
  separate; do not claim every loading recurrence or all modules fully verified.
- UI-15 implemented220ms native card appearance/grid reflow on visible-key
  changes only; Embla retains slide movement, reduced-motion/static fallback
  supported. Selling/report summaries now omit confirmed loaded zeros while
  preserving negatives, loading/errors and positive bill counts for free sales.
  All Shops listings unchanged. Agent7suites/58tests and independent source
  review passed; browser fixture verification pending.
- FIN-13 picker now reads authoritative active branch/all-branch accounts on
  demand, minimal IDs/names, fresh administrator/terminal-branch authorization,
  scoped cache/pagination/error/retry. Native binding proof survives validation
  and is excluded from the financial payload. Agent43focused tests and existing
  11isolated SQL cases passed. No real historical sale entered during tests.
- Owner explicitly approved the exact missed-bill migration for ROSEGILL ->
  rosegill0011@gmail.com's Org (`bjxgimekljzlnwejuawj`) -> pos
  (`qhrufhtbeguxydenzfey`, https://qhrufhtbeguxydenzfey.supabase.co).
  Applied2026-10-30 at13:34:07UTC (21:34:07Brunei), Supabase history version
  `20261030133407`, name `add_missed_bill_historical_entry`; source file remains
  `20261029073121_add_missed_bill_historical_entry.sql`. Verified audit table
  exists/RLS enabled, authenticated SELECT/EXECUTE denied, service EXECUTE allowed.
  Application creates no sales/stock movements; no existing rows changed by SQL.
- Live Vite restarted after interruption, version1.4.80, same worktree,
  http://127.0.0.1:8080, session64909. Visible Electron opened against that server.
  MSSQL$LCRPOS/POS_Local and Electron's existing native driver passed SELECT-only
  Windows-auth/direct1433 probes. Existing app profile still reports ECONNECTION;
  this is NOT verified local trading readiness. Public-profile diagnosis pending;
  no operator settings, SQL services or credentials manually changed. See the
  automatic-startup migration caveat below before assessing schema changes.

  Correction after deeper read-only inspection: the local migration ledger
  contains version19 `member_contact_email` at21:26:17Brunei, matching the GUI
  startup. The existing application's automatic upgrader may have recorded it;
  no pre-start ledger snapshot proves its earlier state. Therefore do not claim
  that launching the app performed no local schema work. The diagnostic probes
  and agents themselves performed SELECT-only checks, not migrations. Current
  metadata has all required tables/columns/indexes; version20 is absent and
  `DF_products_ecom_visible` remains DEFAULT((1)), while current source expects0.
  Saved-profile TCP/driver/auth/read-only transaction checks pass. Startup's full
  installer replay was observed, but its failing statement remains unproven.
  Exact local version20-only application to LAPTOP-N0QBONGL/LCRPOS/POS_Local is
  awaiting owner approval; do not replay the whole installer as a manual repair.

- Final integrated checks:34 focused files/290tests across two recorded runs,
  11isolated PGlite scenarios, TypeScript and scoped ESLint/diff checks passed.
  Actual synthetic-browser fixture at1440x900 and390x844 confirmed220ms running
  entrance, unchanged-value stability, zero-removal/reflow, reduced-motion
  suppression, no page overflow/errors and zero interaction network requests.
  Root inspected desktop/phone screenshots. No Supabase/business reads or writes
  were made by this fixture. Live local Receipt History is signed out; owner
  sign-in requested for the real form check, without credentials or a real sale.
- Source commits are separately recoverable: `6defed4f` refresh/settings,
  `14cd2c9a` summary UI, `43d114f5` historical cashier/proof connection. Target
  remains existing draft beta PR342; no production promotion or installer/OTA
  publication. Preserve all unrelated untracked files and iOS signing material.

### SHIFT-14 — Closure notification with two cloud-open shifts, 30 October

**Active read-only incident investigation; no financial/shift record repair.**
Owner reports closure notification but unchanged data and two open shifts.
ROSEGILL pos SELECT confirms event21:08:09Brunei for shift
`8be4c1e9-3f88-4e7b-b52f-a6f31b5005c8` and event15:04:18Brunei for
`f725325a-8919-4d9d-b9cb-24f43d185147`, both branch
`a611a328-2217-4d77-944a-5f6a637d123b`. Both cloud rows remain OPEN/ACTIVE,
row_version1, closed_atNULL and unchanged since opening. No corresponding cloud
shift_cash_counts/shift_close_events rows found. A reported activity event is
not proof the cashier completed the local closure. One aggregate receipt near
21:07:35 has applied_count1 but stores no per-entity payload, so cannot identify
its shift or prove an equal-version skip.

Independent source audit confirms two distinct risks: remote shift row refresh
updates state.shifts while activeShift can retain cached dbShift; sync_apply_shifts
ignores equal/older row_versions while native PushWorker acknowledges ok:true
without verifying the resulting closure, and independent activity aggregates may
upload after a failed/deferred closure. Current native operations increment row
versions; affected older-build/local-outbox evidence is still needed to establish
the incident's exact cause. Do not silently close/reopen/delete either shift,
change counts/totals or weaken concurrency rules.

Next: affected cashier PC version plus pending/failed shift-sync error requested.
Proposed separate correction batch: acknowledge closure only after authoritative
same-branch closed-state confirmation (preserve genuine idempotent replay and
pending failures), deliver accurate closure status, reconcile cached active shift
only from a confirmed same-branch record. Requires bounded files/dependencies,
isolated allowed/denied/retry/offline regressions and owner approval before code
changes; any live migration or historical record repair needs separate approval.

### Beta PR342 delivery and CI checkpoint — 30 October

Source and evidence commits pushed through `e1ef8071` to the existing draft
beta PR342 (base beta, head codex/add-missed-bill). No beta/main merge or release
publication. PR title/body reconciled around final behavior and actual database
application. Full CI permission run:567suites/3,586tests passed,1test failed and
1skipped; sole failure was an obsolete source assertion expecting the old
settings callback name. Corrected only sales-realtime.test.ts to verify the new
startup-aware reader, preserving channel, canonical-read, reconnect and branch
guards. Four focused suites/30tests and ESLint/diff checks passed; CI rerun at
the follow-up commit `dd8dd1f2` PASSED:568suites/3,587tests passed,1skipped.
Security workflow41067640698 also passed account-permission lifecycle,
sync/startup/database-upgrade checks, SQL contracts, updater/release boundaries,
lint, typecheck/build and dependency audit. Android compile41067640735 passed;
iPhone compile-only41067640745 remains running. No publication/merge. PR body
updated with this evidence. Do not report the first CI run as green.

Further local diagnostic: the exact temporary-table readiness probe passed via
Electron's native driver (CREATE/INSERT only in private #pos_write_probe, rolled
back, no permanent schema or business-record change). This strengthens the
distinction between working connection/readiness probes and the failing existing
automatic installer replay; exact replay error is still unproven. Local20-only
approval, real form sign-in and affected-PC shift-sync/version replies remain
pending. Keep server64909 and SQL Server running; preserve all unfinished work.

### Owner reply — local20 and signed-in verification, 30 October

Owner explicitly approves ONLY existing local migration
`database/sqlserver/migrations/020_unpublished_catalog_default.sql` on
LAPTOP-N0QBONGL/LCRPOS/POS_Local in a guarded transaction. Preserve operator
configuration, existing product rows, stock/SKU/prices, permissions and sales;
do not replay the full installer or apply another migration. Independent agent
review requires server/database/default/ledger guards, no concurrent automatic
installer, DDL-trigger inspection, exact binary-JSON product snapshots compared
both directions, rollback on any mismatch, and post-commit readiness verification.
Source remains `dd8dd1f2`; no app-code change authorized by this SQL approval.

Owner reports the affected cashier PC shows its shifts CLOSED locally, while
cloud remains open. This confirms the observed local/cloud mismatch from the
owner's view; the exact failed upload/version/outbox evidence is still absent.
Continue SHIFT-14 read-only root-cause work, without manual shift/count repair or
silently widening scope. Owner also reports Administrator sign-in completed for
the local missed-bill form check. Inspect the live preview without submitting a
real sale. Keep Membership ON HOLD and unrelated unfinished work preserved.

Approved-local20 execution found a confirmed syntax defect: SQL Server Msg102
near QUOTENAME in `EXEC(N'ALTER TABLE ...'+QUOTENAME(@commerceDefault))`.
Batch compilation failed before execution; independent readback confirms no
version20 entry and default still((1)). Correct only that dynamic-SQL construction
to assign the same safely quoted text to an nvarchar variable before EXEC.
Keep the exact approved new-product-default/ledger effects, current data and
all other migrations unchanged. Agent owns canonical020 and matching generated
installer/download-bundle blocks plus focused regression; root owns live guarded
application/readback. This repairs the actual existing auto-upgrade syntax error,
not a connection/driver/credential problem. No full installer replay authorized.

Fresh SHIFT-14 readback supersedes the earlier open state: both cloud shifts now
CLOSED/CLOSED at22:15:06 and22:15:37Brunei via successful direct online close-start
and cash-count-submit RPCs, with closing child records present. Root did NOT
repair these records. Owner/online-client action completed them; don't attribute
that recovery to an unimplemented sync fix. The earlier offline propagation cause
remains under investigation. An isolated actual PushWorker/PGlite reproduction
confirms equal-version localCLOSED/cloudOPEN can apply0 and still acknowledge the
outbox; higher-version control closes correctly. This is a confirmed integrity
defect, not proof of the affected PC's original row version. Separate correction
plan/approval and prevention regressions remain required.

Local20 outcome: syntax-only correction applied to canonical020, its packaged
installer section and generated Settings-download section; no other migration
body changed.13Node upgrade tests,16registry tests/70-table verifier, ESLint and
an actual rolled-back tempdb fixture passed (old value retained, new default0,
repeat ledger entry prevented). The existing app's automatic upgrader consumed
the corrected source and recorded20 at22:23:26Brunei before root's next guarded
attempt. That guarded attempt therefore reported already_applied=true and made
no second change; exact binary-JSON comparison found all2,170product rows stable
during that verification. Do not misstate it as a before/after snapshot of the
earlier automatic execution. No new migration other than20 is recorded.

Post-upgrade actual Electron validator PASSED:ready=true,statusready,77/77required
tables,compatiblecolumns,missingMigrationVersions=[],differences=[],temporary
write-probe rolled back,ChangeTrackingenabled. Clicking Retry local database
reached the real branch-bound cashier/PIN sign-in screen with saved staff names.
No credential was entered and no cashier transaction performed. Local SQL is
ready; separate cloud bootstrap still logs HTTP503/ECHANGEGAP retries. Preserve
that distinction and do not resume Supabase backup/repair automatically.

Real Administrator browser check completed at localhostReceiptHistory:button and
historical fields rendered; original cashier fetched from central accounts. It
revealed machine identities in that new selector. A second agent corrected only
the picker to reuse canonical isOperatorIdentity, retain human PIN users and
terminal.-prefixed human names, keep email server-only and paginate beyond
machine-only pages. Two-file scope; no write routine/permission/schema change.
Agent47tests passed; root6suites/71tests plus TypeScript/scoped ESLint passed.
Live close/reopen confirmed exactly four human options, no machine accounts.
No form values or financial entry were submitted. Keep that blank form open for
owner review. Beta PR342 follow-up commits/delivery pending, no release approval.

SHIFT-14 current actor evidence: terminal registry reports1.4.79; cached main
contains migrations1–18, so do NOT blame this PC's separate20issue for the
affected terminal's earlier closure problem. Stale09:18telemetry cannot prove
its current queue empty. Current cloud closure records are confirmed, but the
reproducible silent-ack defect and cached-dbShift risk remain unfixed. Owner
approval requested for a separate prevention-code/isolated-test batch; any live
SQL migration would need separate exact-project approval. No manual shift repair.

Follow-up source commits: `78ac3e30` fixes only020dynamic-DDL syntax and its
installer/download copies; `248dbae7` excludes machine identities from the
original-cashier picker. They preserve checkout functions, saved user grants and
financial write contracts. Target remains draft beta PR342. Latest local check
ran6suites/71tests plus13Node upgrade checks; actual Electron readiness and live
human-only selector are verified as above. Physical cashier login/payment/print
and offline-shift upload acceptance remain separate. No production promotion or
installer/OTA publication authorized; keep the live server and native preview up.

Delivery verification: follow-ups and tracker pushed through `750a8c97` to draft
beta PR342. Full CI41074071503 PASSED:568suites/3,593tests passed,1skipped;
permission/account lifecycle,sync/startup/database-upgrade,SQLcontracts,updater
boundaries,lint,typecheck/build,dependency audit passed. Android41074071520 passed;
iPhonecompile-only41074071535 still running. PR body reconciled with current
local20ready/human-picker/closed-cloud-shift evidence. No merge or publication.
The prevention-batch approval was pending at that checkpoint; the subsequent
explicit owner approval below supersedes that approval status only. Preserve all
other unfinished tasks.

## 30–31 October: approved shift correction and follow-up requests

**Baseline:** 750a8c97 on codex/add-missed-bill, draft beta PR342. At batch start,
only prior tracker evidence was tracked-dirty. Unrelated untracked drafts, the
zero-byte booking migration and private signing credentials remain preserved.

### SHIFT-14: reliable closure acknowledgement

Owner explicitly approved correction code and isolated tests. The actual worker
and PostgreSQL reproduction showed local CLOSED/cloud OPEN at equal revision
could apply zero rows while returning success and clearing the pending journal.
That proves a defect, but the affected PC's original revision/outbox is unknown.
Both incident shifts had already closed through online-client requests; agents
never repaired them or submitted closing counts.

Implemented and pushed in 3ede8f7e: atomic semantic closure postconditions, exact
same-branch proof before journal/checkpoint acknowledgement, equivalent replay,
conflict retention, accurate reported/confirmed activity wording and active-shift
cache reconciliation. Empty/error/stale reads do not fabricate closure. Existing
checkout, grants, stock and other-table acknowledgement contracts are preserved.

Owner then separately approved the exact live migration on ROSEGILL →
rosegill0011@gmail.com's Org (bjxgimekljzlnwejuawj) → pos
(qhrufhtbeguxydenzfey), https://qhrufhtbeguxydenzfey.supabase.co.
Source migration20261030153259 was applied as live history20261030155938 at
23:59:38 Brunei, 30 October. All three prior routine hashes matched the reviewed
baseline; definitions were retained in ignored node_modules/.cache for rollback.
Readback confirms three guarded routines and three service-only SECURITY INVOKER
helpers. Both incident rows retained revision4/CLOSED/existing timestamps. A
read-only call returned both same-branch closure proofs. No live financial test.
See database/shift-closure-sync-review.md. Device reconnect acceptance is separate.

### HISTORY-16 / SHIFT-15

Owner requested Previous day / Today / Next day beside receipt/shift From–To
ranges, preserving store timezone and explicit ranges, and removal of the Shifts
Sign-in history button. Implemented in ff94abb8; shift history and authentication
audit storage remain. Real signed-in browser Receipt History test moved both dates
31→30→31 October. No transaction submitted. Shift/mobile interactions remain.

### INV-18 / INV-19 / UI-20

Owner requested one compact Low/Negative stock card with clickable numeric counts.
Low opens the matching selected-branch list. Negative opens read-only review and
then the existing stock-count workflow. Physical counts start blank, explicit0 is
allowed after counting, and existing permission/reason/audit/idempotent Post is
required. No automatic zero-all action, product deletion or live stock test.

Current and Other stores numeric filters match their displayed stock quantities,
not source count/name/barcode; Other stores remains positive, authorized,
same-cluster availability with the existing three-decimal display. Owner explicitly
chose numeric CURRENT-BRANCH Stock searches across BOTH Active and Archive.
Other intentional filters and cluster/branch scope remain; mode/scope is explained,
and clearing restores the previous view. Main search remains broad. Added space
between valuation cards and the catalogue. Commit2ce39509 includes these changes
and review-link recovery tests (denied/wrong branch/empty → corrected state opens
once). No stock/status/SKU/price/checkout changes.

### LOC-21

Owner asked what Private shop/catalogue/stock actually means and requested accurate
copy. There is no separate Private shop flag. Same-cluster products are shared;
quantities belong to locations, normal operations remain branch-locked, permitted
same-cluster availability and authorized management views remain. privateStock is
a saved preference with no separate runtime consumer; do not claim the switch
adds privacy. Text-only8e465dc9 explains that gap. The owner immediately reversed
removing All Shops/Live Dashboard buttons: KEEP both. No policy/default changes.

### NOTIF-22: live audit and additional correction approval pending

Read-only ROSEGILL pos metadata confirms the core24October rule-table migration,
RLS, triggers and service-only save/claim/recipient helpers are deployed. At that
checkpoint no rules array/rulesVersion was saved, legacy enabled=false and the
delivery table was empty. Preserve operator values; no live rule creation,
activation, test messages or delivery certification was performed. The optional
clear-RPC alias is absent but has a valid protected fallback; do not add it solely
because an optional fast path is missing.

Two25October upgrades are absent: personal clear union and owner-plus-admin
soft-token notification rule. Isolated tests found a confirmed blocker in the
personal upgrade: a Branch A upload can reuse a Branch B event ID, relabel the
incoming store A, and mutate B's cleared_by. Do NOT apply that migration unchanged.
New scripts/test-notification-upgrades.mjs currently reports14 passes/1 failure;
existing notification tests43 passed. Soft-token owner/admin scenarios pass, but
that upgrade still requires exact live-project approval and current-state review.
See database/notification-upgrades-review.md.

A separate additive ownership-check/union correction and isolated tests were
proposed. Preparation approval is PENDING; no old migration was rewritten and no
live notification upgrade applied. Preserve immutable content, personal clears,
legitimate retries and branch denial; no silent skip/false acknowledgement.

### REFRESH-17 / PERF-18 / PERF-24

Owner requested required-only updates/cache reuse rather than whole-page/database
reload on clicks and row changes, and correction of partial initial data.
Ordinary background refresh preserves the shell and loaded slices; no ordinary
row-change document reload was found. Report changes still reconcile the selected
authorized date range because hints omit sale IDs. A bounded authorized sale-graph
by-ID reader plus reliable parent hints is a separate future optimization; do not
skip reconciliation and lose older refunds/missed bills. Exact intermittent
production CPU-freeze cause remains unproven.

Confirmed first-render bug: useReportSales exposed recent seed rows as complete
before its effect started. Scope-keyed read/error status now marks uncached totals
incomplete, retains confirmed/fresh/empty cached ranges and background rows,
without query/formula changes. Restored deep links also incorrectly defaulted to
Home when a per-tab sign-in marker was absent; observed real PIN/password sign-in
still gets its default landing. These changes and the scoped-settings follow-up
are committed/pushed in8b840192;39 early focused checks were followed by the
broader96-case run and independent review below.

Confirmed initial-settings gap: primary readiness can precede scoped overrides and
locks. A current-user/mode/branch/cluster/terminal readiness/error/scope-only retry
correction passed independent review. Actual installed IPC tests confirm cashier
read access without settings-edit permission. Review caught and corrected timeout
overlap, same-user session-generation reuse and lost queued hints on Retry. Raw
composite singleflight, safe late results and exactly one real trailing read pass;
11 suites/96 checks passed, including the independently repeated critical75.
No grant, SQL or Membership change was made by this read-status correction.

The browser connection gate also replaces loaded content with a fullscreen view
after repeated failures. A retained-content attempt is UNCOMMITTED. Actual
390/1440px Chrome fixtures proved body-mounted Radix portals escape hidden/inert:
PointerUp changes a Select; dialogs remain visible after configuration/scope
failure; modal locks block Retry. Zero external requests were made. Evidence is
under ignored node_modules/.cache/offline-gate-portals. Do not release that partial
change. A roughly14-file optional gated portal-container correction (10 shared
wrappers plus context/gate/browser tests) needs PENDING owner approval. Preserve
unsaved forms, retry focus, outside-context behavior and native offline access.

### REL-23: beta delivery and remaining gates

Owner requests all current fixes verified, committed and merged incrementally into
beta, then beta release. Do not replace the repository, reset unrelated work,
force push, bypass checks or promote main. Refreshed origin/beta remains bce925a2
and is an ancestor; no divergence/conflict at that checkpoint.

Six completed commits are pushed through ec4e3e7e to draft PR342. The latest
exact-HEAD CI41094719520 passed577 suites/3,717 tests,1 skipped; permission/account
lifecycle, sync/startup/local upgrade,24 isolated shift SQL cases with all actual
triggers, SQL contracts, updater, lint/typecheck/build and dependency audit passed.
Android and Windows renderer41094719408 and unsigned iPhone compile41094719421
passed. GitHub reports CLEAN/no merge conflict, but the PR remains draft because
v2 live application and other correction approvals are pending. Classic branch
protection returns404; repository rulesets were not verified. These are CI checks,
not themselves a Codex Security scan. The separate immutable security diff scan
completed for bce925a2..ec4e3e7e (be78d091-88ee-4677-956a-330f0ff27f61): all 161
inventory files reviewed, one LOW finding. Uncommitted portal and notification
experiments are excluded. No merge or installer/OTA publication.

Local preview http://127.0.0.1:8080 remains running with current source and Vite
client HTTP200. Separate verification tab avoids the owner's unsaved receipt
settings. Cua does not expose performance globals; no invented navigation-counter
or CPU-freeze proof. Next beta version calculation currently returns1.4.81-beta.1;
refresh release tags/checks at publication. AGENTS.md requires exact owner request
“Publish beta now” at the concrete publication step. No publication tag/dispatch
before that instruction. Membership stays ON HOLD; all older unfinished work and
prepared-only migrations remain in this ledger.
### SHIFT-14 follow-up: revision trigger blocker; do not merge v1

Further actual-trigger review found a HIGH regression in the v1 guard: local and
cloud revisions are independent. The enabled cloud shifts_bump_row_version
trigger sets OLD+1, so valid local CLOSEDv8 over cloud OPENv4 stores cloudv5;
the v1 >=incoming assertion then rejects/rolls back that valid upload. The first
20-case fixture omitted the actual shift triggers. CI at3ede8f7e therefore is not
proof of this interaction; PR342 remains draft with a do-not-merge explanation.
No sales/stock/count data was rewritten, but v1 can hold valid closures pending.

Prepare corrective additive migration20261030164829 (never rewrite appliedv1 or
the global revision trigger). Version2 checks the same exact closing facts,
returns the actual positive cloud revision plus requested_row_version echo,
and binds native acknowledgement to that requested revision rather than comparing
different revision clocks. Tests must install all seven actual canonical shift
triggers and cover sparse sync, receipt replay and conflicts. Source correction
is within approved closure-correction intent; LIVE application still needs exact
project/migration approval after tests. Root native version2 checks passed25cases.

A separate stale OPEN/high-revision reopening of an already CLOSED shift reproduces
on BOTH baseline and new guard; no legitimate reopen flow identified yet. Keep
this pre-existing issue distinct and investigate/seek a bounded correction rather
than silently changing lifecycle rules or modifying live shifts.

### Completed security diff review / AUTH-12 — 31 October

Scan be78d091-88ee-4677-956a-330f0ff27f61 completed for exact immutable
bce925a2..ec4e3e7e. All161 authoritative source/test/CI inventory files were
reviewed in four disjoint partitions: authentication47, finance/sync39,
loading38, inventory/history/UI37. Five changed documentation files were context.
One validated LOW finding (CWE-204), no high/critical new diff finding. This is a
completed diff review, not a repository-wide/deep scan or installed-device proof.
Canonical report is stored in the Codex Security workbench, finding
csf_005b69baa9b5fd14bafe9d44 / occurrence occ_95d9ce1532b10354c1c99dc9.

AUTH-12: arbitrary syntactically valid PIN plus a guessed inactive/unconfigured
identifier yields account_inactive/credential_unavailable before credential
verification, while unknown identifiers yield invalid_credentials. New private
SQL statuses are forwarded at cashier-login.server.ts81–84, then returned by
public cashier-login.ts95. Baseline normalized these cases; the registered
terminal roster does not intentionally disclose them anonymously. No session,
name, secret or permission grant is returned; guessing throttles remain.
Actual isolated verifier tests11passed; public response propagation was traced,
not attacked on live accounts. Parent follow-up also found the unchanged
ipc-authorize transport returns the same shared-helper refusal envelope, so a
correction must cover both public responses. This adds no separate root cause.

Proposed bounded batch: a shared public-result projection plus the two exposed
route consumers and focused tests. Keep detailed verifier outcomes inside the
trusted server so only genuine invalid PINs consume the existing wrong-attempt
budgets. Do not accidentally label unavailable verification as a wrong PIN or
enable fallback for a revoked/inactive identity. Preserve successful login,
device/branch checks, checkout grants and SQL credential sources. Verify allowed,
denied, unavailable, locked, native/offline and both HTTP transport cases. No DB
or permission change is proposed. Baseline ec4e3e7e is recoverable; rollback is a
revert of that future bounded batch. Approval pending; no AUTH-12 code fix yet.

The report retains separate live-v2, portal, notification, stale-OPEN and management
replication-scope limitations. No new live write, restart or publication occurred.
Security tool reports32,366,649 aggregate chat tokens across four threads,
including31,446,144 cached-input tokens; this is thread-rollout accounting rather
than an isolated incremental scan-cost measurement. Existing pending tasks remain.

### AUTH-12 implementation authorization — 31 October

The owner selected the P3 public PIN account-state finding and instructed “Check
and fix.” This approves its bounded correction and tests; it does not approve
other pending UI/notification batches, the v2 live migration, merge or publication.
Recoverable baseline:51f5d7c8 on codex/add-missed-bill, existing draft beta PR342.
Preserve unrelated dirty OfflineGate/__root files and all scratch work.

Root and a fresh read-only investigator traced private verifier results through
both public cashier-login (including its alias) and ipc-authorize. A shared public
response projection must run after private accounting. Never convert unavailable
credentials into invalid_credentials before server or keypad wrong-PIN counting.
Tests must compare exact response bodies/statuses, preserve true private counters,
unavailable/timeout fallback, actual locked denial, successful session/authority
and branch checks. Repeated requests and aliases are alternate disclosure cases
to challenge before finalizing. No new SQL, account, grant or checkout changes.

Files in scope: a shared server response helper, the two route consumers and
focused transport/consumer regressions; direct callers are reviewed for API
compatibility. Keep private RPC/result diagnostics available to trusted server
code. Apply no live database operations. Run type/lint, original-trigger and
legitimate-control tests, nearest login/offline regressions and one fresh
read-only bypass/regression review. Rollback is a revert of this correction's
future commit; retain all other pending work.

### AUTH-12 correction and verification checkpoint

The shared publicCashierLoginResponse serializer now runs after private accounting
for public cashier-login, its alias and ipc-authorize. Unknown/wrong, inactive,
missing/unsupported verifier, locked and private SQL validation results share one
neutral401 envelope. No private diagnostic/attempt fields are copied. The early
public username lock uses the same boundary. Whitespace-only usernames are
rejected before lock checks, retaining the existing raw length limit.

Online presentation deliberately no longer reveals the wrong-PIN distinction or
private lock countdown. SQL/account/address counters and actual lock denial are
unchanged; unavailable credentials do not become false wrong-PIN attempts.
Neutral refusal cannot use local fallback or increment keypad failures. Real
connection/session failures still keep their existing status/fallback semantics;
independent offline/local PIN messages and attempts are unchanged. Successful
sessions, native branch binding, cashier checkout grants and IPC maintenance
permission remain protected by the existing code.

The fresh review identified an address-budget oracle via validation results.
Root reproduced five failing isolated transport cases and added neutral private
invalid_input handling plus early blank-username validation. Two astral Unicode
characters pass IPC's JS length4 check but PostgreSQL counts2; public Zod already
rejects them, so the claimed Unicode public-route bypass was not reproduced.
Stateful tests now prime19 distinct guesses, submit the target, and compare both
probe classes after private counters diverge, through all three entry paths.
They pass without flattening or resetting the actual private counters.

Verification: original pre-patch transport trigger19failed/10legitimate controls
passed; final13focused suites/152tests passed, including43privacy cases. Existing
PGlite verifier tests now12passed, including actual Unicode character validation,
alias locks, missing/unsupported hashes, private grants and successful login.
TypeScript and scoped ESLint passed; final diff inspected. One sandbox temporary
SSR-cache ENOENT was resolved using the repository-local Vitest module-cache path;
no assertion was bypassed. No real PIN, account, SQL schema/data, permission,
Membership or checkout code was modified. This does not claim constant-time
authentication or installed-device acceptance. Final clean-clone CI follows the
bounded commit/push; original sealed security scan remains immutable evidence for
its earlier revision, not an updated scan or a closed workbench finding.

AUTH-12 final input-boundary follow-up: both early core validation returns now
carry private invalid_input rather than uncoded errors. Stateful long-Unicode
tests reproduced two additional leaks: public Zod accepts20Unicode characters,
but core's existing32UTF-16-unit ceiling refuses them after the address check.
Typing that existing refusal routes it through the same serializer without
changing accepted PINs or counting it as wrong. The IPC route already rejects
that long representation before throttling. Final13focused suites/157tests pass,
including48privacy cases; final typecheck/lint/diff checks pass. Earlier152/43
figures above describe the preceding checkpoint. No new reviewer cycle or live
credential request was used; root challenged the upper as well as lower Unicode
boundary after the fresh review and verified the confirmed correction.

### TERM-13 — saved native configuration and setup navigation

31October resumed owner approvals (received together while TERM-13 is active):
the shared-popup reconnect correction and isolated browser tests are approved;
the corrected additive notification acknowledgement migration and isolated tests
are approved for preparation ONLY, not live application; corrective shift-proof
migration20261030164829 is explicitly approved for ROSEGILL→
rosegill0011@gmail.com's Org(bjxgimekljzlnwejuawj)→pos(qhrufhtbeguxydenzfey),
https://qhrufhtbeguxydenzfey.supabase.co. The owner also reconfirmed PIN-response
correction approval (already implemented atafcf92d1, exact-head CI passed).
Preserve all existing pending tasks, Membership ON HOLD, checkout and grants.
TERM-13 remains active; independent agents will prepare the popup and notification
slices without overlapping ownership. Live shift-proof application requires
the approved exact file, live definition/history preflight and postverification;
record application separately from source/tests. No installer or production
promotion approval is inferred from these replies.

The owner reports that Android shows a terminal-setup button despite a saved
registration and tapping it does not open setup. They request agents check and
fix this across applicable platforms, and specifically suspect saved configuration
restoration. Investigate Android/iOS secure storage and Electron vault hydration,
including slow/failed reads and existing Operations/Management registrations.
Do not assume that a rejected staff-list request proves registration is missing.

Root and an independent agent confirmed CashierPinLogin routes setup to the
signed-in Windows /settings/terminals administration page and connection repair
to signed-in /settings/database. That can return a signed-out native user to the
same login gate. Existing /recovery is outside startup/auth navigation gates and
retains EmergencyPinGate. Its activation card does not currently support an
explicit selection and captures initial defaultOpen before async status settles.

Planned navigation boundary: use the existing protected native recovery screen
for these actions, selecting the relevant activation/connection card. Preserve
web's lack of native registration and all existing recovery/permission checks.
Saved read failures must remain unknown/retryable rather than clearing credentials
or inventing an unregistered device. Separate agents investigate restoration and
platform parity; root owns recovery navigation/UI. Confirm exact storage defects
before edits. No re-registration, branch reassignment, secret/config resets, live
database changes, checkout edits or Membership work is authorized by this task.
Baseline afcf92d1 remains recoverable; unrelated OfflineGate/__root drafts remain
excluded. Record source tests versus actual physical-device verification clearly.

TERM-13 investigation confirmed two additional causes. The staff-list endpoint
conflates verified-terminal roster SQL failures with invalid registration; split
those phases so transient roster failures are503, preserving real proof denials
and trusted-branch scope. An independent mocked Electron reproduction found an
existing unreadable DPAPI activation returnsnull and IPC reports ok:true. A narrow
strict read/IPC error contract must preserve stored bytes and ordinary Main caller
compatibility. One agent owns terminal-staff endpoint/tests, another owns native
activation store/IPC/tests; root owns recovery navigation and state UI. Normal
Android/iOS startup storage tests6suites/41passed; no demonstrated destructive
phone storage loss, so do not rewrite saved configuration speculatively.

The optional remote-hosted Android artifact can load a web build that excludes
native setup UI; actual affected phone build mode is not yet known. Keep this
separate from confirmed default bundled-mode bugs and do not silently retire that
build option or widen web registration. No production database/device mutation.

TERM-13 implementation checkpoint31October: login repair actions now use client
links to the existing gated /recovery with allowlisted section hints. Requested
cards open even when missing-status arrives asynchronously. Recovery waits for
the shared local profile restore; unreadable settings remain retryable, never
missing, and edits stay unmounted until reads succeed. Configuration events
refresh local status with queued, generation-fenced reads; no business bootstrap
or automatic polling is added. Saved registration is read-only before activation
options, Management is distinguished from branch-bound Operations, and origins
are sanitized by the existing details component.

Electron strict IPC reports EACTIVATION_STORE on unreadable sealed/legacy data,
while background readers remain nonthrowing. Existing sealed data never falls
through to editable plaintext; every write/clear validates existing data before
touching seal/binding/provision bytes. A reviewer found a legacy-only replacement
gap; three prepatch failures reproduced it, the bounded correction passed and
independent recheck confirmed byte preservation. Valid migration/new setup still
pass. Verified-terminal roster outages now return generic503; real401/403 proof
denials, fixed Operations branch and existing Management semantics are retained.

Executed evidence: root combined14suites/154tests passed (branch isolation,
activation/IPC/profile, terminal roster, online PIN errors, checkout/receipt
safety); two recovery state/route suites20tests passed, including Android/iOS/
Electron protected-gate checks, ordinary-web redirect, no secret rendering,
async Card state, retry and stale first-cloud-read/config-change regression.
Agent's broader store/profile/native suite98tests and independent API/proof/
relay review41tests passed; these overlap and must not be summed. Source/types/
lint evidence is not an installed phone/Windows run. Browser surfaces were
unavailable during this checkpoint; no physical activation, re-pairing, sale,
stock or account write was performed. A beta PR source commit/checkpoint follows;
no installer/OTA publication is authorized by this task.

TERM-13 owner clarification: the affected phone runs the last published beta;
the exact build cannot be read from its current login screen. Selecting/using
Administrator sign-in reportedly returns to cashier/PIN sign-in with Open
terminal setup. Root is tracing this distinct login-method transition; do not
claim the repaired recovery link alone proves it resolved. Current source has
an automatic native tab-default effect and an explicit plain-username/no-password
PIN redirect. Asked which trigger the owner observes (selection, password
submission or blank-password submission) before changing intended login rules.
The phone's actual installed artifact/build mode remains unverified.

Owner clarified the redirect occurs AFTER entering BOTH administrator username
and password and pressing Sign in, while terminal management shows it online.
The blank-password PIN shortcut is not the reported trigger and must remain
unchanged. Independent in-memory actual AppShellFrame/startupDecision/TerminalLogin
reproduction confirms a connection verdict can replace the Admin form with
OfflineStatus; recovery remounts it on cashier and loses its failure message.
This is a confirmed possible source path, not proof of that phone's exact trace.
Normal password rejection itself does not select PIN. Approved TERM-13 follow-up
will preserve ONLY ephemeral method/error/failure/busy/request ownership in
AppShellFrame across its existing gate returns; no credentials or auth state,
no bypass, no login form outside gates. Shared request identity must suppress
duplicate in-flight requests across remounts and stale completions after reset.
Clear UI state after successful identity adoption/logout; keep web Admin and
native PIN defaults and intentional blank-password behavior. Agent owns this
narrow TerminalLogin/AppShell/controller/tests slice; root records/reviews it.

Read-only release comparison: last published beta is1.4.81-beta.1,26October.
Its tag is an ancestor of the current source (no older checkout copied over).
That tag's staff-list request sends terminalToken but omits deviceBindingProof;
current source readNativeTerminalProof sends the already-saved valid proof (or
existing device hash fallback). An online heartbeat is not proof that every
legacy request includes required identity. Do not weaken proof verification,
wipe registration or require reactivation simply to hide this compatibility gap.

NOTIF-22 approved preparation completed31October: CLI-generated additive file
20261030234813_guard_activity_acknowledgement_branch_ownership.sql replaces only
service-only sync_apply_activity_events. The first generated234442 filename
collided with the just-applied live shift-proof history timestamp; it was
regenerated through the CLI before staging, not applied or silently renumbered.
The existing immutable event's actual conflict-time ownership must match the
verified native branch (existing unowned/global behavior retained). Otherwise
raise and roll back the whole batch/receipt; preserve monotonic personal clear
union, content, grants and legitimate retry. Generator and both canonical
activity-only copies match the exact correction; the new isolated CI step runs
without a live database. Old applied migrations are not edited.

Before correction, expanded baseline reproduced5failures with18controls passed.
After correction23PGlite/actual-generator scenarios pass;6 genuine two-session
PostgreSQL17.11 races confirm real lock waits, commit/rollback, union and replay.
Independent reviewer repeated all23+6 plus44 relevant Vitest tests and found no
actionable regression. The disposable race harness accepts binaries only, not
external database profiles, and stopped/removed its own loopback fixtures.
No notifications, rule selections, recipients or live data were changed. This
is source preparation; exact-project application approval/readback is still
required before applying this notification upgrade. See
database/notification-upgrades-review.md for full evidence and rollback limits.

NOTIF-22 exact8fa492ac CI caught two stale static-test expectations: canonical
SQL's explicit migration allowlist lacked the new file, and the notification
state test expected union SQL inline in the generator rather than its new exact
shared migration source. Root updates those two assertions to retain explicit
inventory plus shared union/context/ownership/rollback checks. No runtime SQL
or permission logic change is required. The local untracked zero-byte booking
placeholder remains excluded from commits; it must not be deleted or silently
allowed merely to make the local inventory test pass. Clean-CI verification is
required after this bounded test correction.

SHIFT-14 version2 live application completed after the resumed exact approval:
unchanged reviewed SQL applied once, history20261030234442; original helper/ACL
saved locally before application. Post-readback service-only/invoker privileges
unchanged; empty proofv2 and two existing closed-row cloud4/requested9 validation
proofs passed. No business rows rewritten. See shift-closure-sync-review.md for
exact target, evidence, rollback boundary and remaining installed-device limits.

TERM-13 Admin follow-up implemented/scoped verified31October: AppShellFrame now
owns an instance-local presentation controller (method/error/failure/busy plus
active request symbol). Existing startup/registration/authorization gates remain
first; no identifier, PIN, password or authenticated account enters this state.
Explicit password submit retains Admin even before platform detection. Pending
requests block method changes and duplicate submissions across recovery remount;
identity adoption/logout invalidates earlier catch/finally results. Preserve the
existing native password-manager offer only after verified success. Blank native
username/no-password PIN shortcut remains; browsers remain password-only.
Native Admin configuration errors on Android/iOS/Electron now link directly to
protected connection recovery; the prior Electron signed-in Settings dead end
is removed. Authentication/session/permission functions are unchanged.

Root independent10suite/140test regression and scoped lint/diff checks passed.
Implementer8focused suites54tests, full TypeScript, syntax and lint passed.
scripts/test-terminal-login-view.cjs ran10 real Chrome DOM scenarios at390/1440
for Android/iOS/Electron and web, with zero external requests and page/console
errors. It uses actual login components plus synthetic Auth/roster and a gate
unmount wrapper; actual AppShell decisions are exercised separately in unit
tests. Root visually checked the390Android error view: Admin retained, failure
wrapped/readable, credentials blank after remount and direct repair link visible.
This does not verify real Supabase Auth or the installed phone. Revert the
bounded UI commit to roll back; never clear device registration/credentials or
change account grants as recovery.

REFRESH-17/PERF-18 further fixture investigation confirms a PREEXISTING normal
online nested-dialog freeze, independently reproduced outside OfflineGate:
separate copies of Radix focus/pointer-lock contexts prevent coordination,
leaving body pointer events locked after Escape. Fixture-only aliases to one
already-installed module copy fix the reproduction without package changes.
Owner approval is requested for the additional shared build-config/helper/test
batch (AGENTS scope-expansion rule); no actual Vite change is made yet. Keep
this distinct from the authorized portal-ownership/iOS cleanup correction and
do not declare its full nested suite green or release unstable popup code.

Owner separately approved the shared dialog-module build correction31October:
make builds use one existing installed copy of the two focus/pointer-lock
modules, with a shared helper, Vite configuration and regression tests. No
package upgrade, dependency-version change, authorization or database edits.
Implement only the verified module-identity correction, retain all original
exports/consumers, and independently test full nested behavior across build
targets. This supersedes the preceding pending-build-approval state; isolated
fixture aliases alone are not deployment. Agent owns the narrow helper/Vite/
test integration plus approved popup slice; root owns reconciliation/commits.

Owner's31October delivery instruction: after fixes, create a NEW reviewed PR,
merge without replacing prior code or damaging unrelated features, and commit
to beta. This explicitly authorizes the completed scoped beta merge, not main
promotion or installer/OTA publication. Keep source/test/migration/publication
states distinct. After agents finish, verify the latest beta baseline and final
diff; use an isolated integration worktree if needed so local live preview is
not interrupted. Carry forward the already reviewed/approved PR342 changes
without resets or branch-wide copies; new PR must clearly identify supersession
and scope. Run exact-head CI/checkouts/permissions before a standard merge
commit, enforce the reviewed head, and preserve signing/operator files.

Owner clarified the delivery instruction: a particular merge method is not
mandatory. The requirement is targeted, reviewed changes to the existing beta
code, preserving unrelated features and history; do not replace the repository
or stage every local file. Continue the approved fixes and regression checks,
then create the new beta PR. The popup restoration candidate remains uncommitted
until its nested-dialog dismissal regression passes independent verification.

Clean integration checkpoint: codex/terminal-recovery-beta at86056b72, based on
unchanged origin/beta bce925a2, passed the full582file/3832test Vitest suite,
merge readiness and70table SQL Server/sync contracts. Independent18suite/
127test review covers online/local checkout, receipt/print, native branch and
activation boundaries, offline PIN and login-view guards. These are committed
baseline results, not certification of the still-uncommitted popup candidate
or physical installed devices. The preview was restarted from the latest source
worktree on8080 and /@vite/client returned200. Unrelated drafts remain excluded.

SHIFT-15 new owner report31October: a cashier opens a shift on a recent
production installation but it does not update centrally (installed beta/other
version still uncertain). Start read-only cloud/source/release investigation;
do not assume the closure-proof correction fixes OPEN uploads. Need the affected
branch, opening time, installed version and pending/failed sync diagnostic to
identify the exact local record. Preserve existing shifts, counts, transactions,
terminal ownership and permissions; no live record repair authorized. An agent
traces production opening/upload behavior while root checks cloud facts.

SHIFT-15 confirmed live regression: ROSEGILL pos ACTIVE_HEALTHY;31October
00:00–11:18Brunei logs show245 aggregate400responses. PostgreSQL context names
pos_sync_assert_shift_ownership→sync_apply_shifts→five-argument aggregate.
The deployed aggregate/batch establish pos.sync_terminal but NOT pos.sync_branch;
the newly applied closure guard requires that missing branch context even for
OPEN rows. Source/canonical test fixtures already establish both and missed
this deployed-definition compatibility case. Production PC heartbeat reports
1.4.79, current STR1 cloud opening latest30October15:04Brunei, no31October row.
These facts identify a genuine upload blocker, separate from cashier grants.
Read-only live definitions saved under ignored cache for isolated reproduction.
Prepare a narrowly scoped correction proposal; do not remove ownership checks,
relabel pending rows, bypass permissions or apply any live repair without exact
approval. Both source and deployed-definition tests are required before release.

Owner approved SHIFT-15 preparation and isolated tests only. Prepare a CLI-named
additive migration targeting the verified-terminal aggregate/batch overloads,
establishing transaction-local pos.sync_branch only after existing scope
validation. Preserve all deployed amendments, ACLs and legacy overloads; abort
on unexpected definitions. Add deployed-preimage/OPEN/CLOSED/replay/rollback and
foreign-branch denial tests. No live application or record edits are approved.

REFRESH-17/PERF-18 popup correction implemented and independently verified:
gate-owned portals remain inside the inert boundary and park during outages;
Activity preserves drafts while releasing focus/pointer/scroll effects. Nested
cleanup finishes before ordered restore/settle commits, with dismissal paused
until listeners are ready. Existing normal online freezes also required one
Dialog-compatible installed copy of each Radix focus/dismissable runtime in all
four build targets; no dependency upgrade. Only owned popup surfaces settle
retained entrance geometry; ordinary closes/new opens and child indicators keep
their animation. Native offline access and outside-gate controls are preserved.

Final frozen source: official and independent46scenario Chrome runs pass with
zero external requests/errors; independent16deep nested two-outage/fast-flap
cases retain child→middle→outer Escape order. Three unit suites46tests, types,
scoped lint/syntax/diff checks pass. The no-motion-CSS A/B independently retained
correct layer order but produced357 raw ResizeObserver errors, demonstrating
the separate geometry requirement; that failing diagnostic is not a pass claim.
Fixture covers390/1440 layouts, all10wrappers, same-scope draft/DOM retention,
Retry, revoked/switching scope, native bypass, cold start, paused unmount and
simulated iPhone drawer cleanup. Physical devices/live checkout remain untested
by this fixture. Root reviewed final scoped diff; commit only approved files.

SHIFT-15 final prepared migration20261031031945 passed38 permanent actual-trigger
SQL scenarios,12 captured-live-definition scenarios and58 checkout/branch/closure
tests. Root and independent reviewer repeated the38+12; SHA25619B0B0B1…61AE034F.
The owner separately approved applying this exact correction to ROSEGILL→
rosegill0011@gmail.com's Org(bjxgimekljzlnwejuawj)→pos(qhrufhtbeguxydenzfey).
Preflight confirms ACTIVE_HEALTHY, both target routines service-role/postgres-only,
missing branch context and no prior migration. Their full prior definitions and
metadata are saved locally in ignored cache before application. Apply once,
verify exact definition/ACL delta and central upload recovery; do not fabricate
or replay a real shift from this session or alter cashier grants.

SHIFT-15 applied once31October11:25:45Brunei; live history20261031032545.
Readback proves exact insertion in both routines and unchanged ACL/owner/security/
search-path metadata; proofv2 remains. Owner now confirms the opening visible.
Central readback11:28 confirms original STR1 shift1a349429…ad27 opened10:22:18,
OPEN/ACTIVE revision1; successful upload receipt11:27:01. No agent business-row
write/replacement shift or grant change. This specific production upload defect
is verified recovered; other queued tables and actual checkout/closure acceptance
are separate. Details/recovery: database/shift-closure-sync-review.md.
Popup source committed0d0bcd66; include this separate correction in the new beta
PR and require exact-head checks. Preserve unrelated drafts and all branch guards.

Owner's permanent PR rule31October: creating/updating/merging a PR must preserve
existing functionality in beta AND production. Commit only approved feature/fix
diffs and necessary reviewed dependencies; never replace the repository or include
unrelated local changes. Review the latest destination diff and relevant dependent
workflow tests before merge, retain rollback history, and report unverified behavior.
Record this in AGENTS.md/PROJECT_MEMORY.md; a specific merge method is not the
safety guarantee. Existing separate exact production-promotion approval remains.

Delivery checkpoint: new beta PR348 created from clean integration branch
codex/terminal-recovery-beta atdaa304f0, carrying38 approved scoped commits from
unchanged beta bce925a2; final clean585file/3878test suite passed. Exact-head
platform/security checks run before merge. No main promotion/installers/OTA.
Owner requested local Electron as well: separate DESKTOP_BUILD/beta Vite server
8081 and actual Electron from the latest source launched; process928 has visible
Register — Retail window and8081/@vite/client responds200. Browser8080 remains
live. Saved native/operator configuration was not changed by the agent. Renderer
UI uses Vite HMR; native Main-code changes require a normal restart, not a claim
of instant backend hot replacement. Local SQL readiness was not certified by
the window-title/process check.

TRF-15 approved separate correction/test batch31October. Owner reported approved
stock request ST-STR1-WEB01-20261031-0001 fails dispatch. ROSEGILL pos readback
shows child transfer approved, no dispatched quantity/time, requested1 pair,
source STR1 stock0 and no child warehouses. Logs23514 report Short by1; the
current incident rolled back correctly. Never invent stock or bypass shortage.

Source trace additionally confirms post-commit linked-request closure can fail
after dispatch; native approval has a verified-staff adapter but dispatch lacks
one; browser transport discards structured SQL error codes. Owner approved fixing
these paths with isolated tests, preserving stock/approval/permission/branch
rules. Any live migration needs separate exact-project approval; no real transfer,
approval, stock, grants or settings writes during tests. Baseline33f1996e, branch
codex/transfer-dispatch-recovery-beta, separate from approved SQL-07 loading fix.
Implement atomic dispatch/request completion with validated linked ownership and
existing fulfilment semantics; do not silently change partial-request rules.
Use agents with distinct server/SQL and client/error ownership plus independent
review. Record and escalate business-rule ambiguities; Membership remains ON HOLD.

TRF-15 preparation checkpoint31October: final migration SHA256
972A62DF76BEE85B93CBC7CB0C7C3985EC8C7109D6456AFBC1B36384B35579D2.
Root and independent review repeat44 canonical-trigger and44 captured-live
25-trigger PostgreSQL scenarios plus8 real independent-session races. New private
append-only dispatch intent prevents fabricated replay after mutable document
facts change; strict new-RPC item/ceiling preflight runs before stock mutation.
Legacy void clamp/default semantics and original ACL remain; new internals are
owner-only, public atomic RPC authenticated-only, verified-native adapter service-only.
Collision/default/owner/PK rollback and repeated-application tests pass.

Actual SQL output passes the real client proof parser for web/native/replay and
uppercase UUIDs; stale ceilings fail before any stock movement. Client suites,
types and scoped lint pass. The final native response sanitizer/status correction
also passed independent review; only bounded diagnostic code/status stay private,
definite denials do not retry and ambiguous gateway errors retain one exact retry.
Combined full regression checks and a scoped beta PR against the latest beta are
the remaining source-delivery steps. Applying the new receipt table/routines requires
separate exact ROSEGILL-project approval; deploy DB before new client. No live
dispatch/stock write, notification-channel change, installer/OTA publication or
main promotion. Full scope, limits and recovery:
[transfer dispatch review](database/transfer-dispatch-recovery-review.md).
PR348 merged to beta as33f1996e649e9b601d0f7d8f5a8485554b877cdc after
root/independent verification of exact a4b5abd4 checks: security/regressions,
Android, Windows, iOS, Cloudflare beta and labels passed. CodeRabbit skipped;
not counted as a completed review. Post-merge tree exactly equals reviewed head;
base remained bce925a2. PR342 closed as superseded, branches/history preserved.
No main promotion or installer/OTA publication. Local8080/8081 respond200;
Electron relaunched with saved profile, visible Register — Retail PID27240.

SQL-07 new separate finding: local SQL reaches Ready but business:snapshot fails
with Latin1_General_BIN2 versus SQL_Latin1_General_CP1_CI_AS comparison error.
Logs show the same issue30October before the latest popup/login corrections.
Read-only agent trace strongly matches catalogue-scope.cjs same() comparisons of
OPENJSON binary keys with normal store ID text (predicate from27October1af373f5).
Exact first failing comparison/column collations still need isolated verification.
Propose only explicit compatible comparison collation in the existing helper,
with actual mixed-collation SQL Server snapshot/catalogue/branch-denial/checkout
regressions. Do not alter global/database/column collation, operator settings,
product data, stock or permissions. Not bundled into PR348 or declared fixed.

31October owner approved the separate SQL-07 correction and isolated tests.
Baseline33f1996e, new branch codex/sql-loading-collation-beta in its own clean
worktree; preserve the running previews, native profile and unrelated drafts.
One agent owns the existing catalogue comparison helper and focused regressions;
another independently reviews semantics/branch-denials. Root owns approval/task
records, actual SQL Server isolated reproduction and final integration review.
Acceptance: generated reads load under mixed JSON/database collations; existing
same-cluster, foreign-cluster, transfer and terminal/user restrictions remain;
checkout stock checks and ordinary reports retain behavior. No live schema,
data, global/column/database collation, settings or permission change. Membership
remains ON HOLD. Commit/create a separate beta PR after checks; no publication or
production promotion is authorized by this approval.

TRF-15 owner report31October: a stock request approves successfully, but opening
the transfer and dispatching a quantity fails with a generic completion error.
Start a separate read-only trace of request/approval/dispatch state, permissions,
branch ownership and stock validation. Need reference, sending/receiving branches,
platform and exact error. Do not alter stock, transfer records, settings or grants,
or bundle an unreviewed transfer change with SQL-07. Agent source investigation
runs alongside root's bounded central-database inspection; SQL-07 continues.

SQL-07 implementation/scoped verification: only catalogue-scope.cjs same() adds
DATABASE_DEFAULT after existing LOWER/CONVERT on each operand. Old full native
predicate reproduced468 against actual POS_Local metadata-only TOP(0); fixed full
predicate/projection compiles. Source predicate otherwise identical after removing
COLLATE; fallback/projection/writes unchanged. Real SQL Server harness31 checks passed and was
independently repeated: baseline468 plus15 scenarios each normal/BIN2 column
fixtures, actual snapshot/catalogue/locked stock reads, private flags and branch/
cluster denials. Only session #fixtures used; no business records/schema/settings
changed. Database default remains verified SQLCI_AS; binary-default DB not tested.

Local runtime restarted normally from the corrected checkout using saved profile
and existing8081 renderer. Main-process path verified. No new collation error in
observed session; actual full UI acceptance is NOT complete: Store settings could
not be loaded gate is visible and shutdown logs a renderer account-permission
failure. Record separate SQL-08 investigation; do not bypass auth/settings guards,
clear local data, change grants/config or include an unapproved repair in SQL-07.
Broader startup503/change-tracking recovery warnings also remain separate evidence.

TRF-15 now has explicit owner correction/test approval in its own branch/worktree.
Central readback for ST-STR1-WEB01-20261031-0001 confirms approved/no dispatch,
requested1/source STR1stock0/no child warehouses; logs23514 Short by1 match.
Current shortage correctly rolled back. Approved follow-up addresses safe error
feedback, atomic dispatch/linked-request close and verified native actor handling;
live migration application remains unapproved. It must preserve stock shortages,
permissions and existing documented partial/zero request-close semantics.

SQL-07 final clean suite585files/3878tests passed; actual31SQL fixtures and
metadata-only before/after compilation independently repeated. Redundant literal
comparison probes omitted from final diff; executable SQL behavior is the regression.
No new migration/schema/config/grant change. Prepare targeted commit/beta PR.

TRF-15 implementation boundary: preserve existing notification channel/off/
WhatsApp behavior. Direct SQL event emission would change legacy behavior, so
it is not part of this batch. Keep the established client event on a fresh
confirmed dispatch, avoid duplicate replay emission, and never report stock
dispatch failed solely because a later notification failed. Existing lost-response
notification best-effort limitations remain separately tracked; no exactly-once
external delivery guarantee is claimed. Atomic stock/request completion remains
required. Actual duplicate-product ambiguity must fail before stock mutation,
not silently merge quantities or rewrite existing records.

Integration checkpoint31October: SQL-07 source ba61f580 is already merged through
PR349 into beta e1c78d84997acda118338f8acae5b697b38ce76f; exact-head platform,
security/regression and Cloudflare checks passed. Its merge tree equals reviewed
head. TRF-15 source42160659 is now being integrated with that latest beta; retain
both evidence histories above. Only this ledger's parallel append conflicted;
no application-code conflict. SQL-08 remains pending separate investigation/
approval; do not treat SQL-07's merge as proof that the settings/auth gate is fixed.

TRF-15 final source verification: full590-suite/3953-test run passed using stable
local test TEMP/TMP and four workers; default sandbox runs had transform-temp
ENOENT and two environment-dependent timeouts, not accepted as passing evidence.
Full ESLint/TypeScript and schema/install-order/sync/merge checks passed. After
latest-beta integration def3dc20,63 focused actual catalogue/transfer/protocol
checks passed. SQL SHA remains972A62DF…579D2 with44+44 isolated scenarios and8
real PostgreSQL races independently repeated; no live rows were used. Independent
server/client review finds no remaining scoped blocker. Capture exact-head PR
checks before merge; live migration and installed-device acceptance remain pending.
Both local development servers respond200 at8080/8081. The owner pressed Escape
to stop Computer Use; root stopped app interaction and continued only approved
source/testing/Git work. Do not infer further GUI control from this checkpoint.

31October owner explicitly approved applying the exact tested TRF-15 migration
20261031042447_atomic_transfer_dispatch_and_verified_native_actor.sql to ROSEGILL
→rosegill0011@gmail.com's Org(bjxgimekljzlnwejuawj)→pos(qhrufhtbeguxydenzfey),
https://qhrufhtbeguxydenzfey.supabase.co, database postgres. Approved SHA256
972A62DF76BEE85B93CBC7CB0C7C3985EC8C7109D6456AFBC1B36384B35579D2;
application/readback and independent ACL/definition review are the active steps.
Prior definitions/ACLs are retained in ignored local cache. PR350 exact head
e7d7e089 has passing security/regression, Android/Windows, iPhone, Cloudflare
and label checks; CodeRabbit skipped, not a completed review. Apply once with
preflight, then verify and merge beta only. No real dispatch/stock adjustment,
Membership change, production promotion or installer/OTA publication authorized.

TRF-15 approved migration applied once on 31 October at 15:47 (Asia/Brunei); live history
20261031074715. Immediately-before preimages match saved definitions/ACLs;
the reviewed SQL checksum is unchanged. Readback verifies the exact guarded
warehouse-picker copy, original legacy wrapper ACL/owner, exact lifecycle/history
delta (CRLF-normalized comparison) and unchanged lifecycle/history metadata.
The new 6-column receipt table is empty, RLS-enabled and owner-only with the
append-only trigger; effective execute denies anon/authenticated/service_role on
all new private helpers, grants the public atomic endpoint only authenticated
and native adapter only service_role. Security-advisor categories are unchanged;
the SECURITY DEFINER advisory adds the intended authenticated atomic endpoint
(92→93 routine findings). Its explicit permission/branch checks and role grants
passed isolated and installed-definition review; do not remove required access
or claim all historical advisories are resolved. The no-policy informational
advisory adds the private receipt table (10→11): no raw client/service-role table
grants or policies are intended; only the guarded owner routines access it.
Read-only 15:49 (Asia/Brunei) check of ST-STR1-WEB01-20261031-0001 still shows approved,
dispatched_at NULL and receipt count 0. No real dispatch/stock correction was run.
Persist before/after definitions in ignored cache; no existing business rows or
grants were rewritten by the migration. Independent live read-only review passed:
all new bodies match approved source, 8 private-helper execute checks per role,
15 receipt-table privilege checks, complete receipt shape/trigger/default and
single migration history verified. Evidence is retained in ignored independent
postapply metadata. Only three documentation files change after e7d7e089; rerun
final exact-head beta checks and merge. Physical-device acceptance remains pending.

TRF-16 new owner report: 31 October 15:51:30 (Asia/Brunei),23514
TRANSFER_REQUEST_INVALID. Owner explicitly asked to check and fix. Live log traces
legacy dispatch→atomic core line33, rejecting invalid linked-request facts.
Read-only rows show SR-BET2-WEB01-20261031-0001 has zero items; its approved child
ST-STR1-WEB01-20261031-0001 holds the single original line ID, quantity1, source
stock0 and no dispatch. Real derivation proves stableChildId(parent,"6",0) equals
stableChildId(stableChildId(parent,"8",0),"6",0). The child upsert reassigned the
original line; the new SQL validator correctly refuses unproven request completion.
Prior fixtures had independent header IDs and missed this actual creation sequence.

Approved necessary source correction: derive only NEW fulfilment header UUIDs
from the full normalized request UUID using domain-separated WebCrypto SHA-256
(UUIDv8), preserving existing sourceRequestId discovery, legacy fulfilment IDs,
normal/direct/draft line IDs and the shared stableChildId used by checkout.
Test real save/approval/upsert sequence, retry/case/failure behavior and no stock
mutation. Also prepare an additive immutable stock_transfer_items.transfer_id
guard with isolated same-parent/native-sync/retry tests after checking legitimate
writers; do not apply it live without separate exact-project approval. Never
relax missing-parent/branch/approval/shortage guards to dispatch this record.
Original request-line repair needs audit-backed original values and separate
review/approval; do not infer original quantities from the child. Root reads audit
history while agent owns bounded source/tests/guard preparation. PR350 remains
draft and merge is held. Membership remains on hold; no data repair is performed.

Owner confirmed the original SR-BET2-WEB01-20261031-0001 request was exactly
1 pair of W572511105-3-8 M's Signature Basketbal Shoes, STR1→BET2. Barcode
6927050888645/SKU-000000178020 identifies the surviving child snapshot, cost49.
Client-reported approval history lists this product/quantity1 and the original
activity reports total1; no authoritative old item row was found in change_history.
Prepare an exact guarded one-row request-line restoration using the owner's
confirmation plus those observations, a new item UUID and unchanged child row.
Test idempotence, stale-state refusal, rollback and preserved product/movement
facts with actual triggers. Add an immutable change_history audit entry using
verified deployed schema and explicit maintenance attribution. This confirmation
is evidence for the proposed values, not permission to apply the repair or the
new parent-identity guard live; present both exact changes/project for approval.

TRF-16 necessary compatibility dependency: selected local SQL is not authoritative
proof that no legacy child exists online. Request approval itself uses the online
verified path, so add only a named transfer-request approval-state read through
the existing native verified relay, bounded by the requested ID and its parent/
child lines. Derive permissions/staff/terminal branch server-side; no generic
service-role query, renderer branch override, grant change, broad catalogue read
or shared router-mode change. Browser uses its authenticated central client.
Refresh the saved request and existing child before deciding new identity or
repairing an approval acknowledgement; reject ambiguity, unavailable authority,
changed scope and stale deferred UI updaters. All-zero approval does not require
crypto. Existing partial/zero/branch/approval semantics remain unchanged.

Owner explicitly approved applying both exact TRF-16 changes to ROSEGILL→
rosegill0011@gmail.com's Org(bjxgimekljzlnwejuawj)→pos(qhrufhtbeguxydenzfey),
https://qhrufhtbeguxydenzfey.supabase.co: guard20261031080149 SHA256
36D22E840F9D5063AC447AD6F1E4854062F4939D81B84DA7FE1A55AAEE40C0E3, then
one-line maintenance repair SHA256
6C99BACB16C6D90238A23DEBB290EBB3CFB42CB1E2005D141EDF3A557735A7CF.
Apply unchanged guard first, verify it, then exact bounded repair; abort on busy
or changed facts. Original child/header/stock/SKU/price/grant preservation and
audited idempotence remain mandatory. Final isolated evidence:40 repair cases
and9 real concurrency cases independently repeated, with an additional real-role
trigger privilege check; actual creation/approval sequence23 cases and15 focused
UI/API/checkout/receipt/branch suites182 tests pass. Scope excludes real dispatch,
general data repair, new approval rules, Membership and publication/promotion.

TRF-16 deployment on 31 October (Asia/Brunei): approved immutable-parent guard
applied once at 16:31:26, history20261031083126; exact approved maintenance script
succeeded at 16:31:50. Preflight confirmed both approved headers/revisions, one
surviving child row, missing original line, no receipt and absent guard. Root
readback 16:32:26 verifies restored row8a470cac…97e6 requested1/approved1/cost49,
new UUID distinct from unchanged child rowffc1465d…0000 (revision3). Both headers
remain approved/revisions2 and1; no dispatch/receipt. Read-only request-integrity
helper now returns true. Audit3d69b8ca…f017 records exact line/owner-confirmed facts
with postgres maintenance attribution. SKU/barcode/cost/selling169/source stock0
remain unchanged. Guard enabled BEFORE UPDATE OF transfer_id; SECURITY INVOKER,
owner-only execute; existing branch/approval rules untouched. No real dispatch or
business stock movement. Independent live verification at16:33:36 also passed,
matching original incident headers/child exactly. Ignored before/after evidence
retained. Final source regression/CI and beta merge remain, separate from devices.

TRF-16 limits: older installed Electron clients may create local pending collisions
until updated; cloud guard does not retroactively repair local SQL. Concurrent
old/new creators can leave competing pending headers, rejected for review; atomic
dispatch permits at most one child to fulfil the request. No global uniqueness
or automatic legacy re-key is authorized. Creation tests exposed missing private
approval/one-argument helpers in canonical fresh-installer SQL; captured live
definitions are used only in fixtures. Preserve that separate fresh-install audit
item and do not claim all installer/device behavior verified.

TRF-16 final verification: full592 suites/3987 tests passed after one compatibility
fix kept all pre-existing relay reads' one-argument call shape; the new named read
alone receives scope. The original full run caught that health-call regression;
purchase-order code/tests were not changed. Full lint/TypeScript, merge readiness
and SQL install-order checks passed. Root repeated23 actual create/save/approve
scenarios with captured25 live baseline triggers and immutable-parent guard,
40 maintenance SQL scenarios and9 real busy-transaction cases; independent review
also passed23 workflow cases,185 focused tests and10 real PostgreSQL busy/ACL
checks. Shared checkout ID helper, Electron and receipt-printer files have no diff.
Independent live readback after approved guard/repair passed. No other empty
request-with-linked-transfer cases were found by the bounded related-data scan.
Commit only reviewed files, leave unrelated .temp untracked, require final-head
CI and merge PR350 into beta; publication/main promotion remain unapproved.

SQL-08 renewed owner report31October: after signing into the latest local Electron,
Could not load store settings / saved settings have not been replaced. Read-only
investigation baseline beta c15fdd2144536a31b5f057de8484628d31fe6028, source tree
equal tested610df65e, isolated branch codex/electron-settings-authority-beta.
Running Electron34416 and renderers8080/8081 remain on the reviewed source; no
restart, unpairing, queue clearing or configuration write was performed for this
investigation. Root and two agents traced the actual failure boundary.

Confirmed: enabled_ready SQL connection does not establish verified POS authority.
Current Electron stderr repeatedly records admin:adopt-session -> canonicalConfig
line21 -> EACTIVATION_BINDING, activation does not match the verified computer
registration. This line executes only after the hosted endpoint returns success
and ok:true; a failed local settings-edit grant is not the cause. Strict
loadBranchSettings fails before settings_overrides/settings_locks reach local SQL.
These are operational read channels; do not add settings-edit permission to fix it.

Read-only Windows-vault metadata inspection (no credential/proof values printed)
confirms the saved POS backend is https://pos.luckycharmsdnbhd.com, a pc activation,
consistent STR1 branch aliases and a legacy missing deviceUse/proof field. Missing
legacy fields alone do not establish invalid registration: binding() infers
Operations from the saved branch, and renderer proof hydration is separate.
Main's authorizationServerUrl prioritizes that saved backend over the local Vite
API. Inspected production origin/main2f404e6f ipc-adopt returns authority/branch
without terminal; current beta requires the verified id/platform/mode/branch
response. This is a source-confirmed protocol incompatibility and the strongest
incident explanation, not a captured live response-shape proof. A real central
registration mismatch remains a separate possibility until compared. Keep the
strict descriptor guard; never trust a renderer branch or synthesize authority.
Public sync-health on production, beta and local backend returned HTTP200 with
serviceConfigured=true during this check; that is not full database health proof.
Separate earlier sync bootstrap503/change-tracking warnings are not explained or
resolved by the successful adoption-response mismatch.

Proposed narrow batch, awaiting owner approval: distinguish an incompatible/missing
verified descriptor from a genuine binding denial; preserve structured temporary
unavailability versus denied outcomes through adoption and the settings gate.
Verify the latest local Electron against a compatible backend only with explicit
approval before changing this profile's saved POS backend. Preserve all sealed
registration/SQL/cloud credentials, grants, pending work, checkout and receipts.
Do not silently switch operator URLs, trust older unsigned response fields or
claim a generic Retry will resolve a protocol mismatch. Actual affected files:
electron/verified-activation.cjs, Main admin:adopt-session, desktop-pos-session,
ipc-adopt route and narrowly required settings/error propagation consumers,
plus integration tests; finalize scope before implementation. A new live schema,
account grant or stock/sale mutation is not proposed.

Acceptance: actual installed Main handler plus routed strict scoped reads succeed
for a matching pc Operations descriptor with an ordinary permitted cashier;
missing/foreign/mobile/mode/branch descriptors deny before SQL without altering
saved registration or grants;503 stays unavailable and401/403 stays denied;
existing verified offline source:pos authority reads SQL without contacting cloud;
maintenance authority is not a POS identity; late user/branch/activation changes
cannot adopt stale results. Genuine changed registration requires the existing
authorized reassignment process. Separate management-scope/read-policy findings
remain pending rather than bundled. Six relevant existing suites/51 tests passed
in the agent's read-only run; no new integration fix is claimed. Rollback for a
future code batch is its targeted beta PR revert; any separately approved local
backend change must retain its original value for explicit restoration. Membership
and its shared loader dependencies remain unchanged and ON HOLD.

SQL-08 owner approval31October: explicitly approved changing only this local
development Electron profile's POS backend from the production address above to
http://127.0.0.1:8080, retaining the original for restoration. Separately approved
beta correction and isolated tests for incompatible terminal-verification
responses and temporary-connection versus authorization-denial classification.
This supersedes SQL-08's pending-approval state, not its no-grant/no-data boundaries.
No production URL, schema, account, stock, sale, print, Membership or installer
change is authorized. Use the isolated c15fdd21 branch, bounded file ownership and
independent review. Shared authority helpers may change only through an explicitly
scoped opt-in used by this adoption path; existing consumers must retain behavior.
Record recovered legacy proof and failed/missing proof cases in regression tests.
SQL-08 implementation dependency review: preserve browser/unpaired ipc-adopt
success with terminal:null; do not add a terminal-only endpoint restriction.
Main alone requires a matching verified descriptor when a saved/candidate native
registration exists. The earlier resolveRelayScope fetchAppUser read also turns
HTTP failures into missing account; permit endpoint-only strictAvailability on
that helper, with unchanged default consumers and allow/deny semantics. This is
necessary error classification within the approved adoption batch, not broader
relay authorization redesign. Existing typed503 must not become inactive403.
Approved local profile backend change completed: only backendUrl now points to
http://127.0.0.1:8080; equality check confirms all other decrypted settings unchanged
and sealed registration/cloud credential hashes unchanged. Original production
address retained in ignored local restoration record. Runtime verification next.
SQL-08 local transport test outcome: HTTP8080 was explicitly approved but rejected
by CloudClient's existing HTTPS-only synchronization guard (EBACKEND_HTTPS).
Restored the original production backend immediately, with registration/cloud
credential hashes and all other settings unchanged. No HTTP exception is proposed.
Owner subsequently explicitly approved HTTPS beta for this local development
profile: https://beta-pos.luckycharmsdnbhd.com. Changed only backendUrl to that
address with the same invariants; original retained in ignored restoration record.
Readonly central registry lookup using an ID fingerprint confirms saved pc token
is used/claimed/not revoked, claimed_platform electron, correct STR1 branch,
management_registration false and both proof fields present. No token or proof
value printed, no registry write. This metadata does not prove the renderer's
currently supplied HMAC matches; investigate any true denial separately.

SQL-08 latest owner instruction31October: start local Electron with the current
correction so the owner can enter the password, then inspect the loading issue.
Earlier Escape stopped Computer Use; do not resume window control until its new
approval gate is satisfied. CLI server/code checks and the requested app startup
continue. Current source remains uncommitted on c15fdd21; all scoped slices frozen.
Prior full run:595 suites,4089 passed/1 legacy-message assertion failure. The
assertion now expects the approved fixed public message and confirms no SQL query;
focused repeat passed. Final whole-suite rerun/types/lint remain before commit.
Actual HTTPS beta sync returned SESSION_INVALID / activation belongs to another
device. Registry metadata is valid STR1; no proof reset, registry update or grant
change performed. Source/isolated actual-module tests confirm origin-local HMAC
key changes when renderer origin changes. Historical profile contains43117,52888,
8080,8081 loopback origins; Main preferred packaged port is43117. Start the native
preview at that existing stable origin while preserving the same userData/session;
this is a verification attempt, not proof of recovered identity or permission to
rebind. Compatible backend must verify the existing proof before normal sealing.
Membership and all unrelated tasks remain unchanged/on hold as recorded.
SQL-08 final source checks31October: full595 suites/4091 tests passed in111.95s
with two thread workers; root TypeScript and full ESLint exit0, diffcheck clean.
Initial whole run caught one obsolete raw-error-message assertion; targeted test
now asserts the fixed generic message, retains EPRIVILEGE and proves no SQL query.
No product/price/stock/sale/checkout/receipt or grant change was introduced.

Owner explicitly resumed Electron inspection and signed in themselves. Actual
latest MainPID6552 runs this worktree with Windows renderer43117 (native Vite2884)
and web preview8080 (Vite4432). Older owned preview processes and redundant8082
probe were stopped after identity checks; no unrelated process was terminated.
Full same-profile sign-in has now recovered the EXISTING HMAC at the original
native origin through normal online verification: nonsecret sealed metadata shows
operations, same STR1 branch, consistent aliases and bindingProofPresent=true,
compared with legacy null mode/missing proof before sign-in. No proof/key values
printed/copied, no central registration/claim/account grant edits or unpairing.
This supports the origin-mismatch mechanism; it does not prove every legacy device
has a recoverable key or authorize an automatic origin search/claim repair.

Actual read-only Electron observation17:40-17:41Brunei: Approvals opens with All
branches disabled on this Operations terminal, own STR1 context and local SQL ready.
Settings opens and shows expected configuration groups without the previous load
gate. Connection panel shows queue0/errors0 but Needs attention from expired
change_history Change Tracking; latest bootstrap still returns untyped HTTP503.
Keep SQL-09 separate and read-only: existing local jobs/checkpoint metadata may
identify whether pre-bootstrap settings reads or a later table failed. No manual
resync/repair, cursor reset, stock/sale mutation or Membership change performed.
No real checkout/receipt printed; automated permission/offline regressions passed,
while other physical-device, offline sale and final installed acceptance remain.
Retain original backend restoration record locally; leave current owner-approved
HTTPS beta address and both latest previews running. Source commit/PR next after
final scoped diff review; no publication or production promotion is authorized.

SQL-09 owner approval31October: separately approved diagnostic-only sync changes
and isolated tests after existing read-only investigation. Baseline c15fdd21,
branch codex/sync-bootstrap-diagnostics-beta. Approved surface: only allowlisted
failed-table/phase/origin/HTTP-status/non-JSON breadcrumbs in CloudClient, bootstrap,
lifecycle, Main logging and diagnostics normalizer, plus isolated actual-module
tests. Preserve request payloads, return/error identity, retry/timing, transactions,
rollback, queues and checkpoints; no record/schema/permission/setting/Membership
change, no manual resync/repair/cursor reset or security bypass. This identifies
the next automatic failure; it is not approval to repair the still-unproven503.

Related SQL-08 correction a140c12f is in beta PR351; full595 suites/4091tests,
TSC/full lint and platform/security CI passed. Its separately approved compatible
HTTPS beta backend/original native origin let normal owner sign-in verify and seal
the existing proof; Settings/Approvals open, same STR1 branch and SQL ready.
Formal immutable security diff scan is in progress; preserve its source unchanged.
Latest permanent decisions/evidence are in that PR's existing memory/tracker;
merge/reconcile them before this diagnostics branch is run or submitted, preserving
both task histories. Do not copy an older source tree over the running correction.

Readonly SQL-09 evidence: local change_history checkpoint1083 is below MIN_VALID
VERSION2206/current3510, last updated19October, retention7days. No new bootstrap
job; current503 could be settings prefetch or targeted gap recovery. Sampled
Supabase bootstrap requests were all200; bounded beta Worker tail missed the later
503 completion, so provider/layer/table is unproven. Native normal-close warning
correctly refuses to close with the expired-history error. Latest renderer was
reloaded via its development server only; Electron Main/SQL/pending work stayed
running and no close guard was bypassed. A read-only diagnostic proposal is not a
transaction or baseline repair. No existing proofs, cloud claims or grants changed.
SQL-09 implementation frozen: exactly five approved source files and one new
actual-module test; author4suites/75tests and independent6suites/83tests passed.
TypeScript, scoped lint, five CJS syntax checks and diff checks passed. Tagging
preserves payload bytes, original/frozen/primitive errors and retry/transaction/
checkpoint ordering; only registry/enums/status/boolean enter existing log events.
It does not repair503. Original SQL-08 PR351 has now merged into beta f4fc2207;
parents c15fdd21/a140c12f and exact tested tree708422dc8bc7fa64d44ff68cc3fb5c0672e6f139
verified. Formal Codex Security scan33f2e945 completed with all21paths reviewed,
zero reportable findings; all required platform/CF/permission checks passed.
CodeRabbit was skipped, not counted as a completed review. No publication/main
promotion. Merge current beta into this isolated diagnostic branch and preserve
both task histories, then run combined regressions; no copying older code.

Requested latest-code reload completed by restarting only native Vite at the
same43117origin (nowPID11272). Main6552 was kept running because normal close
correctly reported incomplete synchronization/expired change_history tracking;
no force exit/close-guard bypass. Reloaded UI remained signed in at STR1.
A separate no-window read-only helper is probing exactly one page of pos_settings
and settings_scoped with the existing sealed verified device proof. It opens no
SQL connection and imports no Main/lifecycle/apply routines; no downloaded rows,
credentials, URLs or request/response bodies are logged, followed or applied.
Only sanitized table/status/nonJSON/finite error class/latency are retained in
ignored local evidence. Results remain pending; this probe is not a resync/repair.

Latest31October owner steering: keep audit-scope correction and GLOBAL-history
policy PENDING; do not prepare/apply those access-rule changes. Owner requested
commit/merge of approved updated features and publication of the beta version,
preserving existing functionality. Subsequently asked to fix the change_history
JSON/download gap now if feasible while beta release preparation continues.
This reactivates narrow download reliability/performance work ONLY, not the held
access-scope/GLOBAL decisions or any production promotion.

SQL-11 active plan under that fix request: cap only change_history page growth,
use bounded smaller-page retries for non-JSON503 pressure, and reuse immutable
server redaction lookup sets while retaining identical rows/fields/masking. Add
actual-module lossless paging, no-duplicate-apply/checkpoint and denied-operation
regressions. Other tables' default page policy remains unchanged. Prepare/test
UUID-index ordering for the existing audit read case only, preserving every
current predicate, cursor representation, grant and returned row. This SQL
optimization is preparation only: any live routine application needs a separate
exact-project proposal/approval after isolated tests. No audit event/branch scope,
SKU, stock, sale, PIN, permission, database setting or checkpoint is rewritten.
Recoverable baseline62abf346 (integrates beta f4fc2207 and diagnostic source3c810d1e).

SQL-09 runtime verification: new automatic failure at10:35:55UTC identifies
change_history/download/gap_recovery, HTTP503, nonJsonResponse=true. Settings
prefetch and local SQL application were not that event's failing stage. Separate
one-page read-only probes of pos_settings/settings_scoped/change_history returned
200JSON; no SQL connection or rows applied by the probes. A completed temporary
helper left an Error window; only that identified no-SQL helper was removed.
The corrected file-output/redirected helper exited cleanly. The GPU/network
'killed' records do not establish a driver defect; no GPU/config change is made.
Integrated diagnostics passed root596suites/4114tests plus TSC/fullESLint. No live
routine/record/policy change, manual sync/repair or cursor reset performed.
Beta publication remains a separate checked-commit operation under existing
release controls; unsigned IPA and signed OTA are distinct artifacts. Preserve
existing signing keys and operator settings. Capture final tested release SHA.

SQL-11 implementation/verification31October: two source files cap only
change_history pages100/no-growth and retry only trusted non-JSON503 twice at the
same cursor with250/500ms delay. Two immutable redaction sets moved outside
recursion; exact row/field/masking parity retained. No access-policy/Membership,
checkout, stock, price, grant, operator setting, queue or cursor-reset change.
Independent client5suites94tests and redactor5suites55tests passed. Root combined
598suites4143tests passed (threads2 runner); fullTSC/fullESLint and final scopedlint
passed. Initial default-fork runner was abandoned after worker failures; thread
run passed without harness/source changes. Node regressions84/86 passed initially;
2publication cases were GitBash sandbox startup denials, then all6publication
guard cases passed outside that sandbox (all86 covered). Do not misclassify runner
restrictions as an application defect. A redundant single-thread rerun was stopped
after the full success became available. Canonical32/captured32 SQL scenarios,
canonical24tests and independent repeats passed; actual target ICUen-US synthetic
1031UUID parity check true, no business rows scanned. No local real-PG ICU run
is claimed. SQL test is added to CI. Prepared read optimization preserves generic
plan limitations and old installer100/live10 bounds; see database review.

Owner explicitly approved exact SQL-11 live application. Verified ROSEGILL link
beta, orgbjxgimekljzlnwejuawj, posqhrufhtbeguxydenzfey ACTIVE_HEALTHY before write.
Applied unchanged20261031105517_change_history_bootstrap_uuid_keyset.sql,
SHA256893885224E5C5CF0297E4AF8A51C39E14F5C978D57CF2408B1D84C7C2DA3C1FE,
at11:04:29UTC/19:04:29Brunei, livehistory20261031110429. Deployed full-definition
MD5b4306345e37e638c610e8484a479c510 equals captured source with only approved tail
replacement; metadataMD5eb2fe1be978f2957607466022359f559 unchanged, ownerpostgres,
SECURITYDEFINER unchanged, anon/authenticatedfalse/service_roletrue EXECUTE.
No business data/index/grant/checkpoint writes. Held audit/GLOBAL correction stays
PENDING. Affected-PC full recovery remains unverified; do not skip history/reset
baseline or force-close POS. Next: commit exact source/docs, security diff scan,
new beta PR/exact-head platform checks, merge beta and owner-requested beta
publication from the checked merge SHA. No production promotion. Existing iOS
key presence/match verified without printing private material; signed OTA is a
separate release artifact and is not implied by an unsigned IPA build.

Latest owner steering after SQL-11 verification: 'skip this recovery' and
'first publish the beta version'. Further recovery investigation/probes are
DEFERRED. Preserve the reviewed changes and already approved/applied routine;
do not undo them, reset checkpoints, clear queues or force-close POS. New local
automatic attempt11:09:24UTC still reported history/download/gap_recovery
non-JSON503 before the new server code merged/deployed. Recovery is NOT verified
or marked fixed. Prioritize checked beta release, no production promotion.
PR352 now records this boundary and formal scan e40b9bdc-fc21-44ad-85d9-213285d159da:
zero reportable findings/all19paths/no deferred coverage, immutable f4fc2207→
dd4331b0. Source remains frozen; this tracker follow-up is documentation-only and
will be committed separately from the selected release source.

## 2026-11-01 — Shift sync first; native registration follow-up

REL-20261031 verified: beta1.4.81-beta.2 published31October11:25:11UTC,
workflow41196132262 success, source dd4331b03bd87aaaca34ef345cce8eaf8f102fe8,
merge273c685c identicaltree341d9bc. Public5metadatafeeds and3packageHEADs200,
version/source identities correct; Windows144295620B/Android29508656B/unsigned
IPA10682282B. No signediOSOTA or main/stable promotion. PR352 complete; recovery
investigation remained deferred at owner's request, not marked fixed.

SHIFT-28 ACTIVE (priority1): production Windows cashier closes a shift locally,
but the production phone/cloud still shows yesterday's shift open and today's new
shift open simultaneously. Trace local close transaction/journal/CT, upload order,
backend branch/actor checks, actual cloud persistence/acknowledgement and phone
refresh/cache. Compare production1.4.79 against published beta1.4.81-beta.2;
do not assume an existing migration or test proves this affected device works.
Identify exact affected records before any data repair. User authorizes targeted
fix/isolated regressions; preserve cashier checkout, grants, branch binding,
existing amounts/counts and pending work. Live routine/schema/data changes need
separate exact-project approval. Do not manually close/create replacement shifts,
clear queues or reset checkpoints. This request reopens shift-specific sync
investigation only; broader history recovery and held audit-scope/GLOBAL policy
remain deferred unless a confirmed dependency needs a separately explained fix.

TERM-29 PENDING (priority2, owner explicitly says after shift issue): Electron
and Android older beta show registered branch yet cashier screen says terminal
not registered/staff list blocked; admin login returns to PIN/setup screen.
Compare released fixes and actual trusted activation/proof/backend compatibility,
not the display label alone. Preserve sealed config, terminal identity, branch
restrictions, online/offline PIN and permissions. Do not investigate/implement
this follow-up before SHIFT-28 resolves or owner changes priority. Membership
and its shared dependencies remain ON HOLD/unchanged.

Baseline273c685c/current beta, isolated branchcodex/terminal-shift-verification-beta.
Prior worktrees and uncommitted routeTree stat-only change preserved. Recovery
plan: revert only a reviewed future fix commit; retain business records and queues.

Owner update1November: TERM-29 is resolved in latest beta according to their
verification; no registration follow-up/code change needed. Keep status as
owner-verified, not a new agent physical-device certification. SHIFT-28 remains
active: latest shift selection works, but previous locally-closed shift stays
OPEN in cloud/history. Do not solve by hiding historical rows/dateauto-close.

ReadonlyROSEGILL evidence: ACTIVE_HEALTHY targetposqhrufhtbeguxydenzfey,
orgbjxgimekljzlnwejuawj. ActualSTR1/Gardong production1.4.79 token
2a9be656-3830-4f1c-9ede-3e9c379f3d13 has Oct31shift
1a349429-cea1-4f45-8d2b-36678d37ad27 and Nov1shift
acbc1ed1-2fc1-44c7-9c71-c338da7fda2f bothOPEN/ACTIVE/closed_atNULL/revision1.
Both havezero cash-count/close-event/reconciliation/notification rows. Thus
phone is showing persisted records, not just stalecache. LastsyncOct29;
recentPCtelemetry reportsidle/pending0/failed0/SQLenabled_validating/offline;
thosecounters exclude CT-only writes and are not proof of successfulsync.

Agent source+actualPushWorker fixture reproduces on production79 andcurrentbeta:
openingjournaluploads, trustedclosingdirectOps.apply is CT-only, an earlier
change_history ECHANGEGAP prevents reaching shiftsCT. PendingSummary counts
journalonly. Currentcloud13capturedroutines/7triggers plus2Main-shaped nullable
closurecases persist/ackCLOSED2/4→OPEN1 in isolatedPG (40cases total); no newDB
migration justified by currentevidence. Three supporthelpers remain canonical
fixture definitions; do not claimfull deployedworkflowcertified. Actualaffected
PCclosefacts/CTerror stillneeded tobindstructuralbug toincident. Useroffered
UltraViewer; read-onlyReady confirmation requested andawaited after priorEscape.
No cloud/localbusinessdata orconfig/queue/checkpointchange performed.

SHIFT-28A targeted code plan under owner's explicit shift-fix request: keep
existing Main permission/branch/blinded-calculation gates; add an internal-only
nonserializable transaction callback in OperationsRepository.apply and a fixed
trusted shift-journal helper, then wire only final close-count/recount/variance
approval. Ordinary renderer aggregate/write paths retain all existing policies;
no trusted flag/channel exposed. Business mutations+journal+receipt atomic;
post-write actual versions/branch/shift graph validated, rollback if journal fails.
Counts/events remain grouped and cloud v2 authoritative ack required beforeclear.
Add allowed/denied branch, callback failure rollback, replay/concurrentstate and
actual PushWorker oldclose+newopen+historygap regressions. No checkout/receipt
writers changed. Baseline273c685c; reviewedsource rollback via scopedcommit.

SHIFT-28B legacy pending-closure recovery remains PREPARATION/diagnosis only
untilactualPCevidence. Safe proposal uses validshiftsCTcheckpoint tostageonly
verifiedsamebranch/terminalchangedCLOSEDrows+exactgraph, no historicalblanketseed;
invalid/alreadyadvancedcheckpoint requiresstop/preservelocalfacts andseparate
incident-specific approval. Do notimplementautomaticrepair/queueexistinglocal
records withoutreviewed plan/actualevidence. No newliveDBmigration justified by
40captured-cloudfixturecases. Broadhistoryrecovery remains deferred.

SHIFT-28A review found a necessary extra upload dependency before this fix can
ship: actualPushWorker reproduction .cache/shift28-independent-original-recount.cjs
shows ORIGINALjournalgroup readslatestRECOUNTparent110 butonlyoldC1/R1count100;
validparentv2proofcanackthatfirstpacketwhilelatestcountgraphabsent ifnextpacket
fails. Currentcloudackcomparesparentfacts only. Thisis confirmed isolatedcode
behavior, not a claimaboutincident's actualamounts. Never ship commit-timejournal
alone withthisknownintegritygap. Proposed expansion: change-reader + push-worker
capture exactCLOSEDparent/fullsavedcountgraph in one SERIALIZABLE read transaction
justbefore request preparation; bind stable requestID tothat capturedgraph, retain
originaljournalIDs pendinguntilproof, leave unrelatedtransactionpathsunchanged.
Shared-sync expansion needs separate ownerapproval underAGENTS scope rule; no
edits tothose2files untilreceived. No liveDBrecord/grant/setting/legacyrepair.

Owner explicitlyapprovedsharedshift-uploadcorrection+isolatedtests1November:
change-reader.cjs +push-worker.cjs nowauthorizedfortheexactread-timegraphbinding
plan. No liveDBchanges/automaticlegacyrepair. CaptureoneCLOSEDparent+fullsaved
graphinoneSERIALIZABLEreadtransactionbeforestablepayloadID; eachpacketmustremain
immutable/consistentduringHTTPandretainsoriginalqueueIDsuntilv2ack. Usecurrent
savedmatchingcount/recon, notolderjournal'spinnedcountIDs; preservehistoric
originalcounts/summary and allroworigins. Broaderhistoryrecoverystilldeferred.

SHIFT28A/B necessarycompatibilityreview: uploadreadtakesparentlockbeforechildren;
writer musttake sameparentUPDLOCK/HOLDLOCK beforechildwrites toavoida reader/writer
lock-ordercycle. Add second INTERNALFUNCTIONhook(beforeWrite5tharg) insideOps
transactiontry/beforebusinessops, keepbeforeCommit4tharg andall3argIPCunchanged.
Preserveexistingbusinesswriteorder/customtriggercontract, no renderertrustflags.
Tests mustproveprelockorder/rollback/defaultpaths. This is source-analysisrisk,
not a claimedactualSQLdeadlockreproduction. Historicalcount_id/reconciliation_id
nullableONDELETESETNULL linksremainallowed; finalselectedmatchingcount/reconmust
becomplete, neveracceptnullhistoricalrecordasproof. No new businessmath.

PinnedNode22.22.2 setuponlyinprivateNPMtoolcache (no package/lock/machineconfig
change); finalchecks useit ratherthanhostNode24.21. ActualPCread-onlyReady remains
awaited; no remotecontrolattempt/authentication/settings/datamutation performed.

### SHIFT-28A integration checkpoint — 1 November 2026

The owner-approved writer and shared-upload changes are implemented on
`codex/terminal-shift-verification-beta`, based on current beta `273c685c`.
The refreshed destination remains at that revision. Source changes are limited to
OperationsRepository's two internal transaction hooks, the new trusted shift
journal, three final-closing Main calls, and closing-graph capture/binding in
ChangeReader/PushWorker. No renderer trust flag or IPC channel was added.

Independent reviews found no actionable defect in these paths. Required test
mock updates also cover the existing offline scope assertion and the old
shift-only PostgreSQL replay fixture; their branch checks and expected outcomes
are retained. The full graph fixture now invokes both transaction hooks in their
actual order. It uses real extracted Main functions, the journal helper, reader,
PushWorker and disposable PostgreSQL routines/triggers/FKs, with transactional
in-memory local persistence. It does not establish physical SQL Server locking,
HTTP/JWT gateway behavior, installed-device acceptance or delivery under nonempty
notification rules.

Root independently passed 82 Node sync/startup/event/database/shutdown cases,
38 isolated closure cases, 15 canonical full-graph cases and 15 cases using all
three captured deployed-definition sets. Static generated SQL Server schema and
sync registry checks each verified 70 tables/decisions; they do not certify the
affected PC's installed schema. Four focused suites passed 87 tests.
Full lint passed. The first full Vitest run completed with one outdated source
assertion; that assertion was updated for the three approved writer substitutions
and passed in the focused run. The final full run passed all 600 suites/4,193
tests in 122.25 seconds using pinned Node 22.22.2, threads pool and two workers.
Final TypeScript and changed-file lint checks passed after all test changes.
No runtime configuration was changed for the initially buffered test output.

Read-only cloud recheck at 11:22 Asia/Brunei confirms ROSEGILL pos remains healthy
and both identified STR1 shifts remain OPEN revision 1, without closing children.
No business records, local/cloud queues, checkpoints, settings or grants have
been changed. SHIFT-28B still needs the affected production PC's actual saved
closure graph and CT metadata; no automatic historical replay is authorized.
Broad history recovery, audit/GLOBAL scope changes and Membership stay deferred.

Rollback: revert only the reviewed source/test commit and rebuild the matching
client; retain existing saved business rows, journal entries and receipts. No
database migration or data rollback accompanies this patch. The older client
does not gain the new closing-journal protection. Beta merge, installer release
and a separate explicitly approved production promotion remain distinct steps.

Delivery: source/test correction committed as `1c867a43` and pushed to the
isolated branch. Draft [beta PR #353](https://github.com/amirosesingh/retail-pos/pull/353)
targets `beta` and carries the `beta` label. The 15-file diff contains only this
approved correction, necessary tests/CI and project records. The destination was
refreshed before commit; no conflict or source replacement was introduced.
Automatic exact-head checks are pending. No merge, release tag, installer/OTA
publication, production promotion or live database change has been performed.
The owner's read-only affected-PC handoff remains pending; do not infer that
published beta or this draft has recovered the existing production closure.

### 1 November — shift visibility, timing and production preparation

Owner reports that two cloud shifts remain open, but the primary Shifts card
shows one; an older shift has run for about 26 hours 46 minutes. Existing Correct
edits closing counts only, and the owner wants administrators to be able to
resolve selected open shifts individually, including their actual closing time.
The owner explicitly selected **recover the original saved closing first**.
Never infer its timestamp from duration, use today's time for an older close,
fabricate counts, or close the currently active drawer as a side effect.

SHIFT-28B remains active diagnosis/preparation. The affected-PC read-only
UltraViewer handoff was requested again; no resume/readiness reply has arrived.
Actual legacy recovery still requires matching local saved graph/revision/identity
and a separately approved exact repair. Admin manual closure/time correction is
a new fallback workflow, SHIFT-30, not authorization to remove the closed-only
guard from the current recount correction routine. Prepare its requirements and
affected files before seeking implementation approval; no new workflow or live
shift change is currently applied.

SHIFT-31 read-only visibility audit: the top card and active-shift query select a
single newest open shift. Complete branch Shift history has no status restriction;
that does not establish an all-open control screen. Audit exact ID/open time,
terminal, branch and filters before concluding a row is missing. Any proposed
all-open list or targeted close action must preserve active checkout selection.

REL-29 active preparation: owner requests final validation, update the beta line,
and prepare accumulated beta updates for production. PR #353 exact head ce6ee9e5
now has passing Security checks, Android compile, iPhone build and label checks;
The Cloudflare check reports successful deployment for that exact source; the
served official beta URL/source was not independently read back. This does not publish updated Windows
Main or prove affected-PC acceptance. The latest published beta installer still
omits this shift fix. Browser live reload at 8080 does not execute Electron Main.
Prepare an exact beta-to-main draft promotion, review release/rollback boundaries
and report blockers. No specific production promotion is approved. Main merge
automatically leads to stable release workflows after checks, so do not merge or
enable auto-merge there without the owner's approval for that exact promotion.
Membership and broader history/audit-scope recovery remain on hold/deferred.

Owner timing clarification: existing correction edits tender counts but not the
closing time. Preserve the exact original timestamp during saved-close recovery;
administrator fallback must target one explicit shift and record before/after
time, counts, actor and reason. It must not turn cloud lag into a fabricated new
closing. Future normal sync should carry these original facts without requiring
an administrator recount. Manual time/closure implementation remains a separate
proposed batch; owner selected recovery first.

Agent review confirmed a separate UI limitation: shared status-column filtering
runs after Shifts history's 25-row pagination, and All shifts leaves prior search
text in place. SHIFT-31 proposal is an explicit All/Open/Closed filter before
pagination, clear-filter behavior and unambiguous row/dialog identity. Owner
approval requested before source edits. SHIFT-32 separately proposes preparation
and isolated tests only for rejection of stale OPEN uploads after CLOSED; no
live guard application is authorized. The existing risk predates PR #353.

Read-only current cloud checks: both identified shifts remain OPEN revision 1,
closed_at NULL, zero cash-count/reconciliation rows. Actual public active-shift
RPC delegates to a private implementation; that implementation enforces current
staff/terminal/branch visibility and selects newest OPEN with no close time,
ORDER BY opened_at DESC LIMIT 1. The public-wrapper substring check alone was
inconclusive and was followed through correctly; no deployed active-sort bug was
confirmed. No migration is justified merely by seeing two persisted OPEN rows.

REL-29 detailed gates and proposed stable version are now in the existing
go-live-checklist.md. Source metadata is 1.4.80; unchanged automatic stable release
would publish that version. Proposed stable 1.4.81 is not silently committed.
PR #353 was marked ready for review under the owner's beta-update request; an
automatic Codex code review completed on ce6ee9e5 with no findings. CodeRabbit skipped automatic
review for the nondefault beta target; do not claim a CodeRabbit pass. Existing
exact-head CI is green. No beta merge, installer publication or main promotion
has occurred at this checkpoint.

Additional incident evidence: cloud activity for the older shift contains a
shift_cash_variance report e383e067-ea8b-4ca1-bef0-9946c0ddf82c and a separate
shift_close activity. The variance metadata reports original close time
2026-10-31T13:08:56.837Z (21:08:56.837 Asia/Brunei), original opening matching the
shift row, original STR1/Gardong identities and reconciliation ID
7a49fc63-da14-41c6-b7d7-c1ddda5871fa. That reconciliation row and all closing counts
are absent centrally. This is stronger evidence of partial upload, but an activity
report is not the original complete local closing graph or authoritative recovery
proof. Match these IDs/time against the affected PC; do not synthesize children
from a notification. No event or business row was changed.

Windows source-package preflight passed against the current source and native
driver dependencies. No unpacked installer was supplied to that check, so it is
not a packaged executable or actual SQL Server runtime acceptance. A bounded
read-only last-24-hour log aggregation found no matching branch-denial,
closure-error or statement-timeout strings in the queried postgres/edge events;
this neither proves no other errors nor proves an attempted closure upload.

Production preparation now has separate draft
[PR #354](https://github.com/amirosesingh/retail-pos/pull/354), `beta` to `main`,
labelled `production` and `awaiting-owner-approval`. It records the cumulative
source inventory, explicit version proposal and unresolved gates. It does not
approve or perform main merge/auto-merge/publication. The draft currently follows
beta 273c685c and must acquire PR #353 before candidate finalization; updating beta
will update this draft automatically. No other open main promotion existed when
the draft was created. The owner has not approved this exact promotion.

Owner approvals received: read-only UltraViewer inspection is resumed; target is
the affected **Electron production app**, not the web production site. User will
enter any required credentials. Do not retry, repair, clear queues or change
settings/business data during inspection. SHIFT-31 UI correction/tests are now
approved: three files (Shifts route, pure shift-history view helper and tests),
no shared Table rewrite, no current-drawer/checkout changes or open-row recount.
SHIFT-32 preparation and isolated tests are also approved; no live guard migration
or data mutation. Its precise stale-write/acknowledgement tradeoff must be tested
and reported before any live approval. Membership remains untouched.

PR #353 merged into beta as b31c74e4 on 1 November after exact-head CI and Codex
code review completed with no findings. Merge source tree/installed-device
acceptance remain distinct. Production main is unchanged. Root starts SHIFT-31
branch codex/shift-history-visibility-beta from that beta commit, retaining only
the current documentation changes. Separate SHIFT-32 preparation uses its own
beta-based worktree/PR. The local web preview follows the current UI worktree;
changed native Main still requires an updated Electron process/installer.

SHIFT-28B actual affected-PC evidence, 1 November around 13:38–13:42 Asia/Brunei:
owner signed into the production Electron app; root inspected only existing
status/navigation/error views through UltraViewer. The registered STR1 app uses
local SQL `POS_Local`, connection/schema Ready, measured UI response 224 ms, and
online Supabase Connected. The current operating shift is the 1 November opening
at 10:29:21. Main sync still reports expired `change_history` Change Tracking.
Saved Errors show ECHANGEGAP/Automatic repeated 105 times, plus Bootstrap HTTP503
and Database.State HTTP503 repeated 105 times. Last upload/download display Never;
no database job was active. Background journal counts briefly changed 0→27→0,
then showed audit_logs queued; root did not start/retry/pause/repair any job.
This directly matches the structural journal-before-CT failure and explains why
queue zero is not full synchronization proof. It does not yet prove the old
shift's full local closing graph/revision or permit a repair.

SHIFT-31 source/tests frozen: root independently passed full 601 Vitest suites /
4,204 tests in 130.04 seconds, final TypeScript and changed-file lint. Independent
review and isolated actual Shifts/shared Table desktop1440x1000 and phone390x844
interactions passed. Review caught and corrected new-filter granular column ACL
inference before commit: metadata-only main search is preserved, while permitted
column filtering uses the same table catalogue/role/user visibility policy.
One memoized history timestamp drives both duration filters and cells. No API
polling, shared Table, checkout, closing-action or permission-grant changes.
Fixtures mock auth/data/mutations and do not certify installed devices.

SHIFT-32 source preparation is frozen in a separate worktree, not applied live.
Initial author validation covers canonical/captured closure and full-graph cases
plus six actual PostgreSQL17.11 two-session races; independent review is active.
Only a clean, otherwise identical delayed opening is acknowledged as obsolete;
different nonclosing facts/counts/progress remain conflicts with pending work
retained. Do not describe preparation as repairing the existing missing closure.

Beta merge preservation verified: b31c74e4 and the exact reviewed ce6ee9e5 head
have identical Git tree c0316615bfba51c69b0f2942d23fb48b8f1a9bd7. The merge did
not replace other source or introduce unreviewed runtime differences. Current
SHIFT-31 branch/source differs from that beta only in its three approved UI/test
files plus the project memory/tracker/readiness documentation.

Current system-status screen also reports green POS sync queue / "Everything on
this till has been uploaded" while native history recovery is failing. Treat this
as a separate misleading status finding, SHIFT-33, not proof of completeness.
Source audit/preparation only is underway; no status/queue logic is approved or
changed in this batch. Do not conflate browser outbox, native journal, CT uploads,
bootstrap progress and actual business-row acknowledgement.

SHIFT-31 committed as e334fc52 and pushed to
[beta PR #355](https://github.com/amirosesingh/retail-pos/pull/355). The six-file
diff contains its three UI/test files plus current memory, tracker and readiness
records. Full 601/4,204, TypeScript/lint and desktop/phone fixture evidence are
recorded above; exact-head automatic checks/review remain separate.

Owner separately approved SHIFT-33's four-file status correction/tests. Use a
pure summary, the current native status during existing health checks and the
local SQL status panel; no additional polling/cloud requests, retries, queue,
checkpoint, settings or permission changes. A zero journal count must not claim
all CT-only business records uploaded. Browser/mobile use their actual durable
outbox signal, not the compatibility zero stub. Keep current and past errors
distinct. Separate beta-based worktree; preserve the live UI preview branch.

SHIFT-32 independent review confirmed an upgrade gap: a pre-existing zero-applied
OPEN receipt can return before the new upsert validation and acknowledge changed
metadata on replay. Owner approved extending preparation/isolated tests into the
existing receipt-replay validation, preserving old receipts and genuine pending
changes. No live application is authorized. A separate revision-convergence risk
also remains: cloud CLOSED5 may not replace local OPEN99 through an ordinary
version-gated pull. Do not claim server guard tests establish that native
convergence or silently expand into local adoption/writers. Test/document the
boundary before any production claim.

Owner follow-up approval: SHIFT-33 may also edit the fifth file, the existing
browser outbox module, to expose a read-only persisted queue count and test it.
Reuse its storage constants; do not create/upgrade its database, change queued
records, retries, permissions or business data. Connect this signal only to the
existing diagnostic run. The owner needs help opening an already installed SQL
Server Management Studio on the affected PC. Root may locate/open that tool;
the owner handles any connection/authentication prompt. Inspection remains
SELECT-only after confirming POS_Local and the affected terminal identity.

SHIFT-31 merged into beta as 423950b486734e2c099a658a2bc0479c30e7f6ea after
exact-head checks passed for e334fc52, including role/permission regression,
Windows renderer, Android, iPhone and beta website deployment. Automatic Codex
code review completed with no findings; CodeRabbit skipped this beta target.
The merge and reviewed head both have Git tree
6f51bcbf2f4259b0d5557ed3d21886c947a213d6. Production PR #354 follows this beta
head but remains draft; main, installers and real business data are unchanged.
The local Vite preview returned HTTP 200. Root opened the already installed
SSMS22 on DESKTOP-VIB2MIL; its saved connection identifies the existing
DESKTOP-VIB2MIL\\LCRPOS / POS_Local database. Root stopped at the connection
prompt and asked the owner to connect and leave a blank query editor visible.

SHIFT-28B original parent now verified by SELECT-only SSMS inspection on the
affected PC: database POS_Local, server DESKTOP-VIB2MIL\\LCRPOS, current CT36193
at the initial read. Exact old shift 1a349429-cea1-4f45-8d2b-36678d37ad27,
expected STR1 branch and Gardong terminal predicates return one row, status and
state CLOSED, opened2026-10-31T02:22:18.1080000+00:00,
closed2026-10-31T13:08:56.8370000+00:00, row_version3. The close time matches
the cloud variance activity. Cloud parent was OPEN revision1 with no closing
children at the last independent read. Original child graph/journal/checkpoint
verification remains pending; no mutation or upload retry was performed.
UltraViewer text transfer lagged and temporarily pasted stale clipboard content;
root verified the eventual SELECT text visually before execution. Unverified
text was never executed. The owner handled SQL authentication personally.

Additional SELECT-only affected-PC evidence: one saved cash count, one
reconciliation, three shift-event rows, one shift summary and one variance alert;
all seven child records have the expected branch. Reconciliation
7a49fc63-da14-41c6-b7d7-c1ddda5871fa links count
dd2b330a-bcfc-44f6-9949-8d912cdbca80, has the exact original close timestamp and
matches the cloud activity. At current CT36253, change_history push checkpoint
22619 is below its minimum25728; shift_variance_alerts checkpoint24745 is below
its separately displayed minimum25728. Cash-count, event, summary and
reconciliation push checkpoints are29273, shifts29281, each with displayed
minimum25728.
The shifts-only journal result contains an acknowledged revision1 opening, not
a pending revision3 closing. The complete six-table journal and exact saved
financial/link/actor graph still require verification before any repair plan.

Fresh read-only ROSEGILL pos check after this local evidence still shows both
identified cloud parents OPEN/ACTIVE revision1, no close timestamp and zero
counts/reconciliations/events/summaries/alerts. Project metadata is ACTIVE_HEALTHY.
The confirmed stable1.4.79 path writes closing through Change Tracking, uploads
opening journal entries first, then aborts on the expired history gate. This is
a proven blocking mechanism, not yet proof of the sole cause of the original
missing close: its exact CT entry/context relative to shifts checkpoint29281
still needs reading. Neither green connection health nor an empty journal proves
delivery. Stable also lacks coherent graph capture
and client v2 proof validation. Do not seed recovery metadata under the old
binary and call generic ok or queue0 authoritative recovery. A separately
approved exact recovery must preserve saved facts, use a reviewed transport on
the same production profile and read back the complete central graph. No repair,
checkpoint reset, retry, unpair, configuration or business-data change occurred.

SHIFT-33 final independent review caught and corrected missing/malformed native
DB metadata and stale getState overwriting newer disconnect/disable events.
Root final602 suites/4,249tests passed in143.97s on latest beta423950b4 plus the
five-file patch; TypeScript passed. Agent expanded64 tests/four suites and
independent45 focused tests plus real isolated Chrome/IndexedDB fixture passed.
The fixture uses synthetic native signals and Table/Dialog/CSS boundaries; it
does not certify installed IPC, successful uploads or full-app styling. Commit
a3945e5f8add8681d9b480e3a839dd075dd60041 was pushed to beta PR #356. Existing
retry/queue/checkpoint behavior, checkout, grants and Membership are unchanged.

SHIFT-32 replay extension is committed5ca18128c3fa68b996cadce9d7e90997f9223232
in draft beta PR #357. Root repeated71 captured-definition SQL scenarios after
advancing to beta423950b4. Independent final review repeated16 real PostgreSQL
concurrency cases and19 captured full graphs; generator parity changes only two
effective signatures. The rejected waiting-lock design reproduced a two-parent
deadlock; the final new nonfinal validator uses NOWAIT, returns55P03/BUSY and
retains receipts/pending work for existing bounded retries. It preserves pure
CLOSED proof behavior and existing upsert order. Native OPEN99/cloud CLOSED5
adoption and existing opposite-order fresh-writer deadlocks remain outside this
guard. No live application, historic repair or production approval is inferred.
Migration20261101052452 SHA256:
032CF56FF5BB377AEFC67576B2CC41027D6A5331C3E43D0F4A3D2659236026A1.

SHIFT-33 exact-head platform, role/permission, Windows-renderer and deployment
checks all passed; automatic Codex code review completed with no findings.
CodeRabbit skipped the beta target. PR #356 merged as
ead66f306c365135b2e9e6aede691ca6b621a872; both merge and reviewed a3945e5f
have tree7f64a3b8d5e351b84a61d7ac9fa8404fbbee6adf. Root advanced the existing
live Vite preview to that beta source without replacing or copying a checkout;
the updated system-health module returned HTTP200. Production PR #354 stays
draft and no installer/publication/main merge or live repair occurred.

SHIFT-28B final SELECT-only CT probe: local parent remains revision3;
CHANGETABLE(VERSION dbo.shifts) reports version35061, context NULL, remote-skip
flag0, push checkpoint29281, current table minimum25744 and current CT36321.
Thus the retained latest closing change is still beyond its checkpoint, not an
already-passed or remote-marked latest version. The current earlier history gap
blocks this CT pass. Count kind is ORIGINAL; all four consistency predicates
passed: branch/terminal scope, exact count/reconciliation/closing time, count
tenders versus reconciliation, and parent final/count/expected/variance facts
versus reconciliation. These are bounded reads, not a transactionally frozen
complete repair payload. Other historical causes are not globally ruled out.

The stable source and these incident facts now agree: the protected closing is
saved CT-only, the earlier opening was journaled/uploaded, and the expired earlier
history gate prevents reaching the retained closing. Trusted new closing-journal
source is already beta, not installed production. The owner was asked to approve
separate one-shift recovery preparation and isolated tests; no live recovery or
metadata stage is authorized or executed. Present any exact local repair and
resulting central closing writes separately after full graph/journal validation.
Preserve the actual close timestamp/counts, existing current shift, original
profile, receipts, checkpoints, grants and business rows. Never turn queue0,
notification presence or generic old-client ok into successful-recovery proof.

SHIFT-32 first remote CI failed only the explicit canonical SQL-file inventory:
the new migration made215 files while the expected list still had214. Root and
agent added its exact filename to the existing required test, without weakening
assertions/skipping checks. This necessary test registration is within approved
preparation/tests, introduces no new runtime scope, and is the seventh changed
file. Root merged current betaead66f30 into the isolated guard branch, preserved
both features, and all602 suites/4,249tests passed in96.50s; changed-test lint and
diff checks passed. Commit a5d31e67dbae904c7f8662c3939f8cdb786f3034 was pushed
to draft PR #357. Migration SHA256 remains unchanged. Exact updated-head CI is
rerunning; do not present the earlier failed run or draft as merge/live approval.

### SYNC-CPU-01 implementation and verification — 2 November 2026

Owner approval covers the response-redaction helper and isolated tests only.
Replace the per-object filter/map/fromEntries allocations with one projection
loop. Keep the eager Object.entries snapshot, fresh plain output, inherited table
context, existing price-settings preclone behavior and identical masking. Safe
own-property creation preserves `__proto__` and inherited setter/readonly cases.
No endpoint, pagination, authorization, shift, queue or database code changed.

Frozen SHA256 (root and independent reviewer matched):

- Helper: `C8E0D759195602777BCDD43709926B52C6EC9646A4EAE2DA1A0A99D0D173C814`.
- Parity test: `922D87F4AA429D1407A1F79294C569A21D91BC83582784D9257615379182629E`.

Pinned Node 22 verification on this Windows development PC:

- Author: three focused suites / 43 tests passed.
- Independent reviewer: 420 frozen-input, privacy, context, prototype and fuzz
  parity cases passed against beta `fd41a37f`; no remaining scoped finding.
- Root: `vitest run --maxWorkers=4` passed all 602 suites / 4,260 tests in 88.78s.
  The initial default-concurrency run passed 4,258 tests and hit two unchanged
  20s import timeouts (Azure/SQL module loading and settings navigation). Both
  passed individually with one worker, then the complete bounded run passed.
  No assertion, timeout, test or application behavior was weakened to pass.
- Root: 54 native sync/startup/event tests, `tsc --noEmit`, scoped ESLint,
  `git diff --check` and `vite build` passed. Existing dependency directive and
  Wrangler-main override warnings remain; no deployment was run. The build's
  generated logic-health report was excluded from this patch after preserving
  its output privately. Its two informational numeric-input findings in
  NotificationRulesPage are unverified, separate settings-audit follow-up, not
  confirmed CPU causes or permission changes. Exact-head beta PR checks remain
  pending.

Independent synthetic full `JSON.parse → redact → JSON.stringify` measurement,
nine alternating amortized samples per case, median milliseconds:

| Fixture / mode | CPU before → after | Wall before → after |
| --- | --- | --- |
| History 100 / normal | 17.263 → 14.000 | 13.794 → 12.918 |
| History 100 / management | 15.632 → 13.158 | 13.918 → 13.122 |
| History 500 / normal | 93.500 → 62.500 | 69.453 → 61.440 |
| History 500 / management | 89.750 → 62.500 | 71.341 → 63.591 |
| Wide stock 500 / normal | 130.333 → 125.000 | 110.476 → 110.071 |
| Wide stock 500 / management | 130.000 → 135.667 | 116.901 → 113.673 |
| String-heavy 100 / normal | 24.000 → 18.077 | 18.554 → 16.813 |
| String-heavy 100 / management | 17.786 → 16.714 | 17.467 → 16.845 |

This is local Node/V8 evidence, not complete-handler, Cloudflare, authenticated
device, installed checkout or live recovery acceptance. Common nested history
pages improve; wide stock maps show no material CPU gain. Do not promise every
payload now fits the hosting budget. Large-payload bounds or endpoint changes
require a separate plan and approval. Keep existing rows and cursor semantics;
never truncate a response after its cursor was calculated.

Before merge/deployment, require exact-head CI and the separately authorized
release process. Then verify hosted CPU outcomes and full registered-device
recovery without resetting checkpoints or dropping pending data. Historical STR1
reconciliation, stale-upload guard application and multiple-shift setting
enforcement remain separate; Membership stays on hold. Rollback is a targeted
revert of this CPU patch, preserving later unrelated changes. No live data was
changed by this batch, so it requires no database rollback.

Source commit `889527f24aa1fafd6742f4ce27c1340157d9486f` is pushed to draft
[beta PR #360](https://github.com/amirosesingh/retail-pos/pull/360), labelled beta.
The latest destination still equals the recorded `fd41a37f` baseline. Only four
reviewed files are in its diff; no older checkout or unrelated generated report
was staged. Platform/security/hosting build checks started automatically. Keep
this draft unmerged until its separate release gates are satisfied; a PR build
does not establish successful registered-device recovery or production approval.
## 5 November — approved iOS version metadata alignment

Owner approved a separate metadata-only beta batch: align both Xcode App build
configurations with the existing Retail 1.4.81 package/lock/source version and
advance the native build counter from 4 to 5, following its existing integer
increment convention. Scope is project version metadata and this tracker only.
Preserve signing settings, OTA/private keys, credentials, runtime behavior and
every unfinished task. No database changes, signing, deployment or publication.
Acceptance: verify package/lock/source/Xcode alignment, both plist substitutions,
and that the diff contains no signing/runtime changes; run existing iOS metadata
checks and require exact-head macOS CI. Local Windows cannot certify Xcode/device
builds. Implemented locally: Debug/Release marketing 1.4.81 and build 5;
package/lock/source/plist alignment passed, five bundle-identity tests and six
existing iOS packaging/release tests passed using disposable fixtures. Final
diff contains only four project metadata lines plus this tracking entry; signing
settings and private keys were untouched. Status: implemented and locally
verified; draft beta PR and exact-head macOS CI remain pending. Rollback is a
targeted revert of this metadata commit, not a repository replacement.


## FIN62 current continuation — 4 November

Owner reiterated: complete shift totals/refund validation first with agents; update PR391 and prepare PR354; present exact database changes before application. Current published PR391 head d15be0af passed required CI; uncommitted foundations are not covered by that result. Exact-decimal v2 math, cloud snapshot/version lineage and optional authenticated admission are prepared. Local basis persistence passed 14 disposable LocalDB groups, 10 upgrade groups, 21 capture groups and 12 unit tests; TypeScript passed. All metadata remains default-off/preparation-only. Native journal integration, fully offline opening-origin provenance, final regressions and exact final migration manifest remain pending. No new live database writes, main promotion or publication. Booking deposit attribution remains separate; Membership remains on hold.

FIN62 checkpoint verification: full isolated regression 5,305 passed / 7 skipped (658 suites passed / 1 skipped); TypeScript and diff checks passed. Actual PostgreSQL financial admission 16 groups passed including concurrent corrections and unchanged old RPC/seven triggers; 5 cloud preparation bridge tests passed. Optional journal/persistence remains unactivated. Pending Main exact-draft consumption, opening-origin provenance integration, capability rollout and final exact DB manifest; no live DB application.

## FIN62 production-ready request — 4 November

Owner requests completing the release candidate so only the final publish decision remains. Continue approved shift/refund integration using agents; no main promotion, publication or live database application is implied. Exact cloud/local database bundle still requires review before application. PR391 checkpoint dc28c542 contains tested optional foundations (5,305 passed, 7 skipped); Main activation remains off. Active next steps: exact Main drafting with complete source-hash race guard, durable opening-origin persistence/admission, immutable financial-operation version upload for never-uploaded offline intermediate states, final capability/legacy transition, full regression and beta acceptance. Preserve current checkout, permission enforcement, registration, historical amounts and pending queues. Never mark production ready while these remain incomplete.

FIN62 offline-history batch APPROVED: owner approved implementation and isolated tests of docs/database/shift-financial-operation-history-batch.md on 4 November. Scope includes actual aggregate/refund transaction capture, immutable financial versions and closing boundary, frozen upload and guarded cloud protocol. No liveDB application, main promotion or installer publication. Exact final migration bundle remains a separate approval gate.

5 November owner clarification: shift sharing must be configurable in Operational Rules. Existing allow_multiple_shifts_per_terminal controls count per till and does NOT configure cross-till sharing. Track separate operational-rule setting/check across applicable online/offline consumers; preserve current branch-wide sharing until the explicit setting is implemented, do not confuse it with multiple cashiers on one PC. No new rule/schema applied. FIN62 continues first and must preserve authorized shared-shift/refund paths.

## 5 November — FIN62 implementation checkpoint and remaining gates

Owner approved offline-history implementation/isolated tests and separately approved Operational Rules sharing-setting preparation/implementation. No live database upgrades, capability activation, main promotion or publication is authorized by these approvals. New sharing control must default ON, preserve current branch sharing and same-PC cashier handover, remain separate from multiple-shifts-per-terminal, and enforce online/offline using trusted terminal identity; independent beta batch still pending.

PR391 published head dc28c542 passed all required CI including iOS, Android, Windows and security. Newer sources remain local pending next verified checkpoint. Root full suite after legacy VM fixture/scope assertion correction: 5,396 passed/7 skipped (663 suites pass/1 skipped). Root actual SQL Server operation-store 33 groups and real refund/closing six groups passed; Root actual PostgREST 14 named-RPC/access/hash groups passed. These are revision-scoped results, not final new-source release acceptance.

Native optional/default-off implementation now includes exact Main drafting, safe existing numeric-count compatibility (exact boundary currency normalization; no binary arithmetic or imprecise-large-number acceptance), action-specific prepared author contexts, marker-derived exact historical replay, immutable financial operations/closing frontier, exact protected OPEN capture, strict metadata guards, foreign-terminal CLOUD_BASIS genesis and opaque Main HTTP→SQL witness/CT/pending-work checks. Local metadata 025/026 remain under preparation outside automatic migration discovery. 026 is changing for shared origin/observations, so older candidate hashes must NOT be applied.

Prepared cloud ordered metadata, immutable baselines, guarded latest business publication and actual old graph writer composition are tested in isolated PostgreSQL. Root review reproduced a critical missing-business-publication prerequisite (metadata alone closed120 with no sales); preparation now denies this and preserves legitimate later published foreign sale/refund evidence. Global birth claims and indexed immutable publication/step records added; exact accepted retries remain separate from new permission checks. Private protected scopes remain empty and no activation API is enabled.

Remaining FIN62 gates: ongoing OBSERVE refresh with actual MVCC source ordering and full signed own-pending-prefix merge (no reseed/reset/old-closing rewrite), normalized per-sale current stream state to eliminate quadratic JSONB rewrites, real web/Android live authorized v2 snapshot/correction/publication contexts without invoker/RLS bypass, final transport→actualSQL complete workflow/compatibility and capability rollout, exact consolidated cloud/local upgrade manifest, fresh final tests/build/CPU acceptance and beta integration. PR354 remains draft; its reported head metadata has lagged actual beta, so old green checks cannot certify the latest candidate. Do not silently omit any gate or mark production ready from unit counts.

Separate observed risk: current terminal:read IPC exposes full decrypted binding proof to code in the trusted renderer; credentials alone cannot enroll an author key, existing key replacement is denied, but do not claim hardware/Main attestation from a registered public key. No IPC hardening or key changes authorized/applied in this work. Preserve Membership on hold and the separate deposit-drawer attribution follow-up.

5 November counted-input compatibility clarification: existing web endpoint rounds NEW raw counted input to2dp, and legacy Main did likewise withbinaryMath. NewMain preservesboundarynormalization using approvedexactdecimalhalfaway rule before saving/signing. Stored/accepted counts andtargets remainstrictwholecent comparisons; neverround/repricehistory. Unsafe large JSNumbers stillrequireexactstring, negative rawinput rejectedbeforerounding.

5 November continuation: root readiness/authorized live relay tests added; 272 focused tests across six suites passed outside Windows sandbox after sandbox temporary-file replacement failures, and TypeScript passed. Installed-but-unready financial adapter fails closed; only exact missing-RPC legacy capability may use old writer. Independent review found remaining live publication no-op query cost, Management scope parity, mixed native/web lineage and shared per-shift locking gaps; corrections/tests remain in preparation. SHIFT63 setting approval recorded separately; implementation waits behind FIN62 shared correctness review. No live DB application, beta merge, production promotion or publication this continuation.

5 November owner says Do it after explicitremaininglist: complete administrator sale/tender/missed-bill compatibility, durable financial-noop pending-journal verification, independent SHIFT63 setting, and final regressions/beta integration. This authorizes scoped implementation/tests; final exact cloud/local database application and production/publication approvals remain separate. Root optionalSALEarraydefaults regression corrected; no production writes.

5 November FIN62 native runtime continuation approved: prepare Main-private capability-gated assembly and isolated tests. Main currently leaves draft provider NULL and does not inject financial stores/validators into repositories/reader/push; this is an explicit remaining implementation gate. Proposed assembly binds one shared runtime to the actual project/backend, verified Operations terminal/branch, exact local025/026 metadata, database/profile/pool identity and an explicit server rollout capability. Schema existence alone never enables it; no renderer setter, live enrollment, production rollout, queue reset or configuration change is authorized. Legacy actions remain compatible; already-protected pending work must fail closed if capability is missing or changed. Exact server capability contract and final owner rollout approval remain pending. Native no-op checkpoint:42 owned LocalDB schema/capture/replay groups,20 owned PG/HTTP/SQL observation groups and23 pure tests passed; exact026 SHA25607228BC49DF9EEA461890939204DBE2C4427A38CDDDC80B466AD332BE93EB566; no liveDDL.

5 November release-gate discovery: tested native/history modules were still default-off and Main factories/Push/reader/aggregate/refund were not assembled. Finish the already-approved explicit capability negotiation/runtime assembly before calling FIN62 implemented. Main-only vault must be separate from renderer-writable config; exact profile/project/registration/DB-GUID binding; no schema-presence activation. New capability preparation is read-only/defaultdisabled, optional on-demand per-shift authoritative legacy/required/unknown classification; private append-only rolloutapprovals stayEMPTY until separately reviewed owner rollout/allsharedbranchclient compatibility. Root capability/API/basis76unitchecks and actual disposablePostgREST24contractgroups pass (capabilityreadytrue usesexplicitfixturestand-in, notfullinstalledreadiness proof). No liveSQL/rolloutrows written.

## 5 November — current FIN62/SHIFT63 release ledger (supersedes earlier pending checkpoints)

- Implemented locally: Main-private capability/runtime assembly; complete saved
  offline opening/sale/refund/closing history; source-ordered OBSERVE refresh;
  exact durable CT/no-op proof; guarded live/admin compatibility; deterministic
  cloud/local candidate manifest. No capability activation or real-data rewrite.
- Verified:11 actual Main/LocalDB/HTTP/native PostgreSQL groups;397 independent
  native unit tests across17 suites; eight local receipt/precision groups;
  exact generated artifact native/PGlite preservation and rollback groups.
  These do not certify the separate hosted nested-payment transport path.
- Working: final nested JSON amount preservation through the actual endpoint,
  full current-source regression suite, final scoped diff and PR391 code update.
  Current published PR391 head remains dc28c542 until the new checkpoint is pushed;
  its earlier green CI does not cover local continuation.
- SHIFT63: implemented and committed8c10287c in draft PR392. Default-ON sharing
  control and online/offline enforcement tested independently. Requires FIN62
  integration, combined conflict resolution/testing, exact-head CI and local027.
- Pending before release: publish verified PR391 checkpoint; exact-head CI391/392;
  rehearse and test combined beta result; integrate both PRs into beta; verify
  deployed affected paths/CPU; exact target/hash cloud/local approval and guarded
  application; compatible client/cohort rollout review; refresh/check PR354 and
  obtain its specific production promotion/release approval. No installer publish.
- Owner reminder this continuation:391 and392 must precede production release.
  Never overwrite newer features to resolve conflicts or infer safety from Git's
  successful merge. Preserve checkout, permissions, queues and operator settings.
- Retained separate tasks: booking-deposit drawer attribution; credential-entry
  acceptance excluded/unverified; held359 historical repair; Membership ON HOLD.
  No live database changes performed in this continuation.

Final local checkpoint verification: full Vitest rerun5578passed/7skipped
(673suitespassed/1skipped); TypeScript and production build passed. Scoped lint
has0errors/15warnings; no warning was suppressed. Three stale source-contract
assertions were updated for the explicit migration inventory, outbound alias and
trusted financialJournal alias; all46affectedtests passed before the full rerun.
Nested-payment precision now passes through the actual guarded endpoint with72
handler/auth tests: large/12dp nested numbers preserved; duplicatekeys/depth/size,
revoked identity and foreignbranch requests denied. Legacy transport unchanged.
Exact generated cloud/local hashes remain unchanged and generatorcheck passes.
Independent staged-file review found no accidental profile/key/credential files;
private.tmp/buildoutputs excluded. Commit/push and exact-head CI remain separate
from these local results. No live database application or production promotion.
## SHIFT63 — Operational Rules sharing control approved, 5 November

Owner explicitly approved preparation and implementation of a separate sharing control. Preserve current behaviour by default: sharing ON. OFF limits normal registered tills' operating checkout shifts to their own terminal; multiple cashiers on one PC and authorized management reporting/corrections remain supported. Do not confuse this with allow_multiple_shifts_per_terminal. Independent branch codex/shift-sharing-rules-beta starts current beta68470185 in work/shift-sharing-rules-beta, not the unfinished FIN62 branch. Exact cloud/local schema changes remain unapplied and require final review. Scope: canonical scoped setting/save/reload/inheritance/cache, old-schema capability compatibility, trusted normal-terminal online/offline enforcement including direct APIs, and regression tests. Do not silently change existing rule values, widen management grants or show an unenforced checkbox. Old clients/unknown offline policy and pending sales require explicit rollout safeguards. No application code changed in this worktree yet; FIN62 remains first priority.

SHIFT63 implementation checkpoint: separate branch now has default-ON nullable canonical setting, guarded frontend operating selection, verified-server/native SQL enforcement, source/migration/canonical parity and prepared local027 additive upgrade. Fifteen actual disposable PostgreSQL +fifteen PGlite policy groups and ten actual owned LocalDB aggregate/upgrade groups passed; twenty focused unit/relay cases passed. First full run5100passed/3failed: newcanonical migration-list registration fixed; unchangedworkerd/reset andrailtimeout passed serialrerun49cases. Final bounded-parallel fullsuite running; no commit until finalchecks/rootreview. PhysicalUI credential checks notperformed. See docs/database/shift-branch-sharing-upgrade.md for exactobjects, FIN62 outeradapter/historicalcontext dependency and oldbinary/OFF rollout limits. No live database, operator setting, production or publication change.

SHIFT63 reviewed checkpoint: prepared20261105090100 followsFIN62financial090000. Root/independentreview corrected unknownUIdefault(ON), malformedbranch-bearingManagement label(Maincanonicalhelper), completepeercohort/cutovergate, realnativeAPIhistoricalbypass, oldclientABSENTcolumnpreservation, all3sourceanchors, metadatafingerprints/ACL/trigger/columnshape, and callerTransaction safety. ActualPG22+PGlite22, actualLocalDB11, MainIPC/policy/relay/canonicalfocused52pass; TypeScript/scopedlint/diffpass. Fullcheckpoint5107pass/7skip; finalsmallSQL/Mainrefinements targetedpassed, exactheadCIstillrequired. Root/productionreview freshnativeforeignsale denied/rolledback, ownsaleaccepted, preacceptedcross-till receiptACKonce. No actualUIcredential/phonecheckclaim. Codeprepareddraftintegration; local027requiredbeforethisinstaller, OFFrequirescurrentclient+alllocalmetadataverifiedcohort/oldqueue review. Unknownlegacy cross-tillpendingheld, neverdropped/relabelled. No liveDBapply, actualcohortapproval, featureactivation, productionpromotion orpublication. SQLhashes in docs/database/shift-branch-sharing-upgrade.md supersedeearliercandidatehashes. Commit/pushdraftonlyauthorizedafterfinalreview; do notmergebeforerootcombinedchecks.

## 5 November — reviewed FIN62/SHIFT63 integration checkpoint

Owner requires PR391 and PR392 integrated into beta before production release.
PR391 now includes the financial implementation and isolated CI fixture repairs;
its current head is f9bb227a. PR392 includes its notification fixture dependency
repair91599685. The local feature dependency merge preserves both sets of guards:
sharing admission runs first, with FIN fallback only for exact old-schema absence.
Installed rule/admission failures never fall back. Main retains trusted terminal
classification, financial runtime and offline authorization. Four textual
conflicts were resolved using the independently reviewed rehearsal; no repository
replacement, live database or actual beta/main merge occurs in this checkpoint.

Combined rehearsal:5614 tests passed/7 skipped; TypeScript passed. Independent
native83 units, actual financial11, local sharing11 and PostgreSQL sharing22
scenarios passed. Both exact committed cloud artifacts pass seven composition
scenarios with real49/24 readiness, permissions, native own/foreign/replay and
Management/missed-bill compatibility. Portable and native composition tests are
now retained in source and CI, not only a private diagnostic scratch file.
Ten additional standalone CI commands and23 legacy Main closure scenarios passed.
Exact database hashes are unchanged; all upgrades/rollout remain unapplied.

Remaining gates: exact updated-head CI, beta integration/deployment acceptance,
exact database target/file approval and compatible local/cohort rollout, then
specific PR354 production approval. Separate owner-approved iOS metadata PR393
sets1.4.81/build5 and preserves signing keys. Membership remains ON HOLD;
booking-deposit attribution and held359 repair stay separately tracked.

PR391 final headf9bb227a passed all required CI and merged to beta as
b19d6bdfca0e6eeb3cc0e58cd70460ff7d933b66 on5November. This is source
integration only: exact cloud/local application and scoped rollout remain
unapproved. PR392's feature dependency merge is being committed for fresh CI;
production/main and installer publication remain untouched.

## 5 November — exact database application approved

Owner separately approved cloud90000 SHA75DCFA47F4898FBAAF8E356BE499601DA4DA39B92050B510299061137DF21F20 then90100 SHA17B9FB70FF19E5A43C034D9024D593C2918507257B7B92CD63E491AE9668FB07 to ROSEGILL POS projectqhrufhtbeguxydenzfey, orgbjxgimekljzlnwejuawj, postgres, https://qhrufhtbeguxydenzfey.supabase.co after fresh guarded preflight. Owner also approved local025/026/027 exact manifest/sharing-review hashes for ONLY LAPTOP-N0QBONGL\LCRPOS/POS_Local GUIDCEAFA630-D613-423C-8997-8A31DF70C506 after safe Electron closure and preflight. Each file owns its transaction; no cross-database atomicity is claimed. Stop on unknown/partial state. Preserve all business records, grants, settings, queues/checkpoints and signed history. No historical repair, enrollment, rollout activation, sharingOFF, production promotion or installer publication is authorized.

PR391/392/393 are merged into beta596566a1 after exact-head required CI and reviewed merge-tree checks. Workers beta push build7b85b682 timed out in npm dependency installation before compilation/deployment; owner separately approved retry of ONLY that same build/commit/settings. This does not authorize a new configuration/billing/DB change. Agents verify read-only preflight and monitor the single authorized retry; root alone applies approved database files.

Fresh cloud review: projectACTIVE_HEALTHY; all five LF-normalized live writer definitions match reviewed sources, including existing promotion guards; no financial/sharing namespaces exist. Raw fingerprint differences were Windows CRLF only. Local preflight: exact server/databaseGUID, migration24, no new financial tables or sharing column, no other active user requests. Application is not yet recorded complete; verify readiness/grants/no activation and local object shapes before completion.

Application outcome: approved cloud90000 was attempted once and failed safely at
FIN62_WEB_SOURCE_UNEXPECTED:shift_close_start. Read-only postflight confirmed
all financial/sharing namespaces absent and no migration receipts: full rollback.
No cloud90100 or local025/026/027 executed. Preserve unchanged approvals for
those unchanged files; any changed90000 bytes require renewed exact-hash approval.
Two independently reviewed live-source variants are cosmetic only: close-start
0017c1ad94bcd3b3db49fdaa803d70ce differs only denial wording; reconciliation
920af85f differs only comments/formatting. Prepare explicit recognized-variant
compatibility and raw-capture regression tests, keep unknown-source rejection,
then regenerate/review new artifact and obtain approval before retry. No blanket
normalization or authorization bypass is permitted.

The one owner-approved Workers retry e8174569-f211-4a4f-9b2c-cd0fbc5fc87b succeeded:
same beta596566a1, total3m28s, install1m23s/build26s/deploy22s. GitHub hosting check
is green. The earlier failure was npm installation timeout, not database failure.
No code/configuration/billing changes or additional retries were performed.

Compatibility checkpoint: candidate cloud90000 is now
`A37FD005A688C1E2AC4815E0455E9B97B842531C3ACE0BC3F0A105287498EC2E`.
Only two explicit reviewed web-source variants and CRLF-safe patching changed;
90100 and all three local hashes remain unchanged. Five portable and five native
strict-error artifact cases passed, including unknown permission/owner denial
and complete rollback. Captured 22 current raw originals are loaded unchanged;
12 actual Main/owned LocalDB/HTTP/native PostgreSQL workflows passed, including
the actual native batch replay/branch-denial path. A CI wrapper retains the
captured-source guard tests. Full current-source regression is running. Pending:
final diff/CI/beta integration and renewed exact90000 approval, then fresh target
preflight and approved cloud/local execution. No automatic retry is authorized.

Final compatibility verification: full Vitest 5,616 passed / 7 skipped (679
suites passed / 1 skipped); TypeScript, scoped lint and diff checks passed.
Five portable plus five strict native artifact cases and twelve captured-live
Main/LocalDB/HTTP/native PostgreSQL workflows passed. All fixtures are isolated;
no operator data was used or changed. No orphaned PostgreSQL fixture process was
found in this worktree after cleanup. The revised A37FD005…98EC2E artifact remains
unapproved and unapplied. Publish only the scoped compatibility PR for beta CI;
require renewed exact-file approval before a second cloud attempt. Keep all
unchanged cloud/local approvals and safe-closure conditions pending, not lost.

Owner renewed approval for corrected cloud90000 exact SHA
A37FD005A688C1E2AC4815E0455E9B97B842531C3ACE0BC3F0A105287498EC2E
after PR394 CI and fresh preflight. PR394 exact head af5a6ebe now passes all
required security/platform/hosting checks. Fresh independent metadata preflight
matches all eleven reviewed writer/web fingerprints and verifies no partial
upgrade objects or receipts. Continue only the approved exact cloud sequence,
then unchanged local025/026/027 after safe closure and exact identity checks.
No rollout activation, sharing-OFF change or publication is authorized.

## Approved database upgrades applied and verified — 5 November

Corrected cloud90000 A37FD005…98EC2E applied successfully after one connector
confirmation expired without execution (empty-state readback verified before
reopening the same exact request). Supabase history:20261105020052,
shift_financial_known_history. Postflight: private financial readiness true,
49contracts, zero rollout approvals/protected shifts, all five original
sale/refund/admin writer normalized fingerprints unchanged.

Unchanged approved cloud90100 17B9FB70…8FB07 applied after fresh live settings
anchor preflight. History:20261105020324,branch_shift_sharing. Postflight: both
financial/sharing readiness true;49/24 contracts; sharing defaultON; new nullable
boolean column/no default; wrappers deny anon/authenticated and allow service;
no private client write grants; zero rollout approvals/protected shifts. No
historical business-row repair or activation was performed.

Local025/026/027 exact approved canonical files applied once through the
independently reviewed fail-fast SQLCMD harness to ONLY
LAPTOP-N0QBONGL\LCRPOS/POS_Local GUIDCEAFA630-D613-423C-8997-8A31DF70C506.
Electron was already closed and no other POS_Local user session was present.
Each file owned its transaction with5s lock/30s query limits. All10 financial
metadata tables are empty; sharing column is nullablebit/no default; existing
registered migration24 and all existing user-table row counts are unchanged.
No queue/checkpoint/configuration/permission reset, business backfill or data
restore. Do not replay026: preserve installed metadata. Other PCs are excluded.

Remaining: independent readback/security review, commit these execution facts
and final CI/beta integration of PR394, deployed/installed acceptance and separate
compatible-client/cohort activation review. ProductionPR354 remains draft;
no production merge, installer publication or automaticstable-release approval.
## POLICY-65 — preserve native rule proofs and verified edit baselines

5 November owner requested agents complete the remaining fixes and prepare independent beta PRs, including unreadable Electron Operational policies. Baseline beta `5e7327d5`; branch `codex/native-policy-proof-beta`. Preparation/implementation and isolated tests are authorized; no live database/configuration changes or production promotion.

Confirmed: public rules read/save validators discard `deviceBindingProof`; direct read does likewise and direct save drops terminal/session context. This can reject valid native reads or discard normal-terminal scope. The editor also permits changing safety defaults before a verified baseline exists. Preserve proof verification, role/branch denials, Membership hold, settings inheritance and verified offline/pending edits. Acceptance: HTTP/direct proof parity, allowed/denied branch tests, no mutation from unverified defaults, and relevant regression checks. Active implementation; verification/PR integration pending.

Implemented proof propagation, an editor/callback verified-baseline guard, and
connection-bound confirmed capability caching. A same-revision capability change
still updates the cache; successful saves that omit capability retain only the
already verified value in the same context. Both confirmed and pending offline
rules retain the verified capability. An old unscoped cache or a changed
terminal/branch/backend/project cannot enable it. No live schema, settings,
queue/checkpoint or registration change was performed. Initial proof/editor
implementation passed full Vitest 5,636/7 skipped and TypeScript/lint. The final
cache extension and save-context checks have focused provider/cache/queue tests.
Saving rechecks current branch, terminal, connection and permission after async
credential reads and around local storage; context/auth/permission failures are
never requeued as network failures. A newer same-context pending cache takes
precedence over an older confirmed memory entry without requiring restart.
Final full-suite and installed Electron acceptance remain pending. No publication
or production promotion.

Final review corrected first-upgrade offline continuity: an exact nonempty
terminal/branch-matched legacy cache retains operating values and pending state
without becoming editable or claiming backend/project capability. It is never
rewritten on read; actual online verification binds it even when the revision
did not change. Backend path prefixes are part of the identity. Removed the
provider's age-only pending abandonment; 90/365-day reconnect fixtures preserve
unacknowledged edits when cloud values are unchanged. User handover invalidates
in-flight saves. Independent review found no remaining blocker. Frozen final
focused tests: 81 passed across seven files; scoped lint/diff checks passed.
Final TypeScript/full-suite/CI and actual installed Electron acceptance remain
pending. These source changes perform no live repair, reset or publication.

The combined PR397 integration head4137b32e passed full Vitest5,727/7 skipped
and TypeScript. A final confirmed status correction then preserves recognized
typed terminal-registration unavailability as503/UNAVAILABLE, with a fixed public
message and a network failure classification for direct reads. Actual identity
denials remain401 and branch/permission denials403; an arbitrary error status
cannot masquerade as this typed condition. No authorization bypass or new retry
policy. That narrow correction requires the final focused/full/CI checks again.


## IMPORT65 — inventory workbook values and validation (5 November)

Owner approved completing inventory import reliability on a separate beta PR. Preserve entered decimal amounts, code text/leading zeros, row/column identity and existing branch/permission/save semantics. Formatting must not require manual workbook clearing. Reject ambiguous headers or invalid values rather than silently mapping or correcting them. Verify synthetic real XLSX/CSV fixtures, blank/duplicate headers, decimal input and a 10,000-row file. No database writes, dependencies, migration, production promotion or installer publication. Baseline origin/beta 5e7327d5; branch codex/inventory-import-values-beta. Exact customer workbook defect remains unverified without the workbook.

IMPORT65 implemented (not deployed): raw-cell worksheet parsing preserves column positions and physical source rows, rejects duplicate/reserved/missing headers and contradictory populated numeric aliases before rows are staged, and surfaces exact cell errors. Numeric code precision/percentage ambiguities are explicit. Strict number grammar and decimal-identity roundtrip checks prevent arbitrary-text stripping, silent precision loss and invalid-value fallback. The existing decimal draft input is reused for tax entry. Shared stock-count changes are limited to source-row/error reporting. No database/save/permission/quantity-rule changes.

Verification: 91 focused tests in five suites pass, including actual worker chunking at 10,001 rows and real XLSX fixtures; final TypeScript, scoped ESLint and diff checks pass. Initial full suite: 5,645 passed/7 skipped/2 unrelated failures (workerd ECONNRESET and settings-rail load timeout); both failed suites passed unchanged in isolation (12 tests). A bounded run on the pre-precision head passed 5,647/7 skipped; final frozen-source full suite is running and must be recorded separately. No original customer workbook was supplied, so formatting alone as the reported cause and installed browser/Electron/mobile interactions remain unverified. Legitimate imported-versus-catalogue conflicts still require an explicit choice. No commit, deployment, schema change or publication executed by this task.

IMPORT65 / PR396 final frozen-source verification: runtime commit 7ffb9862d039941946d9a67b0dce2673a44f47c3 passed the complete bounded Vitest run (5,660 passed / 7 skipped / 0 failed, 5,667 tests). The final 91 focused tests, TypeScript, scoped lint and diff checks passed. This supersedes only the earlier pending final-suite status; retain the recorded initial environmental failures. Real customer workbook, installed Electron/mobile decimal entry and hosted beta acceptance remain unverified. No database/schema/registration/permission change, live import, production promotion or publication occurred.


## SYNC68 — one coordinated HTTP data lane per terminal (5 November)

Owner explicitly requested one existing sync pipeline for all applicable missing/changed table data: one active sync-data HTTP request, bounded atomic uploads/download pages scheduled fairly, local checkout unaffected. Control/authentication/registration/health remain independent. No claim of one physical Supabase/pool connection.

Approved implementation: minimal CloudClient scheduling helper plus actual-client concurrency/retry/timeout/context tests, baseline beta a73f24e8, codex/single-sync-lane-beta. Capture terminal/backend/project/SQL profile and pool identity when enqueueing, revalidate before sending and accepting responses so old queued data is not relabelled after configuration changes. Preserve payload/proof bytes, existing30s timeout, server authorization, batch boundaries, retry/cursor/queue acknowledgement semantics. No database/pool/billing/install changes or second sync engine.

SYNC68 owner clarification: Electron durable pending business operations remain ONLY in the configured SQL Server database. This Main-memory scheduler stores only transient HTTP ordering closures, is not a durable business outbox, and does not create a browser/file queue. Restart reconstructs pending work through the existing SQL journals/intents/receipts. No scheduler success advances a SQL checkpoint or acknowledges an operation. Future legacy-recovery transport integration must preserve original opaque payload/proof bytes through the same lane and revalidate source context; this batch does not invent a recovery proof or add a second engine.

SYNC68 final source preparation verified: existing Main CloudClient now schedules one data HTTP request through response-body completion, bounds waiting work to64 requests/32MiB and alternates waiting upload/download directions without changing atomic batches. Payload and source context are captured at enqueue; pre-send/successful-response checks prevent stale target/actor substitution. Pure management admission with no operation selector and health remain independent. Existing financial source-change errors and30s actual-request deadline are preserved; waiting time does not spend that deadline. No retry/acknowledgement/checkpoint implementation changed.

Final frozen-source verification:109 focused tests across6 files passed; full bounded Vitest5,748 passed/7 skipped/0 failed (5,755 total); TypeScript, scoped ESLint and diff checks passed. A pre-refinement full run5,747/7 passed before the final pure-control selector guard and is not substituted for this final result. No source changes remain pending from this preparation. Await independent review/commit/PR/CI/beta deployment and installed sync acceptance. No database, pool, credentials, permissions, business records, installer or production publication change. This caps Main's sync-data HTTP concurrency, not Supabase's physical pooled connections or independent auth/control requests.
## DASH69 — explicit dashboard scopes and shop comparison (5 November)

Owner approved a separate UI/query-scope batch, baseline beta59674214,
codex/dashboard-scope-charts-beta. Live Dashboard must use the selected operating
branch for all KPIs/charts together. Live Business Board compares all already
authorized company shops across clusters; normal-terminal branch restrictions
and user grants remain unchanged. All Shops cards AND period charts follow the
explicit cluster selection; All clusters shows every authorized shop, including
zero-valued shops. This supersedes the older always-visible all-cluster card list
under DEC-26/PROJECT_MEMORY719; it does not hide zero-valued shops within a chosen
scope. Preserve revenue/refund/discount/sponsorship formulas and cost/export
permissions. Per-shop colors/legends stay stable across sorting/date/filter
changes. Charts must not slide or enter the infinite summary-card loop.

Additional approved UI steering: unknown initial summary values remain hidden
until data is resolved; retain same-scope confirmed cards during background
refresh, preserve errors and meaningful negative values, reveal changed nonzero
values without reloading the operational database. Investigate existing helpers
before any shared animation change. Existing stabilization work remains first
priority; no schema/settings/permissions/checkout writes, publication or
production promotion is included. Active source implementation; tests, independent
review, CI, deployed/installed acceptance remain pending.

DASH69 UI/query-scope source is prepared: selected-branch Dashboard KPIs and
inventory, authorized company-wide Business Board, explicit cluster-filtered All
Shops cards/lifetime reads with All clusters, and in-place per-shop line/bar
comparison using unchanged financial helpers/readers. ID-based colors are
resolved against the full directory, so sorting/date/view filtering cannot
recolor its remaining shops. Long chart ranges aggregate monthly, never drop
records. Existing cost/export/page grants and zero-valued All Shops cards remain.
Confirmed summaries are keyed by identity/permissions, branch/filter, period and
timezone; required sponsorship reads also gate Dashboard confirmation. Initial
unknown cards remain hidden, same-scope confirmed values survive refresh/error,
and failures retain explicit notices instead of becoming zero. Charts no longer
use sliding containers. Checkout and database writes are untouched.

Corrected investigation assumption: the original beta Business Board already
uses cloud auto reads for Management, because Management business mode is
online-only. DASH69 therefore preserves that original reader byte-for-byte.
The native Management adapter/status/decimal-parity prototype is deliberately
unactivated and retained only in the local `.tmp` preparation archive; it is not
part of this runtime PR. Cold-offline/Main-only-PIN company-board metadata
availability is a preexisting limitation, not solved or newly verified here.
The existing shared Main millisecond report cursor can skip high-precision rows;
its correction/auth and metadata-read work remain separately tracked/approved.
Do not activate the prototype or broaden generic Management access implicitly.

Final UI-only focused checks:72 tests/14 suites passed; scoped lint/diff checks
passed. Synthetic headless Chrome at390/768/1440 verified the new chart controls,
stable colors through cluster/all selection, no horizontal overflow, permission
fallback to revenue, and zero interaction network requests. These are synthetic
component checks, not installed POS or signed-in whole-page acceptance. Final
TypeScript passed; independent cleaned-diff review found no scoped blocker
and31 additional focused checks passed. The first UI-only full run passed5767
tests with7 skipped and1 failure: an existing test still required sliding graph
rails, contrary to the latest owner decision. Only that existing expectation was
corrected; its category/summary carousel assertions remain. Its focused five-suite
rerun passed36 tests. Final UI-only full regression passed5768 tests/7 skipped/
0 failures of5775. Runtime feature headb91530314d2aa08e3f0b45ac999ce203d5bfd0ea
is committed in draft betaPR402 (helper commita333e84c precedes the feature).
Only14 reviewed files are included; temporary/native prototypes are excluded.
CI, deployed/installed acceptance, beta integration and production publication
remain pending. An earlier prototype-era full run was interrupted after a review
finding and is not final evidence. Do not merge/publish on the strength of this
local pass alone.

### Checkout last-unit branch rejection — prepared 2026-11-05

- Completed scoped code/tests: same-transaction eligible preimage and strict actual
  persisted stock/unchanged-catalogue verification in AggregateRepository only.
- Passed: 43 focused tests; 39 disposable full-commit SQL Server groups. Baseline
  last-unit failure reproduced before correction; fixture uses synthetic rows only.
- Pending: independent review, final compiler/lint/CI, beta PR acceptance and any
  separately authorized promotion/publication. No live DB change is needed here.
- Separate finding awaiting owner scope decision: NEW-operation-ID replay of an
  already saved immutable sale graph can repeat stock effects after a refill;
  reproduced in original beta too. Existing same-operation-ID replay remains safe.
- Rollback: revert only this scoped checkout PR; no schema/data rollback is needed.
  Membership, terminal registration, permissions and other sync work are unchanged.
- Integration/release blocker: keep this PR draft until the separately reviewed
  new-operation-ID existing-sale replay gap is resolved or the owner explicitly
  decides its rollout. Passing this narrow patch's tests is not release approval.
- Final frozen runtime verification: independent review passed 9 new unit cases
  and all 39 actual SQL groups. Full regression completed successfully: 5,777
  passed, 7 skipped, 0 failures (5,784 total), bounded to two workers. TypeScript,
  scoped ESLint and diff checks passed. Draft PR404 remains held for the separate
  existing-sale/new-operation-ID replay blocker and required CI/acceptance.

### Checkout replay correction — owner-approved extension, 2026-11-05

- Owner approved the previously separate existing-sale replay guard. Implemented
  before all financial/stock/journal writes, after exact operation-receipt replay.
  Covers INSERT/UPSERT rows and values, normalized duplicates, deterministic locks,
  concurrent same-sale IDs, partial headers and neutral foreign-branch responses.
- Frozen scoped verification: 49 focused tests and 53 disposable SQL groups pass;
  actual Main Administrator header/items/payment/receipt/journal retry is included.
  Negative-stock settings and all production data/configuration remain unchanged.
- Final expanded full regression is running; independent review/CI/installed
  acceptance remain pending. The earlier last-unit-only full pass and canceled
  expanded run are not claims about this revised head. Keep PR404 draft until
  final acceptance; no merge/deploy/publication has been performed.
- Final expanded runtime regression completed: 5,783 passed, 7 skipped, 0 failed
  of 5,790 tests (two workers). TypeScript/scoped lint pass. Independent review
  passed all 15 new unit cases and all 53 disposable SQL groups. This replaces
  the earlier preparation-only verification status; CI/installed acceptance,
  beta merge and production release remain separate. No live records changed.

## REPORT70 — exact Management pagination cursors (5 November)

Owner approved one narrow code/isolated-test batch, from betaada83bb9 in
codex/management-report-cursors-beta. Fix only the dedicated Management report
reader's SQL Server datetimeoffset(7) cursor truncation for sales and shifts.
Select an exact SQL timestamp string before the driver converts it to Date;
preserve descending(timestamp,id), existing scopes, permissions, completeness,
cost and shift privacy checks, and strip private aliases from returned rows.
Test limits1/2,100ns/same-time-ID/offset/date boundaries plus denied, empty and
incomplete cases against an owned disposable SQL database. No production data,
schema/configuration, RPC/HTTP changes, publication or merge is included.
The separate in-flight session-handover authorization race remains a tracked
proposal and is explicitly outside this approval; do not fix it implicitly.
Implementation is frozen: the reader selects an internal SQL style127 timestamp,
uses it only for the continuation cursor, and removes it before public rows and
shift redaction. Existing public Date serialization remains unchanged. Focused
report/IPC/replica/permission/configuration checks passed51 tests across7 suites
(1 opt-in test skipped); the opt-in wrapper separately passed2 tests including
all13 actual disposable SQL Server groups. TypeScript, scoped lint and diff checks
passed; independent source review found no pagination blocker. Initial SQL
fixture validation incorrectly required seven visible fractional digits: SQL
style127 legitimately omits zero fractions and normalizes offsets to UTC. The
corrected fixture proves exact SQL equality and preserved nonzero100ns precision.
Final normal-temp full regression passed5775 tests/8 skipped/0 failed of5783
(689 suites passed/1 skipped) on runtime head422daaf7. The initial restricted
full run failed on sandbox SSR-cache ENOENT imports; the same frozen source
passed after granting normal temporary-file access. Draft betaPR403 is open
and labelled beta. Exact-head CI, beta integration and installed acceptance
remain pending. The separate session-handover race is not fixed by this patch.
Membership remains ON HOLD.

## Offline approval audit persistence — approved narrow beta batch, 5 November

- Owner explicitly approved correcting only helper-generated unsupported sync
  flags for authorization_log/authorization_requests, plus isolated/device tests.
- Actual Electron ordinary cashier and Administrator last-unit checkout passed;
  actual over-limit manager PIN then failed when its audit reached the native
  column validator. Both authorization tables lack the helper-added columns.
- Implemented one conditional payload correction. Caller unknown fields still
  fail native validation; no allowlist, role, approval-failure, Membership, schema
  or other governance-helper behavior changed. Durable native journal remains.
- Verification: 12 new actual OperationsRepository validator tests and 65 focused
  approval/branch/PIN/checkout/shift-activity tests pass; TypeScript/scoped lint
  and independent source review pass. A restricted-temp import failure was rerun
  unchanged with normal temp access and all focused suites passed.
- Pending: exact-head full-suite and CI, real manager approval PIN plus durable
  audit/held-ticket payment readback, beta integration and production acceptance.
  No production merge, installer publication or business database edit included.

Final full regression: 5,960 passed / 10 skipped / 0 failed of 5,970, unchanged
runtime in a clean exact-head checkout. The initial active Electron fixture
profile caused only canonical inventory EPERM on locked Chromium blob storage.
Actual new cashier approval test captured EPRIVILEGE at Main admission: generic
`general` aggregate writes require Supervisor even after manager PIN verification.
Keep that boundary; a separate Main-owned verified-approval logging capability
requires approval and tests. PR412 fixes only registered audit-payload shape;
actual cashier approved-payment acceptance remains pending that distinct fix.

## Native offline approval capability — proposal only, 5 November

Status: INVESTIGATION / OWNER IMPLEMENTATION APPROVAL REQUIRED. PR412 is merged
into beta at8633bb294fc3b3f0cde4392c4d926abb342bcff8, with exact tested-tree
parity and passing platform/permission/Workers checks. Its helper-only correction
must not be described as a fix for the separate cashier admission restriction.

Confirmed device boundary: after the real local manager approval PIN verifies,
AuthorizationDialog tries a generic authorization_log aggregate. Main's existing
business:commit-aggregate admission requires Supervisor for general aggregates,
so an ordinary cashier correctly receives EPRIVILEGE before the write handler.
Do not remove that gate, temporarily elevate the requester, relabel the request
as a sale, trust a renderer approval assertion, or grant arbitrary audit writes.

Proposed smallest bounded implementation:
1. Add a dedicated Main-owned offline approval operation, admitted only for an
   already authenticated POS requester on the registered Operations terminal.
   Capture and recheck the native session epoch, operator, terminal/branch,
   backend/project and SQL pool/profile identity before and after every await.
2. Reuse verifySyncedApprovalPin and its canonical account throttling, independent
   approval PIN/TOTP, enabled credential, active account and branch-scope checks.
   Main must validate current effective local branch/global rules and action
   permission, roles/users, amount/ceiling, required reason and complete canonical
   bill/action binding. Renderer-supplied role/permission/limit is not authority.
   Share the existing pure policy implementation across Main/UI where necessary;
   do not copy an approximate second business-rule formula.
3. Main constructs one fixed authorization_log row from the verified requester,
   actual approver and sealed terminal. Commit only that row through the existing
   aggregate repository/journal/operation receipt, without widening generic IPC
   permissions. Return the verified audit identity only after SQL acceptance.
4. Bind a stable request UUID to the full public action/bill context. Freeze the
   exact Main-generated audit row (including created_at) after verification;
   identical lost-ack retries must reuse its exact payload, not consume a TOTP
   twice or generate another audit. Bound any Main capability cache and its TTL.
   After restart require credential verification anew, and check the existing
   audit plus exact receipt/context before acknowledging the original operation.
   An audit row alone is not proof of credential verification. Changed context,
   requester, branch, policy, role revocation or receipt mismatch stays denied.
5. Preserve awaited failure behavior and the unpaid/held ticket on rejection or
   SQL rollback. This is a narrowly verified audit capability, not a promise of
   new one-use financial-grant enforcement: the existing native financial grant
   contract must be inspected and any additional enforcement scope approved.

Expected source surfaces for review (not edited by this investigation):
- New electron/offline-approval-service.cjs with injected verifier, trusted scope,
  current-rule reader and existing transactional writer.
- electron/main.cjs, electron/preload.cjs and electron/ipc-privilege.cjs for the
  dedicated bounded IPC; preserve business:commit-aggregate's existing gate.
- src/core/local-db/local-db.ts, src/core/local-db/local-staff.ts and
  src/platforms/web/components/pos/AuthorizationDialog.tsx for the typed native
  path; hosted/mobile approval behavior remains unchanged.
- One shared pure policy module only if required to reuse the existing exact
  rule/action-permission semantics, with native/browser parity tests.
- Focused service/IPC/UI tests and an opt-in owned disposable SQL fixture.

Required allowed/denied verification: genuine cashier requester plus permitted
manager approval; Administrator parity; invalid/locked/missing PIN; independent
login-PIN rejection; disabled/out-of-scope/revoked approver; missing reason,
ceiling/mode/unsupported-action denial; modified bill and foreign branch/terminal
claims; session/profile/policy change during I/O; unsolicited and replayed
capabilities; identical lost acknowledgement and duplicate concurrent calls;
TOTP retry without a second use; SQL rollback preserving ticket and no audit;
one durable audit/journal/receipt; and real isolated Electron held20% approval
then exactly one last-unit payment with unchanged foreign stock. Retest generic
cashier arbitrary-audit denial, current checkout/replay/negative-stock setting,
authorization rules and web/mobile behavior. No business POS_Local tests.

No runtime implementation, new grants, database/schema application, production
promotion or publication is authorized by this proposal. Existing schema appears
sufficient; if implementation reveals an unavoidable schema or protocol change,
present its exact scope separately before changing it. Membership remains ON HOLD.

### Native offline ticket approval — owner implementation approval supersedes proposal

Owner explicitly approved the separate Main-owned approval-save correction and
isolated tests. Implemented only the capable Operations Electron complete-ticket
discount_over_limit path; all other approval/platform paths remain unchanged.
No generic cashier Supervisor gate, schema, configuration or financial-grant
contract is widened. Strict native POS-main-frame admission precedes verifier,
cache and SQL; denied display/child senders cannot refresh the global idle timer.
Fresh requester and approver rows, current branch scope/credential switches,
selected authorization rule and effective global/branch settings are checked and
locked before the fixed audit/journal/receipt commit. Canonical UUID case and
canonical username case are representational only; different IDs/branches deny.
Ambiguous effective rules and duplicate canonical settings hold explicitly.

Review findings corrected: unexpected-sender admission and idle touch; approver
scope/PIN/TOTP revocation after verification; requester revocation during await;
case-only UUID SQL fetch and JavaScript selection under BIN2; raw journal key
bypassing the existing pending pull barrier; truncated author/reason inputs;
platform/older-bridge routing and self-PIN identity; expired cache capacity; and
foreign/ambiguous rule baselines. Existing calculation/normalization/privacy
functions are reused exactly in packaged pure modules. No unrelated authorization
types, ticket parsing, request models or route helpers were removed.

Verification checkpoint: 58 new service/bridge tests; 73 existing policy/discount
regressions; 19 actual owned CI-SQL and 20 BIN2 groups; six real React/Radix dialog
groups. SQL composition includes real bcrypt approval verification, atomic audit,
journal/receipt, restart/lost acknowledgement, current requester/approver denial,
canonical ChangeReader identity and pending PullWorker barrier, and actual
PushWorker snapshot retry/acknowledgement with a synthetic cloud adapter. It does
not claim real hosted/Android credential acceptance or stronger inherited cloud
log-content verification. All disposable fixtures were owner/GUID guarded and
cleaned; the separate retained device-acceptance profile contains synthetic data.
The earlier active-profile full-test EPERM was a test-inventory/Chromium-lock
issue; final regression uses a clean checkout.

Pending finalization: independently reviewed frozen source hashes; final full
suite/platform CI; cold isolated Electron POS/display sender admission and final
ordinary/manager-approved payment/restart readback; latest-beta integration. No
production promotion, installer publication or real database repair included.

### Native approval final amount binding — approved correction, 6 November

Owner-authorized completion includes exact raw ticket evidence needed to validate
manual discount amounts before existing audit normalization. The current
checkpoint a4e1879a contains a confirmed new-capability gap: a forged bill base
can understate the requested percentage. The current register also divides an
item coupon by max(1, qty), which inflates the approval-context base for fractional
quantities even though the actual stock/price writer uses the true quantity.

This bounded correction adds raw coupon/discount type and manual/promotion
context to the existing snapshot builder/types, validates every item and bill
entry against that complete raw evidence in Main, and corrects only the existing
approval-context denominator to actual nonzero quantity. Audit-normalized
snapshots/fingerprints and checkout writer calculations remain unchanged. The
existing pure r2/lineDiscountTotal bodies move verbatim to one packaged module
and remain aliased from pos-types, with parity checks; no alternative formula,
rule, grant or database object is added. Affected additions beyond the checkpoint
are src/routes/index.tsx, src/lib/ticket-snapshot.ts, src/core/types/pos-types.ts,
the pure shared math module/declaration and focused tests. Main service and the
existing isolated SQL fixture also receive the complete evidence checks.

Required verification includes the forged $20/$10 bill-base case, fractional
qty0.5/price100/coupon20, amount/percent and combined discounts, bill promotions,
signed exchange lines, sub-cent rounding, omitted/duplicate/tampered evidence,
raw precision before normalization, unchanged audit privacy/fingerprint, and
existing requester/approver/branch/retry denials. No real POS data, schema,
permissions, checkout financial writer, Membership or deployment is changed.

Amount-binding verification checkpoint: all105 service/bridge/cumulative/bill
review tests and73 existing authorization/snapshot/pricing/tax/receipt tests pass;
TypeScript passes and scoped lint has zero errors (existing fixture any warnings).
The synthetic test originally lacked capturedAt, causing timestamp-only expected
snapshot mismatches; adding its fixed original instant corrected the harness.
Initial restricted-temp Vite cache ENOENT was rerun with normal temp access.
Actual owned disposable SQL composition passes19 CI and20 BIN2 groups, including
real approval PIN, lost-ACK/restart receipt checks, current revocation, canonical
pending journal barrier, acknowledged upload and whole-transaction rollback.
Both temporary database/instance pairs were GUID/owner guarded and cleaned.
Independent read-only review additionally passed3,780 old/new money-helper parity
cases,180 legitimate bills and900 tampered evidence variants, and reproduced
whole-service forged-base denial plus actual fractional amount-limit enforcement.
No remaining amount-binding blocker was reported. Final frozen-head/full CI and
cold actual Main/preload device acceptance remain pending before beta completion.
## CHECKOUT74 — shared refund trigger record-field isolation, 5 November

- Owner's urgent web-payment failure is confirmed by live metadata/logs: SQLSTATE
  42703 comes from guard_refund_fields while pos_sale_commit links an exchange.
  sales correctly has is_refunded, not sale_items.refunded_qty. A combined AND
  expression prepares the wrong record field before its table-name predicate.
- Approved preparation is limited to nested table-specific IF blocks, unchanged
  refund protections, a guarded additive migration, canonical source and isolated
  checkout/refund regressions. Live application requires exact-project approval.
- No columns, grants, triggers, business rows or operator settings may be changed.
  Membership and unfinished stock-report work remain excluded.

## SHIFT75 — report-only native Date normalization, 5 November

- Owner reports local Electron Shifts-page failure: openedAt.localeCompare is
  not a function. SQL snapshot/changed-row seeds can retain Date objects, while
  paged history already normalizes opened_at into strings before display.
- Approved fix is limited to the report merge/sort helper and hook, preserving
  exact existing timestamp strings, branch/business-day filtering, duplicate
  replacement, query authority and invalid-date handling. No active-shift reader,
  checkout selection, pagination cursor, database records or permissions change.
- Focused actual-hook and helper regressions plus TypeScript/lint are required.
  Installed Electron verification and automatic CI remain separate.
- Frozen verification: 23 focused tests across five suites, TypeScript and scoped
  ESLint pass. The initial restricted-temp history import hit known SSR-cache
  ENOENT; unchanged tests passed with normal temporary-file access.

Report ordering compares instant milliseconds plus the remaining SQL 100 ns
fraction, so mixed precision/offset strings sort correctly without rewriting
raw timestamps or pagination cursors. Equal instants retain descending ID ties.
# DEV76 — complete shared protocol loading in local previews, 6 November

The owner requested latest Electron and web previews side by side, then reported
that the local environments did not load. The web checkout had no environment
file; its process now reads the existing operator-managed root .env.local without
copying or logging secrets. A real development-server request then reproduced
`require is not defined` in shift-financial-protocol.cjs. Extend only the existing
serve-only exact-file interop to the three financial/recovery protocol companions.
Keep their native source, signed bytes, validators, permissions and build output
unchanged. Baseline beta3074a475; isolated codex/dev-financial-protocol-beta.
Acceptance: real Vite SSR reproduction, native/ESM valid and denied parity, exact
file/export/import-contract denials, focused regression, and latest local previews.
No database, registration, settings, queue or checkpoint changes. Targeted rollback
is a revert of this development-only loader correction.

Prepared validation: 60 tests across four focused suites pass, including the
actual Vite SSR failure/recovery and native/ESM signed-message/invalid-input
parity for all four modules. TypeScript, scoped ESLint and diff checks pass.
Independent agent source review found no blocker. Required CI and actual
configured preview reload remain pending; no beta/main merge or publication.
# VIEW77 — retain the shell during authorized branch changes, 6 November

Owner reports full-page loading when selecting another branch/cluster and asks
that only affected content refresh. Source confirms dataSnapshotReady correctly
rejects the prior branch snapshot, but AppShell replaces the entire workspace
while the new data/settings load. Preserve that read proof and all authorization.
Keep only a previously confirmed same-account/session/database/permission shell;
unmount protected page content while its current scope is unresolved. ShiftGuard
must not offer opening/closing actions using unverified settings. Initial setup,
sign-in, identity changes and revocation retain existing full startup gates.

Isolated baseline beta91f4961a, codex/branch-switch-presentation-beta. Scope:
AppShell presentation, ShiftGuard pending presentation, explicit branch-read
loading/error status and focused lifecycle/permission tests. No query cadence,
Membership dependency, business calculation, permission, database or queue change.
Verify sidebar/header remain mounted, old-scope page/popups are absent, current
data appears only after confirmation, errors/retry remain available, and denied
normal-terminal switching stays denied. Targeted source revert is the rollback.

Prepared verification:79 focused tests across seven lifecycle, stale-read,
permission, registration and inventory-update suites pass. TypeScript/scoped
ESLint/diff checks pass. Independent agent review found no authorization or write
blocker; its retained-data-banner truthfulness nit is corrected. Actual mounted
browser/portal verification, full regression and required beta CI remain pending.

CHART72 second checkpoint: beta79face20 is integrated at5e9d7efb, preserving the
completed dependency integration and development protocol fix. The chart color
now depends only on canonical branch identity, preserving each shop between
single-branch, cluster and company views. The actual Chrome1440/390px fixture
passed equal448px cards/fixed256px plots, two/one columns, vertical keyboard
scrolling, hidden scrollbar, no horizontal overflow, first-read hiding,
same-scope refresh/error retention, scope-change hiding, meaningful negative
profit, cost denial, in-place line/bar/month selection and15/20day presets.
It found the existing global thin-scrollbar style overriding layered utilities;
a narrowly scoped chart class now preserves the requested hidden scrollbar.

The additional hourly read is prepared, NOT applied. Candidate
supabase/migrations/20261105170645_bounded_shop_hourly_report.sql SHA256(LF)
158948DA41505425E3D79BD97160A274B9C8706115D40CEF5C318C803CA1806F adds only public.pos_report_store_hours(date,date,text[]) as
STABLE SECURITY INVOKER, fixed pg_catalog search path, service_role EXECUTE only.
It aggregates actual selected sales and existing captured/fallback line costs by
saved business timezone/hour, bounds100existing branches/3660days and returns at
most2400aggregate rows. No record/policy/existing routine or existing grant is
rewritten. Fresh server staff/report/cost and fixed-terminal/management scope
checks run before and after the read; revocation/account handover returns no
private result. Until its exact-project review/application, Business Board keeps
daily/transaction graphs and truthfully reports unavailable hourly profit.
No extra raw sale lines are downloaded. Dashboard/All Shops reuse existing
complete bounded receipts; native SQL reuses existing#facts in one query and
returns only aggregated hours to the renderer after Main's current checks.

Actual disposable PostgreSQL18.6 passed21cases (financial/timezone/refund/signed
cost/captured-zero/caller-role bounds and unknown-routine collision). Actual
uniquely owned SQLServer LocalDB passed hourly/daily parity, branch/date limits,
refund/signed/FOC/zero-cost behavior and denied forged-cost flag, then cleaned up.
Focused60tests and scoped lint passed. Full regression found the expected new
migration-inventory assertion, canonical source line-ending preservation and an
obsolete inline-grid assertion; these were corrected without changing existing
SQL definitions or loosening its privacy checks. Full final-tree rerun/type and
independent source review remain required. No live database, queue/checkpoint,
checkout, permission grant, operator profile, deployment or publication changed.

CHART72 final-source verification at12ee262557ade7140d569147291e559b95a69dfa:
FULL Node22.22.2/npm11.4.2 Vitest6037passed/10skipped/0failed,710passingfiles
plus1skipped, max2workers. TypeScript passed. All scoped lint passes, including
the last added board/security/SQL tests. Final committed migration reran all21
actual PostgreSQL18.6 scenarios successfully; disposable LocalDB and settled
actual Chrome1440/390px acceptance passed. All test processes/owned fixtures are
finished/cleaned; screenshots/logs remain only in ignored .tmp. Existing source
SQL bytes/guards are preserved. Draft betaPR419 is open/labeledbeta; CI and
independent review remain pending. No merge, deployment, database application or
installer publication occurred. Exact candidate SHA256(LF) is
158948DA41505425E3D79BD97160A274B9C8706115D40CEF5C318C803CA1806F.
The hourly routine would need separate approval against ROSEGILL→
rosegill0011@gmail.com's Org(bjxgimekljzlnwejuawj)→pos(qhrufhtbeguxydenzfey),
postgres,https://qhrufhtbeguxydenzfey.supabase.co before live application.

CHART72 completeness correction: independent review found that a SETOF hourly
RPC could silently truncate1008groups at PostgREST's default1000row cap. The
still-unapplied candidate now returns ONE scalar JSON envelope from the same SQL
snapshot, with version/complete/date/selected-branch binding and exact row_count.
The server checks the exact envelope keys, complete===true, safe-integer count
matching rows<=2400, unique authorized shop/hour rows and current authority before
and after the read. No shop/history restriction, API max_rows setting or grant
was weakened; cross-page snapshot races are avoided rather than tolerated.
New candidate SHA256(LF) supersedes158948DA…1806F:
921067FA9C5EA4F2F4F46A5B2D25976B11C73218AEB60DC5FB69B5B814D9FCB5.
Actual isolated PostgreSQL18.6 passed22cases. Actual PostgREST with max_rows1000
first reproduced SETOF truncation, then returned all1008 and2400 scalar-envelope
hourly groups with correct sums and metadata. All77 focused regressions,
TypeScript and scoped lint passed. No live database application occurred. Final
combined beta/source regression and independent re-review are required before
integration; root owns live approval/promotion.

### Native approval final device acceptance and beta refresh — 6 November

PR415 frozen runtime bdcd8f82b706b9a62ae38c802102fae2aceb3a46 passed all required
remote checks (Role & permission, Android, Windows, iOS, labels and Workers;
CodeRabbit skipped under the owner's instruction). Its clean exact-source full
regression passed6,064 tests/10 skipped/zero failures of6,074. TypeScript and
scoped lint passed with zero errors; actual SQL19 CI/20 BIN2 and six real shared
React/Radix groups passed as recorded above.

Final owned-device evidence used only synthetic database
Retail_DeviceAcceptance_20261105_8b1cb17b_A1, GUID
706e15a6-e274-41ec-a036-524b1cf553e7, with the pre-existing owner marker, sealed
synthetic registration and dedicated test profile rechecked before actions.
No real POS_Local or cloud business row was used. Actual cashier UI sign-in,
20% manager approval PIN, Main-generated audit and a last-unit card payment all
completed through the real Main/preload/register code. The one new bill is
TSTA-WIN38-20261106-0001: total16, discount4, manager linked. Durable SQL readback
shows seven sales/items/payments/sale receipts (the six earlier synthetic sales
preserved), exactly one approval audit/journal/receipt for the new bill, own
TEST-0001 stock1 to0, foreign fixture stock9 unchanged and zero active user
transactions. A later cold restart/readback preserved those exact records with
no duplicate or stock effect. Real post-restart Main PIN verification bound the
fixture staff account; the hidden-window UI animation timings were not used to
claim additional UI acceptance.

The actual separate customer-display BrowserWindow/preload and the ordinary
cashier generic aggregate both received EPRIVILEGE; the former returned the
POS-window-only denial and did not change the Main session epoch. This confirms
installed sender admission, while the isolated unit test retains its separate
idle-timeout check. Only the signed-out/idle synthetic test app was then torn
down; process exit0 was observed and all persisted evidence retained.

Limits: the network-isolated synthetic profile is an offline acceptance test,
not real hosted authorization/enrollment or Android credential acceptance. Two
earlier visible fixture sessions received close attempts with activity-log flush
errors and were then killed with exit1; the initiating cause is not established
and is not represented as an approval-code crash or a resolved shutdown defect.
Final payment SQL acceptance was confirmed before and after restart. The test
harness's missing require/global, stale scratch commands, new-origin display-name
preference and hidden-window animation waits were handled only in ignored test
artifacts; no product guard, real queue, registration or permission was bypassed.

Verified newer beta91f4961a was integrated at7e7dd2cd with no conflicts. It adds
only the reviewed development-loader correction and its records/tests; the
approval, checkout helper and native runtime bytes remain identical to bdcd8f82.
All184 focused tests across ten approval/authority/pricing/tax/receipt/interop
suites pass on that integration. Final pushed-head CI remains required; no
production promotion, publication or operator database upgrade was performed.

Latest destination refresh: verified beta79face2078ee35ebf50a51b59f0f503e6e25b1f7
(PR417 reviewed dependency upgrades) integrated at61f84e92 without conflicts.
Only package/lock/project records changed from the preceding integration; all
approval/Main/checkout runtime source bytes still match bdcd8f82. A new clean
verification checkout uses the fresh chore-beta-verification dependency install;
its parsed lock matches the integrated source exactly. Installed React Query
5.105.1, Radix toggle-group1.2.1, Capacitor Android8.6.0, electron-builder26.18.0
and CapgoCLI8.99.1 were checked without mutating a shared install. All184 focused
approval/authority/pricing/tax/receipt/interop tests and all six real shared
React/Radix dialog groups passed again on these upgraded dependencies. The full
new-head CI, final typecheck and platform checks are required before beta merge.
Earlier actual native sale/restart evidence used the prior dependency install;
do not mislabel that as another installed-application upgrade acceptance run.

CHART72 refreshed58bdb12c (includes beta41500b9) full regression passed:
6121tests/10skipped/0failed,712passingfiles plus1skipped, max2workers. The
independent reviewer reran93focused tests and cleared the scalar completeness
fix. Final display-only refinement adds actual per-shop margin% labels without
hover in the existing fixed-height/scrollable footer, hidden without cost access;
Dashboard's existing day/hour calculations are memoized on their real sales and
product inputs. No financial formula or read changed. Actual Chrome1440/390
passed again with an explicit55.6% label/cost-denial check;37 focused route,
financial and chart regressions plus scoped lint passed. SQL hash921067FA…9FCB5
and all authority code remain unchanged by these UI refinements. Final-head CI
and separate exact-project migration approval/application remain pending.

### VIEW77 mounted-browser acceptance and current-beta refresh — 6 November

The pre-refresh full suite passed 6,000 tests / 10 skipped / zero failures.
After incorporating beta00b9ec56's completed Main approval correction, all180
combined branch/settings/approval/authority tests and TypeScript passed. Only
append-only documentation conflicted; both batches' evidence was preserved.
The three runtime changes and original branch tests are byte-identical to the
previous independently reviewed source. No permission/query/data path changed.

The actual AppShell, ShiftGuard and confirmed-scope hook with shared Radix
Select/Sheet/Dialog/nested Dropdown passed13 mounted Chrome groups at1440/390.
Sidebar/header DOM and document identities survive authorized branch pending,
success and both read-error/retry paths. Prior-branch pages and nested portals
unmount, pointer/focus locks release, and no protected page/shift action appears
before both data/settings proofs. Cold/auth/identity/profile/mode/epoch/permission,
normal-terminal picker/shift-lock and revoked/unregistered gates stay enforced.
These are isolated controlled-provider fixtures, not real branch writes or proof
of backend admission; the existing branch/authority regressions remain required.
No browser exceptions, remote requests or full-document reloads occurred.
Final exact-head CI and beta integration remain; actual SQL, registration,
checkout data, pending work and Membership were untouched.

SQL73 support checkpoint: only the packager's manifest-set/order validation and
its focused test changed; all11 packaging tests, exact existing-artifact--check,
scoped lint and diff checks pass. Existing file SHA090F2403…A4730 is unchanged.
No031 draft was copied, no fresh manifest/artifact emitted and no old32 engine
cases rerun. The STOCK401 writer confirms031 remains unstable (publisher/cohort/
watermark details may change); final runtime preflight and populated-history
fixture seed are requested at freeze. Next: capture and test that frozen source
within the existing assembler, then create the concrete one-file beta PR.
No operator SQL, configuration, queue/checkpoint or permission changes occurred.
# SYNC78 — automatic guarded reconciliation, 6 November

Owner requests that sync handle a count difference automatically before asking
for intervention. Baseline beta2c51e338; scope: local comparison predicates,
counts/signatures, lifecycle recovery, existing periodic caller and focused
native/SQL tests. Preserve upload/write predicates and all pending-work/shift
guards. Reuse one coordinator lease, a bounded catch-up and affected-table
snapshot only when cloud has more rows, followed by a complete fresh comparison.
Never delete local-greater rows, clear queues or reset checkpoints. A persistent
or unsafe difference becomes an actionable review result after the attempt;
network/authorization failures retain their actual classification. Membership
dependencies/reads remain unchanged and are excluded from new automatic repair.

Confirmed read-only evidence: POS_Local GUID CEAFA630-D613-423C-8997-8A31DF70C506
has2169 products under the old ownership comparison,2166 under catalogue reads,
versus2163 in the authorized cloud catalogue. Six retained ownerless products
are outside the current cloud catalogue; three remain locally visible. Counts
alone do not establish authority to discard them. Source and synthetic regression
verification precede beta integration; no live database repair is authorized.
Rollback: revert the scoped code commit; retain all business data and evidence.

Implementation checkpoint: one unchanged, unresolved cohort gets a guarded
incremental catch-up first. Small missing tables (central count at most100) use
existing snapshot/pending/shift guards, at most4 tables per turn and10 pages per
table; normal sync runs between turns and each table is attempted once. Large
history uses its existing resumable recovery path, not a new full-download loop.
Local-greater rows stay retained for review. Scope is checked before counts,
each page apply and commit; count coverage must be complete/unique/exact.
No new Membership repair, query dependency, checkpoint reset or database upgrade.

Prepared verification:35 new lifecycle/count/scope/budget tests;54 native
pipeline/startup/event groups;18 real SQL Server #temp groups (76 queries across
two collations) exercise actual count/signature selections and unchanged write
scope. Full Windows run:6167 passed/10 skipped, with sandboxed workerd startup
and a CRLF-only test assertion failing. The three isolated suites reran24/24
outside the process sandbox after normalizing both compared test strings; no
migration bytes changed. Final merged-tree CI and local runtime acceptance remain.

## CHART80 — softer consistent charts and confirmed summary presentation, 6 November

Owner explicitly requested a separate presentation-only batch: consistent compact
chart frames, vertical scrolling without a visible scrollbar, rounded graph ends
and joins, and smooth summary reveal only after current database/scope data is
confirmed. Latest style steering means clean and uncluttered, not tiny controls
or reduced readability. Keep meaningful negatives and the approved All Shops
zero-valued directory exception. Continue a separate HMR web preview at8083
alongside existing beta web8082 and Electron8080; root owns those server processes.

Recoverable baseline: freshly fetched beta0b6f00b1, including chartPR419 and
empty-panelPR421. Branch codex/chart-softness-loading-beta, isolated worktree
work/chart-softness-loading-beta. Its package-lock matches the existing verified
dependency tree; use a junction without changing packages or running profiles.

Planned source: TradingChartLayout.tsx, ShopComparisonCharts.tsx, report-kit.tsx,
the chart/summary portions of dashboard.tsx, analytics.tsx, reports.analytics.tsx
and the existing report StatCard consumers (activity, business, catalogue,
coupons, sales, stock and voids), plus styles.css and focused presentation tests.
Reuse confirmed-presentation, SummaryCardRail motion and reduced-motion handling.
Use explicit raw numeric visibility rather than parsing formatted currency.
Preserve same-scope confirmed content through refresh/errors and hide on identity,
permission, branch or report-range changes. Keep errors and loading status honest.
Before touching an additional shared loader/status helper, establish its precise
read-only presentation need; an array alone is not proof of completed loading.

Do not alter providers, database calls/cadence, financial formulas, permissions,
Membership, business data or configuration. Test initial unresolved/zero/negative
and newly nonzero cards; confirmed refresh/error and scope/permission changes;
desktop/mobile equal frames, readable labels, scroll/touch/keyboard access and
reduced-motion rendering. Root will independently review the frozen diff before
CI/beta integration. No merge, deployment, installer or production publication is
authorized by this preparation. Targeted rollback is a revert of this UI batch.

Root approved the necessary read-only audit presentation witness/export in
src/lib/audit-log.ts after reviewing the plan. Capture current actor/session/
database mode/backend scope before the existing read and publish a witness only
after a matching successful result; keep prior same-scope confirmed cards on
refresh failure and reject stale-scope readiness. No query, hydration default,
timer, stored row, upload or authorization behavior may change. Audit reads that
have never confirmed stay visibly unconfirmed, rather than becoming zero totals.

CHART80 live preview correction: active UI web port8083 PID192228 uses the existing operator .env.local unmodified; no secret values read/copied/logged. Extra web8082/failed8083 instance stopped by root; normal Electron8080 PID173936 preserved. Initial inventory values at identical ~55.4% ratio were AnimatedMetric's650ms zero-to-value interpolation, not evidence of a partial database snapshot. Owner-approved presentation correction displays exact resolved values immediately; existing card arrival motion remains. Workspace numeric cards formerly rendered seeded values while unresolved; they now wait for existing readers. Query cadence/providers remain unchanged.

CHART80 verification checkpoint:117/117 focused tests in14 suites pass, including
audit stale-actor/session/backend responses, refresh-error witness retention,
current-scope report state, money/count zero rules, meaningful negatives, workspace
permission and inventory summaries, existing chart values and summary motion.
TSC and scoped ESLint pass with0errors/0warnings. Actual isolated Chrome fixtures
pass at1440px and390px: equal416px frames/224px plots, two/one columns, hidden
vertical scrollbar with keyboard access, exact initial inventory values, mounted
metric gates for database/report/audit and scope/permission changes, failed-refresh
retention, reduced motion, actual Reports Analytics route with four bounded cards,
all ten top items retained by scrolling, and rounded monthly line. No external
network requests, profiles, credentials, database reads or writes used by fixtures.
Full-suite CI and independent final review remain pending.

Coverage boundary: transfer metrics depend on a separate secondary read with no
exported completion witness. Core POS readiness is intentionally NOT claimed as
transfer confirmation; that domain remains a separately tracked presentation
follow-up. Audit-only web summaries likewise do not enable hydration or pretend
the current bounded read is complete historical coverage. A missing witness is
shown as unconfirmed; existing report tables/data are preserved. No Membership
change, checkout code, permissions, schema or operator settings changed.

CHART80 owner refinement supersedes the earlier two-column graph layout: use ONE
vertical stack on desktop and phone, equal compact frames and hidden scrollbar.
Sales value including sponsorship goes first when the current saved policy
includes it; revenue and gross profit share ONE graph with distinct series.
Preserve all existing queries, totals, metric permissions, grouping and selected
branch scope. Root approved necessary pure presentation color allocation over
the FULL already-authorized directory before selection/ranking/date changes:
12 clearly separated categorical hue families, never paired light/dark shades.
Allocate both revenue/profit identities regardless current cost grant; include
clear metric+shop labels and dash/marker differentiation. Over12 series remain
visible with explicit labels/styles; finite colors and directory-membership
changes cannot provide an unlimited immutable identity registry.

Independent review found two introduced dependency regressions: workspace cards
must retain same-scope confirmed values through failed refresh; verified sales
metrics must not depend on a separate sponsorship read. Correct using existing
confirmed-presentation state only, without new reads. Reports Analytics must
retain confirmed DATA, not freeze its parent-owned Daily/Monthly or Revenue/Units
controls. Add mounted successful→failed→control-change regressions. Prior117/
Chrome2-column results are historical preparation evidence, not final-head proof.

CHART80 LATEST owner correction supersedes BOTH earlier vertical layouts:
"I want graphs scrollable HORIZONTALLY. By mistake told vertically. All graph
cards same size." Use a finite native horizontal swipe/scroll rail, hidden bar,
equal responsive card width/height and fixed plot. No infinite duplication or
new dependency. Preserve sponsorship-first, combined revenue/gross-profit,
12 categorical hue allocation, all data/controls and reduced-motion support.
Update actual browser acceptance to horizontal overflow and keyboard/touch
access; obsolete vertical/two-column assertions are not final acceptance.

CHART80 latest owner interaction refinement: keep the finite horizontal chart
rail, add small Previous/Next controls and mouse drag plus native touch swipe.
Dragging must ignore controls/links/form fields and tooltip content; no global
DOM handlers or business-action interference. Investigate the actual clicked
Recharts black focus/selection rectangle in a synthetic screenshot/computed
style before applying scoped styling; preserve keyboard focus and useful
tooltips. No data/provider/query changes. This supersedes the earlier freeze
only for these explicit presentation interactions; rerun actual browser tests.

CHART80 renewed final source checkpoint:122/122 tests in15 focused suites pass
after the horizontal/combined-graph refinement and all independently reproduced
card/fragment/control corrections. Final TSC/scoped ESLint0errors/0warnings.
Actual Chrome1440/390 verifies one finite horizontal rail with equal responsive
card width/416px height and224px plot, Previous/Next edge state, mouse drag,
native touch swipe, keyboard scrolling, hidden bar and no page overflow.
Pointer-click reproduced black SVG UA focus outline (auto5px); scoped pointer
focus now has no outline while actual keyboard Tab retains a2px ring. Useful
chart tooltips remain. Today has visible actual revenue/profit points; two shops
produce four distinct categorical hues; denied profit is absent from lines and
legend; the existing sales-value graph goes first. Independent review corrected
workspace refresh retention/current hide+policy gates, independent sponsorship
readiness, unique ancestor card keys, and data-only Analytics retention so its
controls remain responsive after failures. Both synthetic browser scripts pass
these actual mounted paths without profiles/backends/business data.

The earlier obsolete full run recorded6181passed/10skipped/15failed:13 failures
were fixtures missing the newly used auth/scope context (corrected and focused
rerun passed); two workerd process-sandbox failures are being rerun outside that
sandbox. Exact final full CI and renewed independent final browser review remain
pending. Keep those limits distinct from tested affected paths. No DB/provider/
query/timer/cadence, checkout, financial formula, permissions or Membership edits.

CHART80 latest owner polish: Dashboard heading becomes "Trending graphs";
heading, displayed dates and the three connected Period/Daily-Monthly/Line-Bar
controls remain mounted together while a new date-window read is pending.
Grouping/type are local presentation only; no new requests/cadence changes.
Today summary retains its own authority/branch/day/timezone/policy identity
rather than invalidating when unrelated graph-window dates change. Rail arrows
float at the vertical midpoint of the WHOLE strip's left/right edges, disappear
at edges/no overflow and remeasure on scroll/resize/content. No boxed outer
container, no per-card arrow or business DOM listener. Prior88 full-suite run
is pre-polish evidence; refresh PR427/checks after this narrow UI-only delta.

CHART80 owner theme refinement: transparent point tooltip (no opaque box, border
or shadow), colored marker with theme-foreground names/values, readable ticks,
legends and native controls in light/dark. Reuse Recharts interaction/formatter
contracts in one scoped wrapper; the existing ChartTooltipContent requires an
unrelated ChartContainer context, so do not introduce that container or a portal.
Plot transitions hold only bound DATA/config for120ms same-authority exit, hide
unconfirmed plots, then300ms enter. Reduced motion is immediate; authority changes
are synchronous drops, timers cancel on latest selection/unmount. No artificial
zero rows or altered finance/query/permission logic.

CHART80 final polish implementation: graph content transitions use exact semantic
keys over bounded prepared plot DTOs/config (24hour/731day/2400month buckets by
selected series, top10items and authorized shop summaries), never object identity
or raw transaction-history serialization. Identical cloned data stays ready;
changed values/config animate, rapid selections cancel stale timers, mismatched
confirmed target keys stay hidden and authority changes drop old plots before
effects. Waiting states hide numeric plot footers; Today KPIs remain independent.
One shared transparent tooltip preserves formatter and labelFormatter, actual
zero values, theme-foreground text/colored dots and existing Recharts interaction.
Board giveaway measures now have five distinct colors without opacity variants;
actual light/dark Board rendering and cost-denied removal pass. Rail arrows
measure the actual CSS gap (including root15px scale), are centered on the whole
strip, hide at edges and preserve keyboard focus when an edge button disappears.

Current affected verification:134focused cases across18suites (one new assertion
was corrected to distinguish a colored indicator background from text color);
TSC/scoped ESLint0errors/0warnings. Both synthetic Chrome scripts pass actual
Dashboard stable Today KPI/control DOM, connected3selectors and unchanged read
keys for local grouping/type, graph-only pending/rapid date changes, real pixel
entry animations, waiting-footer truth, scope/permission drops, Board5colors,
transparent light/dark tooltips, font-scale arrows, mouse/touch/keyboard. This
latest source still requires its own final CI/independent QA after integration;
88f2a47b's6200passed/10skipped full-suite result is pre-polish evidence only.

# SYNC79 — three retained product projections, 6 November

Owner approves using the existing event/acknowledgement/baseline approach,
agent investigation, repair preparation and resumed Electron verification.
Exact live changes must be presented before application; no new live repair is
approved yet. Baseline beta0b6f00b1. Preserve checkout, permissions, offline work,
all unrelated features and Membership hold. Historical report401 stays preserved.

Read-only investigation identifies three STR1 ownerless products: SKU178089,
SKU178321 and SKU177040. The local copy retains1 from12October. Cloud has a
received+1 and an accepted5November sale-1 for each; matching movement receipts
exist locally/cloud. Cloud zero is supported by business actions, not merely a
newer timestamp. Once the ownerless product reaches zero, catalogue visibility
excludes its full row, leaving an ID-only/null global invalidation; consuming that
invalidation cannot update the stale local balance. It must not be treated as an
instruction to delete the row or upload the stale unit.

Prepare the smallest supported repair: assign only the three proven original
STR1 catalogue owners from NULL to STR1, preserving cloud stock0 and every other
business field. Reuse the guarded22-row repair pattern with new exact IDs,
full-row/metadata/provenance guards, independent synthetic/native PostgreSQL
tests, one honest maintenance receipt and normal history/feed effects. Show the
exact target, file/hash, rows and effects for separate owner approval. Normal
authorized sync must then adopt the already-accepted zero balance; no manual
local stock copy, duplicate sale/adjustment, queue clear or checkpoint reset.

Acceptance: unchanged cloud stock/SKU/prices/status/grants; same-cluster archived
visibility and foreign-cluster denial; normal local adoption after safe pending
checks; current Electron administrator login, SQL/cloud connectivity and truthful
upload/download status. Unknown/busy/changed records abort. Existing new-product
owner stamping and owner-preserving uploads must continue passing regressions.

Protection preflight: the canonical/native source already preserves an existing
owner against stale NULL/blank uploads, but the live sync_apply_products routine
still has the older EXCLUDED.owner_store_id assignment; the prepared29October
upgrade was not applied. This did not cause these three original NULL owners,
but could undo a repair on a later legacy upload. Within the owner's existing
owner-preservation/sync-recovery request, prepare a source/ACL-pinned additive
guard changing only that assignment, test actual captured routine/denied scopes,
and present its exact migration/hash separately with the three-row repair.
No routine, grant, schema or business row has been changed live. Apply protection
before any approved owner repair; abort unknown source or metadata.

SYNC79 verification checkpoint:25 captured-trigger PGlite +26 actual native
PostgreSQL repair scenarios pass, including competing foreign receiving, exact
replay/rollback and real lock contention. Actual CloudClient/PullWorker/PushWorker
SQL Server adoption passes6 groups with exact archive timestamps and protected
pending edits. Owner-retention guard passes61 PGlite +61 native cases,29 existing
checks and independent review; TypeScript/lint pass. Required first upgrade SHA
5669C64B22FDFE3ADDDBCE7DCBDE807EABB5099655626CD1E68C9EEE5A98CB35;
three-row repair SHA E6F3D4C4C3C36D7A2ADF1E200338CF236DCDFB4F014870BF0DA5574D484CBAB0.
No live migration or repair has run. Exact-head CI, owner application approval
and real normal-sync adoption remain. History count/feed gap is separately
prepared; no claim of all-table convergence or production readiness.

## SYNC79 applied checkpoint — 6 November

Owner explicitly approved both frozen exact files after final CI/fresh preflight.
Cloud owner guard SHA5669C64B22FDFE3ADDDBCE7DCBDE807EABB5099655626CD1E68C9EEE5A98CB35
applied first, ledger20261106024316, sameOID26279/grants/security; bodyMD5a076aea59e1cc926542052040f20465e.
Repair SHAE6F3D4C4C3C36D7A2ADF1E200338CF236DCDFB4F014870BF0DA5574D484CBAB0
then assigned only the three proven STR1 owners. Exact afterimages/stock0/SKU/prices/
archive preservation,3histories/4feeds/1audit verified. Ordinary existing Electron
sync subsequently adopted owners/stock0/archive1/versions9,12,11; existing cursor
164856→165028. GUID-guarded SELECT-only local verification; no manual local repair,
reset, queue clearing or extra movement. Full history convergence remains separate.
Next: integrate exact prepared artifact/evidence through beta after final-head CI,
complete COUNT79/history recovery and UI/report/release gates. No main/publication.

## COUNT80 applied and fleet rules checkpoint — 6 November

Owner approved exact committed count upgrade SHA731375F0F4E03520A7C648DFE790FF05AC97FA455A57CF1E3032B0D0748B9DF7.
PR426 exact0c080838 passed all required CI; root independently passed21 nativePG
CRLF cases. Fresh live source/metadata preflight matched all3 routines; applied
ledger20261106031334. Counts OID28812/bodyf5a89946adfbd7611366a7cf3b860b8e,
all original grants/config/flags and delegated/bootstrap source verified unchanged.
No business DML. PR426 merged beta53c8504a with exact reviewed treea0b371a0.
This completes count coverage capability, not missing-history delivery.

The owner then explicitly required automatic recovery for hundreds of offline
PCs, not manual per-PC SQL or ID seeding. Separate automatic-history plan now
reuses durable jobs/single lane and proposes bounded authorized index/missing-row
reads with exact-value handling and safe snapshot semantics. Implementation/live
application remain separately tracked. Root added permanent cross-platform
recovery/checkout/presentation-isolation and single-transaction-owner rules.

Realtime at11:00 had a short managed-slot handover burst; independent read-only
11:20 snapshot verified active reserved slots, no retained-WAL loss, no later
error recurrence in the sampled15minutes and no idle-in-transaction. Transaction
warnings at10:43/11:13 match the tool plus explicit file wrappers; desired source,
ACL/OID and both migration ledgers verified. No slot/restart/rollback action ran.
Future migration payloads need one tested transaction owner and new exact approval
when protected bytes change; do not reapply already committed files to clear logs.
# 6 November — PR428 exact future history and mixed-client rollout refinement

- Controlling owner-approved recovery refinement: preserve exact history evidence
  in ordinary native feed pages through the existing 15-string history read
  protocol and append-only SQL insert, committed atomically with the feed cursor.
  Generic table application must never parse/rewrite these protected rows.
- Baseline e4d5bb1221613a6397d9a2e08424dbeab975fde9. Independent owned
  Worker/CloudClient/LocalDB reproduction confirmed bigint revision and nested
  JSON rounding in both that client and deployed beta-base cf8a4847. The tested
  timestamp remained exact; no additional timestamp-loss claim is inferred.
- The unapproved/unapplied migration is refined to READ RPCs ONLY. Do not add
  the new global history INSERT-feed trigger/helper to an old/new mixed fleet.
  Fresh canonical assembly also retires only its known generated history-feed
  trigger, retaining the immutable-history guard. No live trigger is changed.
- Completed membership rechecks become 15 minutes plus deterministic fleet
  jitter in the existing coordinated lane, not a new timer/core poll. UUID pages
  are membership evidence only; payloads are fetched only for absent IDs. Until
  every relevant client supports an exact feed, new history may wait for that
  reconciliation and bounded recovery backlog; there is no immediate-feed claim.
- Sole writer verify_cloud_recovery owns new history-feed helper/tests, narrow
  PullWorker integration, membership cadence, existing migration/canonical
  assembly and affected tests/docs. Other agent source is frozen; preserve the
  unrelated dirty generated route tree. Stock401 remains deferred and untouched.
- Acceptance: actual exact bigint/JSON/timestamps in future feed hydration;
  immutable/pending rows retained; IDs/envelopes/chunks/scope/permission bounded;
  SQL rows+cursor rollback/retry together; no generic immutable MERGE; migration
  install adds no feed for old clients; single tool-owned transaction/ledger
  rollback; canonical rerun parity; final CI and independent review required.
- No live database application, registration/enrollment, queue/checkpoint reset,
  installer publication or production promotion is authorized by this refinement.
- Refined checkpoint: exact helper/actual PullWorker, completed-clock/15min
  eligibility, read-only SQL/canonical and continuation/status suites pass.
  Actual CloudClient+PullWorker disposable LocalDB8 groups passed and cleaned:
  exact bigint/JSON/100ns, page/cursor rollback, uppercase pending journal,
  immutable preservation/no payload re-fetch, context changes, lost notification
  and cold restart, and real AggregateRepository product-save interleaving before
  the exact append. The latter is a bounded transaction composition, not full
  installed checkout/shift-closing acceptance. No generic history MERGE is used.
- Independent SQL provider checks passed28 nativeLF groups including8 actual
  PostgREST checks and27 nativeCRLF groups; tool-ledger failure/replay/denied
  access preserve the immutable guard/business rows. Independent old cf8a4847
  CloudClient through guarded Workerd receives the actual captured ordinary
  product feed after read-only installation and no new history events. These are
  isolated synthetic adapters, not hosted CPU/deployed fleet acceptance.
- Canonical-only review tightened retirement to exact known enabled trigger
  definition and helper body/metadata; disabled/WHEN/body/definer variants abort.
  Latest-beta integration, full regression/CI and final independent review remain.

## 6 November — bounded hourly read timezone performance

Root reviewed the owned-provider evidence and authorized a separate minimal
current-beta correction after the Stock report was explicitly deferred. Preserve
all financial/range/scope/grant behavior and existing accepted-zone/UTC fallback.
Only exact existing UTC and Asia/Brunei names use bounded direct resolution;
NULL still falls back to UTC and every other string retains catalogue membership.
No new default/configuration, case/abbreviation/POSIX acceptance, session SET or
permission change. Refine only the unapplied hourly migration and matching
canonical function, focused SQL/provider/rollback tests and evidence. Migration
bytes/hash must be shown again before any live application. Never change428's
frozen source or migration;031/Stock report stays out of this production release.
Verification:66 focused SQL/privilege/scope/Board/native-hour cases pass, including
11 direct comparisons against original catalogue/fallback semantics. Actual
owned PostgreSQL18.6/PostgREST passes LF/CRLF late-DDL and ledger-failure rollback,
unchanged service-only ACL and complete1008/2400 scalar groups; fixtures closed.
Unchanged original full report measured213–244ms on the owned provider; prototype
same-backend UTC18–25ms/Brunei13–23ms, committed-candidate cold reads25–37ms.
Other names retain their original lookup cost/meaning. These are local provider
measurements, not livePG17 or Worker CPU. TSC passes; full exact-head CI/regression,
independent review and new exact-file application approval remain mandatory.

## 6 November — post-release automatic shift recovery investigation

Retail 1.4.82 is published at v1.4.82/980d6b2f after the explicitly approved
PR400 promotion. The owner now reports ECHANGEGAP for shifts in the installed
production 1.4.82 app and requests automatic database recovery. New beta baseline:
2bbcf144b054ee2f47d0b9c35d38b2617ef7b6a4, isolated branch
codex/automatic-shift-recovery-beta. Preserve every existing checkout, permission,
saved closing, administrator correction, queue and checkpoint. No production
promotion, publication, live DDL/data repair or operator-setting change is part
of this investigation/correction.

Three agents independently check runtime evidence, source recovery admission and
release upgrade coverage. Initial confirmed source gaps: packaged managed
upgrades enumerate 001–024 only, so installing 1.4.82 alone does not install the
optional 025–030 recovery metadata; and the startup recovery-review widget is
hidden by schema-derived tradingReady even while the data recovery gate blocks
the page. Neither is yet certified as this affected PC's current blocker.

Implement and isolate-test only the narrow recovery-review admission correction
under the owner's existing recovery implementation request. Keep actual
Administrator/Operations identity, branch, current source and migration guards;
never make incomplete data tradable or auto-approve an old closing. Runtime
writer: verify_cloud_recovery owns the startup gate/helper and focused tests.
Root owns tracker/memory and final reconciliation. Independent reviewer:
review_chore_prs; policy_implementation obtains safe read-only diagnostics.

The same recovery correction also covers truthful initial-gap diagnostics:
automaticSync currently logs synchronization.automatic.failed before attempting
the existing scoped recovery. Reproduce this sequence and change only its
reporting order: publish recovery progress, retain final unresolved failure and
actual recovery success, without clearing old logs or changing requests, cadence,
queues or checkpoints. policy_implementation owns this narrow Main/helper/tests
scope; verify_cloud_recovery retains exclusive ownership of startup UI files.

Prepare a separate exact automatic-metadata-upgrade plan before changing the
managed installer: inspect all 025–030 dependencies, schema manifests, transaction
ownership and rollout/financial activation behavior. Do not silently enable
financial/proof rules or bypass unknown/partial schema checks. Any required live
database action must be presented with exact target, SQL, hash and effects first.
Routine CT expiry should trigger bounded scoped recovery; genuine unproven
legacy closings require the already-approved audited Administrator review.

Affected production PC status remains pending read-only UltraViewer inspection;
the available local-preview logs show old Nov4 shift warnings and successful
Nov6 readiness, which does not establish the affected PC's current state.
Stock401/local031 and cashier shutdown activity logging remain next-release work.

Startup UI verification checkpoint: the actual DatabaseService snapshot has
schema-derived tradingReady=true while enabled_bootstrapping still maps to
desktopStorageRoute='pending'. The old panel predicate hid Administrator review
and both subscription/retry paths redirected too early. The narrow correction
reuses desktopStorageRoute for those redirects and requires connected, validated,
non-migrating schema for the panel; it changes no Main authority or trading gate.
Root ran 85 focused tests in six suites, TypeScript and scoped lint successfully;
independent review and 61 overlapping route/cache/state tests also passed.
Actual mounted-panel checks and final Main reporting tests remain separate.

Main reporting checkpoint: actual Main plus the real diagnostics writer/reader
reproduced five failures in eight cases before the correction. Automatic gap
reporting now waits for the existing recovery outcome, and the manual observer
encloses its original synchronization plus recovery promise. Non-error progress
does not clear old failures; unresolved recovery preserves its actual code and
allowlisted private diagnostics. Requests, scheduling, lifecycle, branch and
write guards are unchanged. Twenty-eight related tests, syntax, lint and diff
checks pass; root TypeScript and independent runtime review also pass. One
existing isolated log-line test needed the newly explicit original-failure
binding; its privacy assertions remain intact. No database operation was run.

Rendered acceptance: root ran `node scripts/test-startup-shift-review-ui.cjs
--run` using pinned Node22 and an owned headless browser/server. Twenty groups
passed at 1440px and 390px: actual startup route, NativeBoot and Radix comparison
dialog; actual schema-ready DatabaseService snapshot; retry/sign-in/completion;
cashier, disconnected, migration and rejected-proof denial; identity-change
removal of the prior comparison. The fixture aborts external traffic and asserts
zero approval/adoption calls. No SQL, configured profile or real credentials are
used. Default sandbox localhost access was refused; the explicitly scoped
outside-sandbox run passed, then closed its owned browser and server. Syntax
and lint pass. This is rendered application-fixture evidence, not installed
production-PC acceptance. Final PR430 CI remains required.

PR430 head645 CI: all platform/deployment checks passed; full regression had
6408 passed, 11 skipped and one stale source-wiring assertion in
offline-operations.test.ts expecting the removed `if (next.tradingReady)` branch.
Update that test to require the shared route helper at both redirect sites and
reject the old unsafe branch; retain every other offline/PIN/roster assertion.
Actual snapshot and mounted tests already prove the behavior. The test-only
correction passed 73 independent related cases, scoped lint and diff checks;
runtime remains unchanged. Require fresh CI after the corrective test commit.

## 7 November — all-table sync, upload acknowledgement identity

The all-table audit reproduced a journal and Change Tracking upload accepting
an unrelated successful batch ID. The journal could be acknowledged and the
checkpoint could advance before the sent operation was confirmed.

This separate beta-based correction binds ordinary acknowledgements to the
exact submitted batch ID in both upload paths, including the actual aggregate
ID used when an upload includes parents. Preserve existing receipt replay,
financial and shift proofs, branch checks, queues and checkpoint boundaries.
Missing or mismatched acknowledgement IDs leave local work pending. A matching
ID is necessary but does not resolve a missing source row, an unauthorized
delete, or unsupported zero-applied behavior. Those findings remain separate.
No SQL or live database changes are included.

Verified 418 focused tests, 49 sync/event tests and isolated SQL Server and
PostgreSQL regression suites. Exact matching no-op and replay replies remain
valid. Missing, mismatched and non-boolean success replies retain local
progress. TypeScript, scoped lint and diff checks passed.

## 7 November — approved automatic recovery-metadata implementation

The owner asked whether the guarded automatic upgrade is recommended, then
explicitly instructed “do it.” This approves implementation and isolated tests
of docs/database/automatic-shift-recovery-metadata-plan.md. It does not approve
live SQL execution, automatic DDL rollout to existing PCs, production promotion
or installer publication. Present final exact SQL/hash and target/rollout with
backup/quiescence evidence before those protected actions.

New isolated branch codex/automatic-recovery-metadata-beta starts from current
beta858f023fe543d2ae37e561eb6a42d647c62f301a. PR430 already merged there with
6409 tests passing/11 skipped, exact-tree verification and successful beta-site
deployment. Its startup admission and final-outcome reporting fixes are preserved.

Scope: existing prepared028–030 recovery metadata only (four initially empty
tables and their reviewed constraints/indexes/append-only guards), exact schema
recognition, backup verification, one transaction owner, bounded exclusive
startup installation, truthful status and existing recovery resumption. Keep
the published090F local upgrade byte-identical. Financial025/026, Stock031,
rollout activation, PINs, grants, settings, registration, queues and checkpoints
are excluded. A completed metadata upgrade is not a recovered/acknowledged shift.

File ownership: policy_implementation owns Main/database-service installer
integration, new Main-only helper and runtime unit/integration tests;
verify_cloud_recovery owns the recovery-only packager/artifact/read-only probe
contract and owned SQL Server artifact tests; review_chore_prs independently
reviews backup/transaction/scope/checkout safety and owns separate adversarial
acceptance tests if needed. Agree artifact/probe interfaces before concurrent
implementation. Root owns trackers, Git/PR and protected actions.

Use uniquely owned disposable SQL fixtures only. Do not start this candidate with
the real POS profile, reload it into a real database, inspect secrets or apply
DDL through production connectors. Automatic application in the normal preview
must remain excluded until exact-target approval. Preserve all existing qualified
offline-checkout behavior when an optional upgrade is refused; incomplete or
unproved recovery remains gated. The proposed side-by-side conflict chooser
preserves both histories and requires an actual Administrator/reason; no generic
raw overwrite or new financial correction authority is included in this batch.

Implementation safety refinement: the candidate's Main-owned automatic-DDL
policy stays disabled until the final artifact hash and live rollout are
approved. Tests may inject a pinned approved policy only for owned fixtures;
renderer/environment values cannot authorize DDL. Runtime, probe and installer
still enforce database identity, exact schema and verified backup independently.
The normal existing Electron preview remains on verified beta858, not this
unapproved metadata-installation candidate.

Package checkpoint: the recovery-only generator and three pinned artifacts are
implemented. Initial installer SHA312B3B4C040336AE979C343283D138B5D6D8CA1C8D7C732CFF000BBE192C730B;
probe0EE1FFB7CFFD8608728238BD06F3294EC0DA3EBDF3365F1308FD3C0498D26DE7;
manifestA859B6BA780C08A6FCB16FF4FCBB273DDD4BDAC5C988870AF068DB560A9A7BB1.
These are review checkpoints, not live approval. Six package checks and root's
independent generator check pass. Twenty-four original actual LocalDB cases pass
across CI and BIN2 collations, including wrong-target/caller-TX refusal, late
rollback, unknown schema, safe whole-module prefixes and unchanged090F install
followed by exact automatic no-op. That manual file leaves the core ledger24;
unknown future ledger versions stay denied. All three exact LF hashes also
survive an owned Windows autocrlf checkout. Populated-evidence/concurrency and
actual runtime startup/backup/capability acceptance remain in progress.

Caller-transaction guard refinement: actual isolated SQL reproduced that the
initial312B preparation artifact could abort an unrelated XACT_ABORTON caller
transaction on invalid target parameters before its ambient-transaction guard.
The dedicated Main path already refused inherited transactions, but the artifact
also needs that defense. Its original safe RAISERROR/RETURN guard now executes
before all parameter/implicit-session THROW checks. Actual caller sentinels now
retain count1/state1 and their pending row on refusal. No operator work was used.
New preparation installer SHA CD7AA9591B257F91372FB092990202E4D5E8E89450F39F4A3BC4D6D55CCDE62A;
manifest6F35A244E975A1E98CB13D43261BF9CC46DB9DAB1DFD23C304DF8325E3E93817;
probe stays0EE1FFB7CFFD8608728238BD06F3294EC0DA3EBDF3365F1308FD3C0498D26DE7.
The old312B artifact was never live-approved or applied. The090F manual upgrade
remains byte-identical. Pure6/root generator/Windows checkout checks pass on new
bytes; final full native and composed runtime acceptance is still running.

Implementation verification checkpoint: Main startup now wires the optional
installer behind a literal null approval pin. All three package files have
independent trusted source hashes before any SQL. Existing primary-pool and
temporary-session GUID/canonical-name proofs must match even for a no-op.
The installer recognizes only reviewed whole-module prefixes, backs up through
the SQL server's configured directory, verifies COPY_ONLY/CHECKSUM/header BindingID,
and executes the single SQL-owned transaction. Matching installations skip backup
and DDL. Busy startup retries use only the existing schedule while data stays
gated; qualified trading and stable backup/schema/approval denials never start
background DDL. Shutdown/barrier/control ownership and prior pause are preserved.

Read-only progress reports the actual package/probe/backup/verification/install/
readback stage without exposing paths or clearing an unresolved shift-data
warning. No metadata result acknowledges a closing or qualifies incomplete data.
Two hundred seventeen related runtime cases and 38 independent adversarial Main
cases pass (overlapping suites); syntax, lint and TypeScript pass. The final
recovery-only artifact passes 28 actual SQL Server groups across two collations;
the runtime passes seven owned database groups. Both native runners cleaned only
their owned databases/files and leave the090F manual file unchanged.

Native limitation is explicit: unmodified LocalDB returns no default backup
directory and was correctly refused with no DDL. The successful owned runtime
case substitutes only that directory-property reply with its owned test folder;
COPY_ONLY, VERIFYONLY, HEADERONLY, installation and readback are real SQL. It is
not proof of the affected SQL Express PC's path/permissions or signed-in recovery.
No live profile was launched. Root full regression and exact-head PR431 CI are
running before beta integration; rollout and live SQL approval remain separate.

Full-suite compatibility refinement: the first root run passed6520 cases and
failed one unchanged DatabaseService no-hook connection test. The new optional
call evaluated credentials eagerly even when no installer was configured. Pass
the already validated/saved profile, retaining the hook's fresh saved-credential
checks before/after preparation. The original seven state-machine tests now
pass unchanged; two added enabled-hook save tests prove accepted matching identity
and held mid-operation profile changes. Final focused116 and independent105
cases pass (overlapping suites); full regression is rerunning on frozen sources.
No SQL artifact, approval policy or existing assertion was weakened.

## 7 November — all-table sync, in-page dependency order

The owner requested a correction across all sync tables and relationships.
This isolated beta-based batch addresses a confirmed local apply defect.
The registry verifies 70 table decisions and defines 36 foreign-key edges.
Table-level ordering excludes self references, so a cloud page can list a
category, store or transfer child before its in-page parent and fail the
local SQL constraint.

Order in-page inserts and updates using self-reference columns in the
existing registry. Keep pending-work, authorization, conflict and delete
behavior, and preserve each record's repeated operations in their original
order. Missing parents outside the page still rely on the SQL constraint and
rollback without advancing progress. A bounded exact-key fetch for that
separate case needs a designed, authorized read contract. This batch adds
no new network read, database migration, or live operation.

Seven focused ordering tests, 64 overlapping runtime tests, scoped lint and
diff checks passed. The owned SQL Server fixture applied a reversed feed page
across all three relationships. A page with a missing parent rolled back and
kept its cursor, and the scoped snapshot retry succeeded when both records
were present.

## 7 November — reviewed held-sale recovery before STR1 shift reconciliation

Owner approved implementation and testing of the remaining recovery. Start
from beta 1666da5b, after verified PRs 433, 434 and 435. Keep checkout, the
existing branch and receipt entitlements, pending work and checkpoints.
Live data/schema application and production promotion remain separate.

The six saved STR1 sales were missing locally when checked. Expired Change
Tracking and a matching bill number do not establish the local cart's exact
history. The private completed-hold cleanup marker can establish the cloud
hold-to-sale link, but it does not record the retained cart's before-image.
Require a real current Administrator for legacy cases that lack exact
matching evidence. Preserve the local before-image and decision before
completing an exact matching hold. Use the existing sync lane and confirm
the committed sale graph locally. Recover no unverified sales or payments.
After held recovery, recheck the shift graph and use the existing reviewed
decision flow for any remaining discrepancy.

Work in parallel on the bounded authorized cloud read, the verified local
review and adoption transaction, and the startup review UI. Define and test
the exact SQL artifacts in isolated databases. Do not activate the existing
automatic metadata policy or introduce broad historical receipt access.
Verification must cover checkout retries, no duplicate charge or stock
movement, active cart changes, wrong branch/operator, lost response,
disposable SQL Server and PostgreSQL, and actual device acceptance.

Isolated acceptance passed for exact cloud receipts (including cash
over-tender and zero exchanges), same-branch sibling terminal denial, and
reviewed recovery with expired local tracking, no additional charge or stock
write, atomic rollback and lost-response replay. The hosted reader adds one
service-only STABLE function with no data writes or table grant. File
`20261107060000_reviewed_held_sale_graph.sql` SHA256
`982A6843BD6ACDEA26714751E8BB24FDEBE364679B362AB8E5D7A26B283B0369`.
Local `held-sale-review-metadata.sql` adds one empty review table, checks,
primary key and append-only trigger. SHA256
`2AD9AA0DB7EE7427BBEC8E8E7750B6829ADACF6B98A9FDE195A4F99E6942A08F`.
The previously prepared shift review metadata is independent. Keep cloud and
local application disabled until exact-target review and backup verification.
Actual affected-PC recovery and installed-platform acceptance remain pending.

## 11 November — Electron saved-settings restore correction

Owner requested agents to fix the beta.4 Electron recovery message saying saved
settings could not be read. Baseline is beta `5011a42b`. Scope is local startup,
original registration restoration, independently readable connection settings,
safe diagnostics and focused isolated tests. Production, installed profiles,
direct credential repairs, schema/data changes and another installer publication
are excluded.

Confirmed source defects: failed retained-registration recovery stops the cloud
and backend readers before they run; its ordinary native write channel requires
administrator authority after provisioning, while sign-in waits for restore.
Recovery currently hides each cause behind one unreadable-settings message.
The affected PC retains connection/config files but lacks its full native
registration; file presence does not prove DPAPI readability or the exact error.

Restore only the original verified registration through a dedicated bounded
native recovery operation. Preserve normal activation permissions, strict vault
reads, last binding, current operator project/backend and pending local work.
Read connection settings independently for recovery, retain unknown registration
when verification fails, and never expose new activation or trading privileges
from an unreadable or unverified registration. Check real pre-login IPC gating,
same/foreign binding and project, failed/changed context, offline/retry and the
actual renderer/native restore path. Revert this scoped source change to roll
back; no database or profile rollback is required.

Implemented the bounded native restore with strict proof/project/binding and
read-back checks, pre-login main-frame permission, and existing close/metadata
barriers. Ordinary registration writes retain administrator requirements.
The single profile coordinator now reads saved cloud/backend values after a
registration failure and reports typed partial recovery without opening normal
startup. Recovery shows readable connection fields and keeps unknown activation
and branch binding protected. Changed settings can retry the same recovery.

Verification: 219 focused Vitest cases across 16 suites and 18 startup/updater
Node cases passed (237 total), along with native syntax and scoped lint/diff
checks. Changed files have no TypeScript diagnostics; the local full dependency
tree is incomplete, so exact-head clean-install CI remains required. Independent
review found no remaining scoped blocker. Installed-device recovery has not been
performed; production and installed profiles remain unchanged.

## 12 November — beta.5 original-binding recovery failure

Owner requests agents to fix the displayed registration recovery pending and
main startup error, then publish beta. Baseline: beta `b8a9a781`. Read-only
installed diagnostics confirm beta.5, readable configured connection status,
missing complete native registration and repeated
`EACTIVATION_RECOVERY_BINDING` at validation. No live values were decrypted.
The exact compared field is not recorded by the old diagnostics.

Independent real-module fixtures confirm that minimal previous-binding markers
are compatible. The actual source defect is legacy-first candidate selection:
old plaintext A hides valid sealed B; a later failed sealing can produce the
reverse. Recover at most the distinct retained candidates through unchanged
native identity/proof/project checks. Publish only after native read-back,
preserve retained evidence, and stop on changed native context or unreadable
authoritative storage. Do not accept different branch/token identities merely
to remove the error.

Add strict previous-marker reads and fixed diagnostic reasons; separate an
individual candidate's project mismatch from a changed native context. Carry
safe whitelisted registration errors to Recovery and main startup so readable
connection settings are not reported as unreadable. Focus tests on both copy
orders, true mismatch, missing/corrupt marker, rejected proof, changed context,
existing permission and close barriers, and actual rendered messages. After
passing focused checks and exact-head CI, merge beta and publish the next beta
using the existing isolated workflow. Production, database/schema changes and
direct installed-profile/credential repairs are excluded. A scoped source
revert is the rollback; no data rollback is required.

Implementation now checks at most two distinct retained formats through the
same native verifier and read-back, preserving both saved artifacts. Candidate
project mismatch is separate from global context changes, strict marker reads
distinguish unreadable storage, and fixed mismatch reasons cannot affect the
binding denial. Both startup and Recovery show whitelisted registration causes
while keeping activation/trading closed on failure. Malformed-present records
remain unknown rather than being classified as a fresh device.

Focused verification passed: 246 Vitest cases across 16 suites plus 18 Node
startup/updater cases (264 total). This includes real renderer-to-native tests
with actual minimal markers in both stale-copy orders, exact identity denials,
storage/context/read-back failures, safe rendered messages and existing revoke,
unpair and close/update protections. Scoped lint, native syntax and diff checks
passed. Installed recovery is still unverified; no live profile was modified.

## 12 November — Emergency Access registration lockout

Owner reports beta.6's original-binding error and inability to register after
unlocking Emergency Access. Installed diagnostic reasons now confirm token
mismatch, not a connection-read failure. Baseline: beta `d24b0f0c`.

Provide an explicit repair/re-registration choice after the existing Emergency
Access credential gate. Use a native preflight to refuse unreadable identity,
unauthorized sessions and unverified/pending previous local work before any
new token claim. Keep the final authoritative write checks. Use a dedicated
native connection action for the previous saved SQL profile; the verified
recovery session can authorize connecting it without restoring the old terminal
first. This does not edit the target, save settings or run schema/bootstrap
changes. Missing/unreadable previous SQL remains unverified, and a different
empty database cannot certify pending work absent. Do not clear the previous
binding or saved artifacts. Preserve ordinary
startup denial and do not grant a fresh-device or trading state from failed
recovery. Correct retry notifications to show the fixed registration reason.

Test actual repair UI transitions, native allowed/denied cases, pending work,
closing/context changes, recovery-only saved SQL connection, expired repair session, and
normal startup/activation compatibility. Production, database/schema execution,
manual profile/credential changes and bypassing pending-work checks are outside
scope. A scoped source revert is the rollback; retained data stays untouched.

Implemented the explicit review/check/activation path behind the existing
Emergency Access gate. Both new native methods require the trusted POS main
frame and native administrator/recovery authority. The connect action uses
only the retained vault credentials and saved SQL target, under the sync lease;
it does not save settings, enable SQL, migrate/bootstrap or grant trading.
The read-only check covers durable journal/conflicts, intermediate closings,
shift intents, unaccepted/unadopted legacy events, sale outbox and store edits.
Unknown optional schema stays blocked; absence requires the existing dbo
visibility contract. Final reassignment repeats checks, while genuine first
activation and exact-original mirroring retain their prior behavior. All
terminal writes now join the close barrier. Retry toasts show fixed safe
registration reasons. Late UI results and expired claim authorization cannot
reopen a stale editor or consume a token through the repair path.

Limitations: the previous-binding marker contains no historical SQL database
GUID. This checks the retained saved target, not every database ever used by
older versions. Evidence-only legacy previews are not pending-queue flags;
their historical classification requires the existing graph-review workflow.
No installed profile was changed or decrypted. Actual affected-device recovery
is unverified, and missing/unreadable saved SQL configuration remains a real
prerequisite rather than being treated as zero pending work. The same ongoing
owner request includes agents and beta publication after checks; exact-head
CI, beta integration and publication evidence remain to be recorded separately.

Final focused verification: 149 integrated cases across 8 suites (native IPC,
repair UI, Windows manual/pairing claims, recovery profile/navigation and
startup rendering), plus 116 existing registration/settings/revocation cases
across 8 suites passed. All 23 shutdown/updater Node cases passed. Native agent
also ran 149 adjacent activation-boundary/store/recovery-metadata/legacy-runtime
cases; these overlap the above and are not an extra unique total. Scoped lint,
native/preload syntax and whitespace checks passed. Local TypeScript reported
zero changed-file diagnostics; 67 unrelated missing-dependency diagnostics in
the shared installation require the clean CI environment for full typecheck.
Independent changed-path review found no remaining blocker after preserving
first-run and readable-full-native mirroring, joining terminal writes to the
close barrier, and rejecting changed claim connection snapshots.

## 12 November — lifecycle rules first; beta.7 saved SQL recovery remains open

Owner reports beta.7 still cannot accept a replacement activation because the
saved local database cannot be verified. The owner then requests a side-by-side
description of startup, activation, login and related boundaries first, as the
basis for permanent AGENTS.md rules. Hold dependent runtime changes while the
required lifecycle is explained and unresolved recovery policy is identified.
Baseline: beta `ff9f2dd7`; isolated branch
`codex/registration-local-state-recovery-beta`. Production stays excluded.

Read-only agent audits confirm that genuine first activation has no previous
SQL prerequisite, while current replacement repair requires a valid retained
`localDatabaseProfile`. Its absent/invalid/unreadable target is not evidence of
an empty database. The reported DATABASE_UNKNOWN path remains unresolved; the
beta.7 source/tests/release did not establish affected-device recovery.

Also track before further activation changes: terminal:read returns config/null
without the native historical provisioning classification. If every full
registration copy is missing, the renderer may offer normal activation even
though Main still has an old provision marker; a hosted claim can precede the
final native denial. Classify verified-fresh versus recovery-required before
claiming. Do not fix either case by clearing markers, saved setup, queues or
checkpoints, accepting different identities without authority, or connecting an
arbitrary empty SQL database as proof old work is clear.

The rule discussion must preserve existing owner decisions: Operations stays
branch-locked for all roles; Management scope and device admission are separate;
approved SQL-unavailable online fallback preserves uncertain/pending work;
Emergency Access grants only allowlisted repair authority. Current Management
local IPC restrictions and offline credential freshness limitations are actual
implementation constraints, not new owner-approved policy or completed work.
No source, installed profile, schema/data or deployment changes were made in
this follow-up audit. Proposed next step is owner-facing lifecycle mapping,
then exact agreed AGENTS rules and a scoped recovery implementation.

### Owner clarification — connect saved SQL during startup

Owner requires the saved local SQL connection to open automatically during
application startup and reach verified readiness; it must not wait for Settings,
staff login or the first sale to initiate connection. This clarifies the database
readiness row and preserves DEC-15's approved unavailable-SQL fallback, existing
operator enablement and schema/data approval boundaries. Record this requirement
in AGENTS.md and project memory. It does not resolve the separate missing saved
profile / replacement-registration policy gap above.

Read-only source verification at `ff9f2dd7`: Electron's normal app.whenReady path
shows its startup window, calls databaseService.restore(), then schedules the
required local bootstrap. The service restores vault credentials, validates the
saved target and opens its native pool; the UI observes canonical connected and
tradingReady states. Automatic startup connection therefore already has an entry
point; affected-device success is unverified. Only documentation was changed for
this clarification. No runtime tests were necessary for this documentation-only
change; whitespace/diff inspection is the relevant check. Missing profile,
startup failures and registration recovery remain separately tracked.

### Owner authorization — online operation and replacement recovery without local SQL

Owner now explicitly requests agents to fix re-registration and clarifies that
an unavailable/unconnected local SQL database must use the configured online
database. Implement the bounded online recovery route on this beta branch.
This supersedes the blanket local-SQL prerequisite for explicitly authorized
online replacement; it does not certify missing local data as empty or erase it.

Provide an explicit Continue online action behind existing native recovery
authority. Preserve prior binding, saved SQL settings and retained registration
evidence in a Main-only sealed recovery record before a replacement claim.
Keep previous local storage held from native reads/writes, reconnect/bootstrap
and sync under the new identity until separately verified recovery; use the
existing online adapters and account/branch checks for current operations.
The hold must survive restart, update and interrupted activation. No generic
config/renderer flag may create or remove authority. New activation still
requires hosted proof/canonical validation, native persistence and read-back.
Ordinary valid-registration SQL startup/reconnect and fallback stay unchanged.
Classify historical native provisioning before any fresh hosted claim.

Scope: native recovery store/IPC and storage routing, recovery UI, minimal bridge
types, focused allowed/denied/restart/expiry/context/pending-data tests, and beta
PR. No production, live data/schema edits or profile resets. Source rollback
must retain the sealed hold and prevent older source from reopening held data;
document that limitation rather than claiming a simple binary downgrade is safe.
Installer publication remains subject to the explicit publication rule.

Implementation: Emergency Access now offers Continue online and re-register
after an unknown/unavailable SQL check. The native action verifies its POS
main frame and recovery authority, refuses connected/busy SQL and already
accepted local control work, then atomically seals prior binding, settings and
bounded retained evidence. It saves the explicit online choice (SQL enablement
false), preserves the original value in the archive, and uses the existing
online adapters. No SQL query, migration, queue acknowledgement or data rewrite
is needed to permit the online replacement.

Native service/IPC/startup/sync gates hold old SQL across restart and updates;
the UI reports its work as pending recovery. Hosted canonical project/device/
proof checks and native persistence still gate replacement success. Repeated
authorized recovery attempts append prior pins/contexts (bounded16) rather than
clearing them. Connection corrections before a claim require another explicit
online choice; status does not silently retarget or advance an attempt. Native
historical provisioning is now checked before a renderer can offer fresh
activation when all full saved copies are absent.

Focused verification passed: 527 Vitest cases across23 affected suites,
including actual IPC wrapper, canonical verifier, startup/bootstrap, vault,
UI and original-registration paths, plus25 shutdown/updater Node cases. Scoped
lint/native syntax/diff checks passed. Changed-file TypeScript diagnostics were
zero; the shared local dependency tree still has67 unrelated diagnostics and
clean CI remains the full compiler/build gate. Independent review found no
remaining blocker after the accepted-control race and repeat-attempt fixes.

Current affected-device execution is not verified. No live profile, SQL/cloud
data/schema or production state was modified. Old local recovery/reconciliation
remains distinct from online operation; it is not reported as completed. Keep
the sealed record and saved disabled-SQL choice on rollback; older binaries do
not enforce the new hold gate if an operator manually re-enables SQL. Prefer a
reviewed forward correction while prior data remains held. Beta PR/CI/merge and
any later owner-requested installer publication must be recorded separately.

## 13 November — approved terminal, staff and Settings workflow rules

The owner approved the proposed T1–T24 terminal/login/permission rules and
S1–S14 Settings rules, including the complete Settings/subpage responsibilities.
The later T10 clarification controls: automatically synchronize all eligible
PIN users and protected sign-in verification data to the terminal's authorized
local SQL scope, including people who have never signed in on that PC. Provision
this through registered-device authority, independently of the current person's
session. A person's granted actions within their authority require no additional
approval PIN. Separate approval rules still govern actions beyond that authority.
Remove the manager-not-signed-in example from T10; it is not a login prerequisite.

The owner also requests rules for Home, Selling, Inventory and the remaining
operational pages. Document these using the existing approved branch, financial,
stock, booking, reporting and recovery decisions; preserve Membership ON HOLD.
This batch writes permanent instructions and the linked workflow reference only.
It does not authorize changing runtime permissions, financial policies, database
schema/data, production or publishing another installer.

Baseline: refreshed beta `a15b83c7e095c6fcd65d0db3079dd363f921f816`;
isolated branch `codex/staff-settings-permission-rules-beta`. Affected files:
AGENTS.md, docs/pos-workflow-rules.md, this tracker and PROJECT_MEMORY.md.
Acceptance: preserve existing instructions; record the corrected T10/T13/T15;
cover current Settings cards, tabs/aliases and operational routes; distinguish
requirements from verified behavior; validate links, coverage and scoped diff.
Documentation-only verification needs no application regression run. Git history
at the baseline is the recoverable prior rule set; revert only this scoped patch.

Documentation written and checked: T1–T24 and S1–S14 each appear once; all 102
current non-API page routes are covered, including dynamic detail routes and
Settings/report compatibility links. All 4 relative rulebook links resolve and
the scoped whitespace check passes. Only the four listed documentation files
changed; no application regression suite ran for this documentation-only patch.
Beta [PR #467](https://github.com/amirosesingh/retail-pos/pull/467) targets beta
and is labelled beta. Automatic repository/Worker checks run under the existing
workflows; their result and merge are separate from the local documentation
checks. This PR does not dispatch an installer release.

Permission malfunction reproduction, runtime audit against the approved rules
and any implementation remain pending separate scoped work. Do not mark them
complete because this rulebook is saved or merged.

## 13 November — explicit cluster and branch workflow rules

The owner requests permanent cluster-based and branch-based rules alongside the
approved page workflows. Extend the existing rulebook and AGENTS.md using current
approved catalogue, location, device/account scope, stock availability, settings,
reporting and synchronization decisions. Record requirements separately from
observed helper behavior and unresolved runtime verification. No new entitlement,
financial policy, private-stock enforcement, warehouse ACL or Membership work is
authorized by this documentation request.

Baseline: refreshed beta `3df486702a0a3933f78e96625dea0f29dab96a3e`;
isolated branch `codex/cluster-branch-workflow-rules-beta`. Scope: AGENTS.md,
docs/pos-workflow-rules.md, PROJECT_MEMORY.md and this tracker only. Preserve the
existing T/S rules and page mappings. Cover same-cluster catalogue versus branch
quantities, transferred-product visibility, global SKU identity, Operations versus
Management, branch staff/PIN scope, inheritance, initial/push/pull/recovery scope,
report selection and safe reassignment. No runtime/schema/data/deployment changes
or installer publication are part of this batch; production remains excluded.

Acceptance: unique C/B rule IDs, explicit scope/example matrix, valid relative
references, preserved previous instructions, unchanged existing rule/page coverage
and clean scoped diff/whitespace checks. Use documentation checks only locally;
retain automatic repository checks for the beta PR. Git history at the baseline
preserves the previous rules; rollback only this documentation patch.

Documentation completed locally: added 14 cluster and 18 branch rules plus eight
scope/acceptance scenarios. Validation confirms all 70 T/S/C/B IDs are unique,
the previous rulebook and AGENTS instructions remain intact, all 102 current
non-API routes and 38 Settings destinations remain covered, relative links and
anchors resolve, and whitespace checks pass. Only the four listed documentation
files changed; no local application regression suite was run. Beta PR/automatic
checks and merge are recorded through the branch's GitHub review separately.

The reported permission malfunction and broader rules-compliance audit remain
pending; documentation does not close them or certify runtime enforcement.
