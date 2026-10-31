# Shift closure synchronization correction — SHIFT-14

Prepared on 30 October 2026 from source baseline `750a8c97`, beta PR342.
Owner approved correction code/isolated tests and subsequently explicitly approved
the exact live migration. It was applied on ROSEGILL pos at23:59:38Brunei,
30October, recorded as live migration20261030155938. Membership is unchanged.

## Confirmed defect and limits of incident evidence

The actual PushWorker and the existing PostgreSQL routine reproduce this failure:
local CLOSED revision1 versus central OPEN revision1 applies zero shift rows, but
returns `ok:true`. The worker then clears its durable pending transaction. An
aggregate's total applied count cannot prove that its shift closure persisted.

The affected terminal reported version1.4.79. Its original row revision and outbox
error are unavailable, so the reproduction does not establish its exact historical
cause. Both incident shifts subsequently closed through successful direct online
requests; no agent repaired their records. This PC's separate migration20 syntax
correction must not be blamed for another PC's earlier closure incident.

## Prepared database change

Separately approved target:

- Connector: ROSEGILL (connector link nickname `beta` does not imply isolation).
- Organization: rosegill0011@gmail.com's Org (`bjxgimekljzlnwejuawj`).
- Project: pos (`qhrufhtbeguxydenzfey`).
- URL: https://qhrufhtbeguxydenzfey.supabase.co.
- Migration: `20261030153259_confirm_shift_closure_sync_acknowledgement.sql`.

The migration adds three service-only, SECURITY INVOKER helpers. They assert
same-branch shift ownership and compare closing facts: status/state, timestamp,
operator, counts, expected values, closing float, variances and closing metadata.
An ignored non-equivalent closure raises a conflict, rolling back the aggregate
and its receipt. A semantically equivalent equal/higher-revision replay succeeds.

It adds that postcondition to the existing `sync_apply_shifts`, plus a versioned
per-shift acknowledgement to the existing batch/aggregate routines. Old receipt
replays are checked too. Guarded definition replacements preserve current scope,
catalogue, privacy, authorization and other-table amendments; unexpected anchors
abort the migration. It does not rewrite shifts, sales, stock, amounts, counts,
prices, credentials or user grants. Existing sync function privileges are retained.

Native code requires that acknowledgement before clearing a closure journal entry
or advancing its change-tracking checkpoint. An older server without the guard
leaves the closure pending with a diagnostic instead of silently accepting it.
Do not roll out that native change as a completed live sync fix before reviewing
and applying the database dependency.

## Related source corrections

- Client/native audit reports say **Shift closure reported**; an independent audit
  upload is not proof that the central shift closed. Direct confirmed wording
  requires a same-ID/same-branch persisted closed row. Rules, recipients and event
  identities remain unchanged. Long reports retain their text and remain valid.
- Confirmed same-branch shift-row updates reconcile the cached active shift.
  Empty, failed and obsolete branch/session reads do not fabricate a closure.
- Explicit semantic conflicts are not retried five times immediately, even if a
  gateway returns HTTP500. Ambiguous network timeouts retain stable retry identity.

## Verification and recovery

`node scripts/test-shift-closure-sync.mjs`:20 isolated PostgreSQL scenarios passed,
including the original reproduction, new/replayed receipts, conflict rollback,
two closures in one aggregate, equivalent retry, branch collision/denial,
lost-response PushWorker replay, unchanged open/unrelated uploads, privileges,
repeat application and generator parity. Independent agent review also passed.
The script is included in CI. Source/runtime guard, notification and refresh tests
are recorded in TASK_TRACKER.md with final revision/check results.

No real closing count, sale, stock correction or notification was submitted.
Installed-device offline/reconnect acceptance remains separate. Before any live
application, recheck the current routine definitions and preserve those definitions
for reviewed rollback. Do not replay the full schema. A source-only rollback is a
revert of this bounded correction; retain the database integrity guard unless a
reviewed replacement is required. Never roll back business records to hide a sync
conflict or automatically replay a second closure to repair history.
Post-application readback confirms all3existing routines contain the closure guard
and the3new helpers are SECURITY INVOKER/service-only (no anon/authenticated
EXECUTE). Both incident shift snapshots retained revision4/statusCLOSED and their
existing closing timestamps. A read-only invocation on those existing closed
rows returned acknowledgement version1 with both same-branch revision4 proofs.
No real shift transaction was submitted. Installer
rollout/affected-device reconnect acceptance remains separate from this migration.

## Revision-trigger correction: version2 applied after exact approval

The first fixture omitted the real shift triggers. Subsequent tests with all seven
canonical triggers found that PostgreSQL's enabled revision trigger stores OLD+1,
while a disconnected PC may have accumulated several revisions. Thus comparing
cloud revision>=incoming could reject a valid closure after its facts were saved.
For example, cloudOPEN4/localCLOSED8 produces cloudCLOSED5, not revision8.

Additive migration20261030164829_bind_shift_closure_proof_to_requested_revision.sql
replaces only pos_sync_shift_closure_ack. It preserves the exact closing-facts,
ownership, duplicate, state/timestamp and service-only checks. Version2 reports
the actual positive cloud revision and echoes requested_row_version. Native code
binds that requested version to its exact snapshot instead of comparing independent
revision clocks. Applied version1 and the global revision trigger are unchanged.

