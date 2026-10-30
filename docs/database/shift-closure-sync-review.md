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
