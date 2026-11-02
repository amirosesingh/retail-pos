# Original STR1 closing: preparation and execution gates

This is **preparation only** for SHIFT-28B. The owner approved source preparation
and isolated tests, not execution on the affected PC, synchronization retries,
cloud writes, lifecycle-guard application, publication or production promotion.
Membership remains on hold. No application runtime code is changed.

**HOLD — 2 November fresh evidence supersedes the original execution premise.**
The cloud parent is now CLOSED revision5 at2026-11-01T13:38:37.207159Z, with a
different count, reconciliation, events and summary. The owner confirms closing
it deliberately on the web. Do not stage or retry the eight-row aggregate below,
even if local CAPTURE succeeds. Preserve both histories and compare complete
before-images; a correction requires a newly reviewed exact plan and approval.
The historical preparation/tests below do not authorize replacing this newer
closure or bypassing existing acknowledgement and uniqueness checks.

## Exact incident and evidence

| Context | Verified read-only fact |
| --- | --- |
| SQL Server / database | `DESKTOP-VIB2MIL\LCRPOS` / `POS_Local` |
| Branch / original terminal | STR1 `a611a328-2217-4d77-944a-5f6a637d123b` / `2a9be656-3830-4f1c-9ede-3e9c379f3d13` |
| Original shift | `1a349429-cea1-4f45-8d2b-36678d37ad27` |
| Saved state / revision | CLOSED / CLOSED / 3 |
| Original opening | `2026-10-31T02:22:18.108Z` |
| Original closing | `2026-10-31T13:08:56.837Z` (21:08:56.837 Asia/Brunei) |
| Original count | `dd2b330a-bcfc-44f6-9949-8d912cdbca80`, kind ORIGINAL |
| Reconciliation | `7a49fc63-da14-41c6-b7d7-c1ddda5871fa` |
| Saved graph | One parent, one count, one reconciliation, three closing events, one summary (`shift_notifications`), one variance alert |
| Cloud at 1 November baseline | Original and then-current shifts OPEN revision 1; no closing children. Superseded by the 2 November HOLD above. |
| Retained target CT | Version 35061, context NULL, beyond shifts push checkpoint 29281 |
| Earlier blocking history | `change_history` push checkpoint 22619 below its retained minimum; other checkpoint values are evidence at their recorded read time |

Separate reads matched branch/terminal ownership, original close/count/reconciliation
time, counted tenders and parent/reconciliation financial fields. They are not a
transactionally frozen whole-row manifest at that stage. On 2 November the
reviewed CAPTURE-only query succeeded on the affected PC and returned the complete
eight-row graph, baseline journal/receipt, seven checkpoints and database GUID.
The 8,411-character manifest's UTF-16LE SHA256 independently matched the SQL
result: `74A53F91A9489C4211004F62F1068EB1AC4A67A67DF770C0BEBF0A77CD8B5756`.
Complete PC and cloud payloads remain in ignored private evidence, not this PR.
No actual values or fingerprint were fabricated. The changed cloud graph means
this successful read does not authorize the original metadata-only stage.

Stable 1.4.79 saved protected closes through direct OperationsRepository writes,
without a durable closing aggregate. Its journal uploads run before CT. The
retained closure can therefore remain local when an earlier CT gap aborts the
pass. The opening's acknowledged revision-1 journal remains preserved. Stable's
generic `ok` and journal count zero are not proof of recovery.

## Proposed artifact

`scripts/maintenance/requeue-str1-20261031-shift-closing.sql` has exact shipped
server/database/branch/terminal/shift/time/revision identities. There is no fixture
switch, authority bypass, dynamic SQL, sqlcmd variable or alternate server path.
It refuses an existing transaction rather than rolling back the operator's work.
It also refuses IMPLICIT_TRANSACTIONS ON before database metadata reads, preserving
that session option rather than leaving an implicit transaction open.
These two pre-owned refusals use RAISERROR plus immediate RETURN. Isolated tests
reproduced that THROW under inherited XACT_ABORT ON could roll back the operator's
existing work; the corrected refusals preserve it. Errors after this script owns
its transaction retain explicit whole-transaction rollback.

