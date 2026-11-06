# Change-history feed and recovery: preparation plan

This is a read-only investigation and proposed next batch, not an implemented or
approved database change. COUNT79 completes only the existing count contract. The
three-product ownership repair remains independent. No cloud/local history rows,
registration, queues, checkpoints, grants, billing or operator configuration were
changed during this investigation. Membership and the broader audit-privacy change
remain on hold.

## Confirmed current contract

Target: ROSEGILL, organization `bjxgimekljzlnwejuawj`, project `pos`
(`qhrufhtbeguxydenzfey`), database `postgres`, API
`https://qhrufhtbeguxydenzfey.supabase.co`. A connection label is not evidence of an
isolated database; this is the live business database.

On 6 November the live history count was 21,019, while the current development PC
had 20,799. This is a net difference of 220, not proof of exactly 220 missing UUIDs.
There may also be local-only or divergent records. A consistent ID comparison is
required before defining a repair manifest.

Read-only live metadata confirmed:

- `change_history` has only `change_history_no_change`, its existing BEFORE
  UPDATE/DELETE immutability guard. There is no AFTER history feed trigger and no
  `sync_feed_change_history()` function. The durable feed contains zero history
  events.
- Live `pos_sync_pull(text,text,text,bigint,integer)` already dispatches history
  by its UUID. Its body MD5 is `ffabe2f9bc0ed2d49e42b3b4b2674b7b`. Its existing
  admission validator and organization/branch/global/terminal feed selectors must
  remain unchanged.
- `pos_sync_feed_page_v1` delegates that pull under its exact-definition guard,
  then uses the existing privacy projector and byte/cursor limits. Its definition
  MD5 is `f7c8221574a065caf04d4b16c1344d0f`. There is no missing history dispatch
  in this protected response path.
- The existing history bootstrap admits its current `WHERE true` row scope with
  no historical-date cutoff. Local count comparison and registry retention match
  that existing contract. This plan must not broaden or narrow that scope; the
  deferred audit-scope decision is separate.
- Feed `cursor` is GENERATED ALWAYS identity, backed by
  `public.sync_change_feed_cursor_seq`. Recovery must use that ordinary identity,
  never assign cursor values or reset the sequence. Its existing wake trigger is
  best effort and deduplicates a table/topic notification per transaction.
- Current native aggregate and batch upload dispatchers already name history,
  but their referenced `sync_apply_change_history` and
  `sync_delete_change_history` functions are absent. Enabling generic generated
  update/delete writers would conflict with immutable-history requirements and
  is outside the count correction. First determine whether local history is
  actually queued; any required upload adapter needs a separate append-only,
  current-authority/idempotency design and tests.

The canonical generator already has an AFTER INSERT/UPDATE/DELETE history trigger
whose events use organization attribution, `branch_id='global'`, no terminal
target, the UUID entity key, row_version=1, and ordinary operation/tombstone fields.
The BEFORE immutable guard prevents its UPDATE/DELETE cases from succeeding.
That canonical behavior explains the intended read contract, but it is not proof
that installing it unchanged is safe without source/shape/concurrency tests.

## Proposed bounded preparation sequence

1. Freeze one consistent, SELECT-only local history UUID list and count, bound to
   the current database GUID, terminal, registered branch and cloud project.
   Export no PINs, keys, credentials or old/new-value audit payloads. Read the
   corresponding cloud UUID set in the same existing authorized read scope.
   Classify cloud-only, local-only and intersecting IDs. Count equality alone
   cannot establish equality; do not delete local-only records.
2. For candidate missing rows, freeze the cloud IDs and immutable row fingerprints
   in a reviewed manifest. For existing IDs that require value comparison, compare
   the authorized device projection, not raw private JSON. Preserve pending local
   history; divergent IDs require review rather than overwrite. Do not infer
   authority solely from a timestamp or `revision` number.
3. Prepare a narrowly guarded future-insert feed trigger/function, using the
   established event shape, existing service-only function exposure and unchanged
   immutable guard. Pin all relevant live source, table/identity/trigger and
   authorization contracts. Do not regenerate the complete sync schema, add
   unrelated upload/delete helpers, change policies or mutate history rows.
