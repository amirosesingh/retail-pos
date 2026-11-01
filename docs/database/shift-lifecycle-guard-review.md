# Closed-shift synchronization lifecycle guard — SHIFT-32

Prepared on 1 November 2026 from beta `b31c74e4`, in the separate
`codex/shift-lifecycle-guard-beta` worktree. The owner approved preparation and
isolated tests only, then separately approved the existing receipt-replay
validation dependency. No live migration, record repair, grant change,
publication or production promotion has been performed.

Before final PR preparation, the branch was advanced without conflicts to current
beta `423950b4`. The six prepared files were retained; root repeated the 71
captured-definition scenarios at that baseline. The reviewed runtime fragments
and migration digest did not change during this integration.

## Confirmed defect and bounded change

The existing native upload routine accepts a higher-revision full OPEN snapshot
over a CLOSED row. Local and cloud revision clocks are independent, so a larger
number does not make that lifecycle regression valid. The existing closing proof
checks incoming closures; it does not treat an OPEN packet as a closure.

Fresh read-only metadata from ROSEGILL / pos (`qhrufhtbeguxydenzfey`) identified
`public.sync_apply_shifts(jsonb)` as the direct upsert, not a private implementation
or wrapper. It is SECURITY INVOKER and executable only by postgres/service_role.
Its ownership check and final v2 closing proof are preserved.

CLI-created migration
`20261101052452_prevent_closed_shift_reopening_during_sync.sql` changes only two
existing service-only routines:

1. Add a condition to its locked `ON CONFLICT DO UPDATE` predicate: a saved row
   with a CLOSED status/state or close timestamp can only receive a fully formed
   CLOSED snapshot. Existing revision and same-branch conditions remain.
2. In `pos_sync_shift_closure_ack(jsonb,text)`, after its unchanged branch
   normalization/ownership check and before its CLOSED-only loop, validate any
   nonfinal snapshot. The existing outer batch/aggregate routines call this
   helper for both fresh responses and receipt replay. No outer wrapper or old
   receipt is replaced. Only when nonfinal input exists, lock its same-branch
   parents FOR SHARE NOWAIT in stable ID order before checking. A busy parent
   raises SQLSTATE `55P03` / `SYNC_SHIFT_CLOSURE_BUSY`, never a success response.
   The enclosing subtransaction releases any earlier acquired replay locks.
   Pure CLOSED proof requests keep their existing locking/tuple-check path.

The migration checks the exact update/ownership anchors, existing authority
calls and v2 contract before either replacement. Partial or unexpected
definitions abort both upgrades atomically. Reapplication is byte-preserving,
including already-guarded CRLF bodies. No other function,
table, global revision trigger, permission, stored value or configuration is
changed. Canonical schema and generator use the same predicate and validation
fragments; tests compare those fragments and execute both install paths. This is
not a claim that all historical generator/schema differences are reconciled.
A full baseline-versus-proposed VM generation comparison finds the same 521
function definitions and 471 effective last-definition signatures. Only these
two effective signatures change. In that regenerated artifact the proof helper
appears in the generated contract and the later v2 footer. The checked-in
canonical schema retains its existing historical footer layout; only its final
active v2 helper is patched. Both install paths end with the identical guarded
proof. Unrelated pre-existing contract/generator differences are preserved.

## Acknowledgement and conflict behavior

Rejecting every delayed OPEN packet would preserve CLOSED but leave harmless
opening entries permanently failed. Silently accepting every skipped packet
could discard a newer note or opening correction. The preparation uses a
conservative distinction:

- A clean OPEN/ACTIVE snapshot, with no submitted counts, final count, variance,
  close reason, closing operator or closing-progress facts, is acknowledged with
  the existing `ok:true, applied:0` OPEN contract only when all nonclosing facts
  match. It does not receive a false closure proof. Repeated/lost-response
  requests replay their existing receipt. The ordinary obsolete server packet
  does not itself require an administrator repair. This is a server response
  property, not proof that every native client has adopted the cloud status.