Default CAPTURE performs locked SELECTs and rolls its transaction back. It returns
the exact whole-row JSON manifest and SHA256 of its **UTF-16LE bytes**. This is a
local evidence digest, not the runtime uploader's canonical cloud payload hash.
Every null and stored JSON string remains represented; six tables are ordered by
ID, journal rows by change ID and receipts/checkpoints by their actual keys.
Volatile read times and CT current/minimum are excluded. Changes to relevant saved
checkpoints, baseline acknowledgements or other captured facts require recapture
and review; unrelated transactions need not change the digest.

STAGE remains blocked in the committed artifact: actual database GUID, reviewed
manifest, digest and approval/transport references are unset. A separately reviewed
execution artifact must bind them to the captured evidence. References are human
attestations; SQL cannot verify that an installed uploader, cloud authorization or
v2 proof is correct. Neither CAPTURE nor STAGE starts a synchronization job.

The script validates:

- Exact original CLOSED parent, opening, closing and revision 3.
- All eight saved graph rows, their branch/terminal context, IDs, time and links.
- Original count/reconciliation and null-aware parent financial equality, without
  recalculating drawer totals or replacing the original summary.
- Valid stored JSON, original closing-event links and variance reconciliation.
- Raw UUID and JSON-key journal identities; all acknowledged and pending graph
  entries, associated aggregate siblings and historical receipts.
- The known acknowledged opening baseline. Pending, partial, foreign, shared,
  conflicting or ambiguous metadata stops execution for separate investigation.
- Exact current whole manifest and independent reviewed digest/database GUID.

It then inserts **eight metadata rows** into existing `sync_change_journal`, one
for each saved graph row, and one audit receipt into existing
`local_operation_receipts`. Parent operation is update/version 3; child operations
are insert/the registry's version-1 default. No new child ID is generated.
The domain-separated deterministic operation is
`f69ae907-b21f-4d7e-8369-17ec6f707212`; its receipt binds the manifest digest and
approval/transport references. Existing opening, current-drawer and other metadata
are not edited. No business row, checkpoint, schema, grant, credential or runtime
configuration is written. Activities already uploaded are outside the new aggregate.

Identical replay validates the receipt and all eight exact journal keys, versions,
branches and operations and returns without inserts. Named operational fields
`acknowledged_at`, `retry_count` and `last_error` may evolve normally. Missing,
duplicated or changed staged rows and conflicting receipts stop replay; they are
not repaired automatically. A second receipt digest binds every other staged
journal field (including change ID and creation time) plus the receipt timestamp.
Historical baseline rows remain fully bound, including their acknowledgement and
retry fields. Status always says **STAGED / NOT RECOVERED**.

For read-only inspection, take the SQL prefix before the `STAGE_ONLY_BEGIN`
marker, append the SQL in the commented `CAPTURE_ONLY_TRAILER_BEGIN` block (remove
its comment prefixes), then append the `OWNED_TRANSACTION_CATCH_BEGIN` tail,
keeping Mode CAPTURE. The trailer rolls back and rejects any non-CAPTURE path,
including accidentally filled STAGE inputs; it cannot leave range locks open.
The harness executes this exact complete derivation, confirms it has no persistent
DML/DDL and compares every relevant persisted row before/after each successful
capture. Table-variable inserts build ephemeral keys only; transaction locks and
rollback retain coherent validation. Do not submit the STAGE section merely to
collect evidence. Captured manifests/financial/operator payloads belong only in
private ignored local evidence, never Git, PRs, console logs or published files.

## Locking and maintenance boundary

Use a separately agreed brief maintenance/quiescence window on the original
profile. The script does not stop/pause the application or prove that background
work is stopped. A new beta installation is not a substitute for that profile.

The explicit transaction takes the deterministic receipt, original parent, child
graph and metadata locks in that order, with per-read HOLDLOCK/UPDLOCK/NOWAIT.
It makes no session isolation/timeout changes and retries no statement. Any busy
resource or validation error rolls back the whole owned transaction. Some child
tables lack shift-ID indexes, so scans/range locks can affect a wider area briefly;
do not promise zero contention or narrow row locks. Old 1.4.79 writers do not use
the newer parent prelock, which is another reason to fail promptly on contention.

## Separate execution and transport approval still required

Before asking for exact execution approval:

1. Capture and privately review the complete real manifest, database GUID and all
   eight IDs/full fields, journal aggregates/receipts and saved checkpoints.
2. Recheck the exact cloud parent/children and any pending/previous delivery for
   those IDs. If evidence changed, stop and review it. Do not infer absent children
   from notifications or stale UI alone.
3. Review the immutable execution diff and file SHA256, target identities, manifest
   digest, references, row effect and maintenance window with the owner.
4. Identify the reviewed coherent-graph uploader on the same original profile,
   its trusted terminal/operator context and v2 acknowledgement checks. The old
   production binary does not supply these checks; its generic `ok` is insufficient.
5. Review notification delivery/deduplication under actual server rules. No
   `activity_events` is requeued or delivery routine called here. Restoring absent
   summary/variance rows may invoke normal server rules during a future upload;
   this artifact and synthetic tests cannot certify real delivery behavior.

After separately approved staging/upload, verify the complete cloud graph: exact
parent CLOSED facts and original time, count/reconciliation IDs and amounts, all
three event IDs, original summary and variance alert, branch/terminal attribution,
v2 proof bound to the requested revision, and no change to the current drawer.
Record actual acknowledgements and readback. A staged receipt, published client,
queue zero, notification, test or successful HTTP response alone is not success.
No automatic broad history recovery, checkpoint reset or lifecycle-guard deployment
is part of this procedure.

## Rollback boundaries

Before execution: revert only the reviewed preparation source commit; no database
rollback is needed. This document is not an automatic undo script.

After staging but before delivery: retain the manifest/receipt and inspect actual
acknowledgements first. Removing even these eight pending entries requires separate
approval and guarded proof that none is in flight or acknowledged. Never clear the
queue or alter other receipts/checkpoints. Once delivery may have happened, deleting
metadata is not a cloud rollback. Any necessary data reversal requires a separate
audited plan using the real before/after evidence; do not reopen shifts blindly.

## Isolated verification

Run `node scripts/test-str1-shift-recovery.cjs` with pinned Node 22.22.2. It accepts
no arguments, passwords, database URLs or server override. It connects only to
hardcoded local `localhost\LCRPOS` with integrated authentication and a random
`POS_Shift28Regression_<24hex>` disposable database. Cleanup requires the exact
created name and private fixture-owner nonce. No `POS_Local`, real profile/cache,
external database or cloud endpoint is read or written.

The harness extracts the six actual canonical table definitions plus relevant
default/PK/FK/unique/index constraints; metadata tables also reuse canonical
definitions. It changes only reviewed input literals for its isolated target,
asserting the production SQL body is identical. The unmodified shipped guard is
tested against the fixture and must fail. Synthetic values reuse incident IDs to
exercise those guards but are explicitly not real captured business evidence.
Minimal unrelated sales/stock sentinels supplement the actual graph schema.

Real SQL scenarios cover capture, exact inputs, all-field drift, preserved pending
and acknowledged work, eight-row staging, idempotence, acknowledgement/retry
evolution, partial metadata, rollback and two-session contention. Actual current
ChangeReader and PushWorker consume the staged metadata. Their cloud adapter is
synthetic: missing/wrong v2 proof and ambiguous timeout retain work; a valid proof
acknowledges once and unchanged retries retain payload identity. No notification
dispatch is performed. These tests do not certify installed-device, live gateway,
actual notification rules or complete cloud recovery. Execution results are to be
recorded separately from live acceptance; no live success is claimed here.

On 1 November 2026, pinned Node 22.22.2 passed **58 real SQL Server/current-reader
and worker scenarios** using this harness and ODBC Driver 18 integrated local
authentication. The random nonce-owned fixture database was removed after the
run. This includes exact shipped/default-input assertions, derived capture and
fully bound STAGE rejection, unchanged capture/error paths, UTF-16LE evidence
round-trip, drift/ambiguity rejection, binary receipt padding/case checks,
immutable journal/receipt replay, rollback and two-session contention.
Tests also preserve explicit/active-implicit operator work under inherited
XACT_ABORT ON when refusing execution. Current ChangeReader/PushWorker tests used
only the synthetic cloud adapter described
above. Node syntax, changed-file ESLint and `git diff --check` also passed.
Independent review and live capture/execution approval remain separate gates.