4. Prepare a separate exact missing-ID event seed through `sync_change_feed`, not
   a PC-to-cloud data copy. Publish only the reviewed IDs with a durable seed
   receipt/manifest and replay guard. The normal identity allocator chooses new
   cursors; the normal protected pull fetches existing authorized history rows;
   the existing local transaction commits data and checkpoint together.
5. Recheck missing-ID cardinality/source fingerprints and trigger state under a
   bounded lock/transaction at application time. Define explicit race ordering:
   no cloud insert may fall between the backfill cutoff and enabled trigger
   without either its ordinary event or a seed event. Unexpected source, changed
   manifest, lock contention or missing row must abort the complete change.
6. Use normal coordinated synchronization to consume the events. The current
   development PC inserts only absent rows. PCs already holding the same projected
   row must do no physical update, generate no return upload, and keep their own
   independent cursor. Pending local work must hold the affected page until its
   existing acknowledgement/review path is satisfied. No queue/checkpoint reset.

An event is an invalidation pointing to the existing immutable cloud fact, not a
second copy of that fact. Global events deliberately preserve the current
history-read contract; they do not authorize another branch's business writes.
If a future privacy decision changes history visibility, that decision must update
the read/count/feed/projection contracts together in its separately approved batch.

## Multiple-PC and long-offline limits

The missing-ID manifest from one PC does not prove all other PCs are complete.
Before claiming fleet recovery, compare every affected PC or implement an approved
bounded per-terminal ID reconciliation through the same engine. A union of
reviewed missing IDs can be seeded once globally, with ordinary duplicate no-op
handling for other PCs. Do not broadcast all21,019 rows merely to avoid finding
the differences.

Future inserts will enter the durable feed after the trigger is correctly
installed. A PC that reconnects before feed retention expires follows its saved
cursor. A PC offline beyond retained feed history uses the existing bounded,
resumable recovery-snapshot path after pending-work checks. New feed events alone
do not remove that necessary fallback or promise unlimited retention.

## Required isolated verification before any live request

- Captured live pull/protected-page/privacy definitions continue to return the
  same allowed fields, scope and byte/cursor behavior; denied terminal/branch,
  revoked authorization and public/authenticated direct calls remain denied.
- New immutable history insert produces exactly one event with the ordinary
  identity cursor; UPDATE/DELETE stay denied and cannot produce a successful
  mutation. Existing history rows and business table/permission fingerprints
  remain unchanged.
- Exact seed and lost-ack retry produce no duplicate seed events or receipts;
  concurrent insertion/seed cannot lose a fact. Unknown source/changed row,
  partial manifest or late error rolls back completely.
- Actual native SQL Server plus real PullWorker/CloudClient classes: two PCs
  with different missing sets, one already matching PC, pending/local-only and
  divergent history, safe no-op replay, restart/network interruption, context
  switch, page rollback and expired-history recovery. Check no extra upload is
  created by the cloud Change Tracking context.
- Enough synthetic rows/large JSON to prove bounded page size and complete
  cursor continuation through actual PostgREST; no API row-limit truncation and
  no reduction in privacy to fit a CPU budget.
- Verify the cloud and each affected PC ID sets/counts after ordinary sync, with
  truthful pending/review/error status. Checkout, offline shift closing and
  authorization regressions remain part of the affected shared-sync acceptance.

## Approval and rollback boundary

No function/trigger/feed seed in this document is implemented or applied. After
the identity comparison and isolated tests, present the exact migration and seed
files, hashes, target, ID manifest, expected event/receipt counts and all normal
trigger effects to the owner. Application requires separate exact-target approval.
The count-only patch is independently reviewable and must not imply history
recovery is finished.

Any failed prepared transaction must roll back. After committed events have been
consumed, do not rewind client cursors or remove acknowledged facts as a rollback.
A future regression should stop the new trigger under a separately reviewed
forward correction while preserving immutable history and accepted event evidence.