Twenty-four scenarios now install all seven actual triggers, reproduce the
version1 false conflict, and verify gapped local/cloud revisions, batch recovery,
unfinished-ticket rollback, equivalent replay, semantic conflicts and lost-response
PushWorker retry. Independent reviewer reran all24 plus25 native cases successfully.
This corrects the scope of the earlier20-case evidence; those earlier passes were
not sufficient trigger-integration verification.

On31October the owner separately approved the exact corrective migration.
Preflight confirmed ROSEGILL pos/org/ref above, the original version1 helper,
all seven enabled shift triggers and service-only SECURITY INVOKER privileges.
The prior definition/ACL/schema metadata is saved locally in ignored
node_modules/.cache/shift-proof-v2-preflight-20261031.json for reviewed recovery.
The unchanged committed SQL was applied once, successfully; live migration
history recorded20261030234442 (31October07:44:42Brunei) with name
bind_shift_closure_proof_to_requested_revision. Supabase assigns that application
timestamp independently of the reviewed source filename20261030164829.

Post-application catalogue readback confirms version2/request-bound proof and
unchanged service-only privileges (PUBLIC/anon/authenticated execution denied).
The empty validation returns version2. Read-only validation on the latest two
existing CLOSED rows returns actual revision4/requested revision9 for each,
demonstrating independent clocks without changing those rows or counts.
All24 actual-trigger isolated scenarios passed again before application.
Security advisor categories/counts are unchanged; none identifies this helper.
Those existing advisories are not a full security clearance or newly authorized
configuration changes. Installed-device closure/reconnect acceptance remains
unverified; do not describe read-only validation as a real till closure.

Existing legacy1.4.79 clients
ignore additional proof fields; any version1-aware preview needs the version2
native source/restart alongside the corrected helper. No real closure was submitted.
Keep the PR draft until its remaining independent UI/notification checks pass;
live dependency readiness alone is not merge or installer publication approval.

## SHIFT-15: deployed entry-point context compatibility

On31October the owner reported a production cashier opening a shift locally
without a central update. ROSEGILL pos was healthy, but the local-day log window
contained245 aggregate400responses. PostgreSQL context explicitly traced
SYNC_BRANCH_FORBIDDEN through pos_sync_assert_shift_ownership, sync_apply_shifts
and the five-argument aggregate. The active STR1 PC reports1.4.79.

The deployed validated aggregate/batch set pos.sync_terminal but omitted
pos.sync_branch. The newer ownership guard requires that context even for OPEN
rows, so legitimate uploads failed. Earlier fixtures already supplied both
settings and missed this deployed-definition compatibility case. This is an
upgrade regression, not evidence that cashier grants should be widened.

The owner approved preparation/tests and separately approved exact application
of20261031031945_preserve_validated_branch_context_for_shift_sync.sql to the
ROSEGILL organization/project/ref/URL above. A single atomic guarded DO adds
transaction-local pg_catalog.set_config('pos.sync_branch',p_branch_id,true)
immediately after existing terminal/branch validation in only the five-argument
aggregate and seven-argument batch. It preserves each installed definition's
other amendments, grants, owner, security mode and search path. Already-correct
routines are byte-preserving no-ops; unexpected anchors/additional branch logic
abort the entire change. Legacy terminal-free overloads remain byte-identical.

Root saved prior definitions/metadata in ignored
node_modules/.cache/shift15-preflight-before-approved-application-20261031.json.
Reviewed file SHA256:
19B0B0B16D1055A926406FED4758A5B4B9AE998168E9FCD876BC98E361AE034F.
Application succeeded once at11:25:45Brunei,31October; live history20261031032545.
Readback matched the exact one-statement insertion in both functions and retained
postgres/service_role-only ACLs and all metadata. Empty closure proof remainsv2.
No business-row write or real shift RPC was submitted by the agent. Existing
advisor categories remain; none names the changed entry points. This is not a
general security clearance.

Permanent SQL regression covers38 actual-trigger scenarios, including the
missing-context OPEN/CLOSED reproduction, fresh OPEN aggregate/table recovery,
sparse closure proofs, wrong-terminal/foreign-row/existing-owner denial, retry,
atomic rollback, context lifetime, idempotence and unexpected definitions. A
separate ignored fixture installs nine exact captured live definitions and runs
the actual migration:12 scenarios passed. Root and an independent reviewer
repeated38+12;58 focused checkout/branch/closure tests passed. Legacy overload
preservation was checked by definition identity, not successful legacy execution.

Affected-PC recovery is now observed: the owner reported the opening visible;
central readback at11:28Brunei confirms original STR1 shift
1a349429-cea1-4f45-8d2b-36678d37ad27, opened31October10:22:18.108Brunei,
OPEN/ACTIVE revision1 with no close timestamp. A successful upload receipt is
dated11:27:01.929Brunei. Pending native work reached the original branch without
an agent creating a replacement shift or changing grants. The terminal heartbeat
last_sync_at field still shows an older value; do not use that field alone to
override direct row/receipt evidence or certify every queued table.

The independent stale-OPEN zero-applied acknowledgement issue remains unresolved;
this correction does not claim to fix it or verify live checkout/closing counts.
Rollback requires a reviewed replacement of only these routine definitions from
the saved preflight; restoring missing context recreates the upload failure.
Never roll back business rows, clear pending journals or replay the full schema
to reverse a routine change.