- A different note, opening float, attribution, terminal, overdue flag or other
  nonclosing value, or any supplied closing/count/progress fact, raises the
  existing `SYNC_SHIFT_CLOSURE_CONFLICT`. The entire aggregate and its receipt
  roll back; the client retains pending work instead of silently losing it.
  The existing worker recognizes this semantic error without repeated immediate
  network retries. Such a genuine or ambiguous conflict still needs review.
- The same checks run on pre-existing zero-applied OPEN receipts. A receipt
  cannot acknowledge a previously ignored changed note, float or count while
  the saved shift is CLOSED. Existing receipts remain intact. Changed payloads
  under the same key still fail the original idempotency check first.
- A concurrent writer can make replay validation temporarily busy. The existing
  relay forwards the database error; PostgREST maps SQLSTATE `55*` to HTTP 500.
  The actual native decoder/worker treats that as transient, makes its existing
  five bounded attempts, and keeps the same payload-bound journal entry if the
  writer remains busy. A later scheduler pass can succeed after the writer ends.
  No receipt is deleted, no busy response is accepted, and no permanent retry or
  manual-repair requirement is introduced for this ordinary contention case.
- Expected totals are closing-derived facts and cannot update a closed shift
  through an OPEN snapshot. A genuine final count/recount uses the unchanged
  complete CLOSED workflow and v2 exact-fact acknowledgement.
- A foreign owner discovered during a race still reaches the existing branch
  denial. No branch or terminal validation is bypassed. Normal OPEN creation
  and updates remain available while the saved shift is genuinely open.

There is no new admin repair button or automatic repair of historical records.
This guard cannot upload a closure that never reached the cloud. SHIFT-28's
trusted journal and coherent closing-graph upload protect new native closings;
the already-stuck closure still needs the affected PC's saved facts and a
separately approved recovery plan.

## Native convergence and remaining OPEN-contract boundary

Server protection is not native convergence. `CloudClient.applyLocalBatch`
currently adopts shifts through a revision-gated SQL MERGE. After an obsolete
OPEN99 packet is acknowledged against cloud CLOSED5, ordinary pull can retain
local OPEN99 because cloud revision 5 is lower. That situation can occur when
another authorized operator closes the shift while this PC retains its old
opening state. It is different from the normal journalled closing on this PC:
its local row is already CLOSED, so retaining its higher revision does not
leave it displaying OPEN.

An explicit characterization executes the actual CloudClient SQL generator
with a thin local version-gate model after a real disposable PostgreSQL closing,
recounts and obsolete server acknowledgement. It demonstrates both states:
the already-CLOSED local row remains CLOSED, while OPEN99 remains OPEN after
receiving CLOSED5. This is a documented, unfixed limitation; physical SQL Server
adoption is not certified. No local writer/adoption change, artificial revision
bump, queue clearing or override of pending data is included or authorized here.

The previous OPEN zero-applied receipt contract also remains in force while
the authoritative shift is genuinely OPEN. A real concurrent test explicitly
rolls back closing, then observes the old OPEN replay behavior without inventing
a closure. General handling of previously ignored OPEN metadata before closing
is a separate boundary, not silently repaired by a CLOSED lifecycle guard.

## Verification

All tests use synthetic data. Node is pinned to 22.22.2.

- `scripts/test-shift-closure-sync.mjs`: 71 disposable PostgreSQL scenarios,
  including the pre-change reproduction, exact two-routine patch/metadata
  comparison, stale revisions, lost-response replay, genuine-conflict retention,
  mixed rollback, normal opening/closing/recount, exact timestamp/proof, branch
  and SQL-role denial, idempotence, partial-definition refusal, CRLF and generated
  versus canonical behavior. The added replay cases cover both transports,
  genuine differences, clean normalized legacy receipts, unchanged receipt rows,
  wrong terminal/branch, mixed OPEN/CLOSED input, empty v2 response shape and
  atomic rollback when the second helper anchor is unexpected. The real relay
  response-forwarding fragment, CloudClient and PushWorker are also executed with
  a synthetic PostgREST 55P03/HTTP 500 response: four backoff intervals, five
  attempts, no acknowledgement, retained queue/same payload key, then next-pass
  success against the disposable database. This is not a live HTTP/JWT test.
- The same script with `--captured-routines` repeats the lifecycle cases after
  installing the captured deployed routine bodies and seven actual shift
  triggers. Earlier revision/context tests retain their canonical fixture.
- `scripts/test-native-shift-closure-graph.mjs`: 19 scenarios against canonical
  routines and 19 against all three deployed routine/trigger/constraint captures.
  The added cases preserve the full saved graph and exact close time through a
  late opening, receipt replay and later real recount; a changed note conflicts.
  The nineteenth scenario documents the unresolved native-convergence limitation
  above; it is not evidence of its correction.
- Opt-in `--postgres-bin <portable-bin-directory>` runs 16 real two-session
  PostgreSQL 17.11 concurrency scenarios. The six fresh-upload cases confirm
  actual blocking through `pg_blocking_pids` before releasing the holder: closing
  first, opening first, rollback, changed note, foreign owner and mixed-write
  rollback. Three legacy-receipt cases instead prove prompt `55P03` while a
  writer holds the parent, then the correct result after COMMIT or ROLLBACK.
  A deliberately WAIT-based isolated helper reproduces a `40P01` deadlock with
  the existing opposite-order two-parent writer. The final NOWAIT helper passes
  both writer orders and both replay input orders; a writer can acquire the
  earlier partially locked parent after the busy replay fails. Further cases
  check rollback of preceding writes without receipt loss and foreign-branch
  denial before busy-lock handling. The harness creates a random-port loopback
  cluster, strips inherited PostgreSQL/database URL settings, accepts no existing
  database connection, and stops/removes only its verified private fixture.

The multi-parent writer fixture splits its existing B→A statements inside one
transaction to expose the actual lock boundary; it does not change production
upsert ordering. NOWAIT avoids adding replay-versus-writer deadlock to that path.
Existing fresh multi-parent writers can still wait on or deadlock with other
oppositely ordered writers; PostgreSQL aborts the victim transaction and the
existing transient retry retains its queue. Global writer ordering is outside
this correction, and the tests do not claim that all system deadlocks are gone.

The graph fixture executes actual extracted Main functions, journal helper,
snapshot reader and PushWorker with disposable PostgreSQL, while local SQL
persistence remains modeled. These results do not certify physical SQL Server
contention, an installed till, gateway authentication or real notification
delivery. The guard has not been applied to ROSEGILL. Membership and held
audit/history access-policy work remain untouched.

PostgreSQL documents that an upsert's condition is evaluated after the conflict
is identified and the row is locked. The independent-session tests verify the
needed behavior instead of relying only on a separate preflight SELECT:
[PostgreSQL 17 INSERT](https://www.postgresql.org/docs/17/sql-insert.html).
The retry fixture uses the documented `55*` → HTTP 500 mapping:
[PostgREST 13 errors](https://docs.postgrest.org/en/v13/references/errors.html).

## Application and rollback boundary

Before live application, obtain separate approval naming the organization,
project/ref/URL, exact migration and reviewed digest. Re-read and retain the
two target routine definitions, owners, ACLs and settings; reject unexpected drift.
Apply only this migration, then verify definition/metadata and safe read-only
connectivity. Never replay the full schema or modify existing shift rows as a
substitute for this guard.

Source rollback is a targeted revert/rebuild. A live routine rollback requires a
reviewed restoration of only the two saved prior function definitions, preserving
grants and business records; it restores the known reopening risk. Never undo
business records, clear queues, reset checkpoints or discard receipts to roll
back this routine change. Production promotion and installer publication remain
separate owner decisions after beta review.
