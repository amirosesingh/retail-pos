# Shift reconciliation summaries: read-only repair proposal

Prepared 3 November 2026. The seven-row execution artifact is prepared and tested;
this document and its tests are not live historical-change approval.

Target: ROSEGILL → rosegill0011@gmail.com's Org (`bjxgimekljzlnwejuawj`)
→ pos (`qhrufhtbeguxydenzfey`), database `postgres`,
https://qhrufhtbeguxydenzfey.supabase.co.
Branch: `a611a328-2217-4d77-944a-5f6a637d123b`.

Read-only checks found eight closed shifts whose parent summaries do not match
their existing reconciliation because five parent fields are NULL. Each has one
ORIGINAL count and one linked reconciliation; closed-header, linkage, amount
validity and reconciliation arithmetic checks passed. The existing strict graph
validator rejects these graphs. No historical records have been changed.

## Proposed seven-row scope

After separate exact approval, copy only `expected_cash`, `expected_card`,
`expected_digital`, `variance_cash` and `variance_total` from the existing linked
reconciliation to the same shift's NULL parent fields:

| Shift ID | Opened date (UTC) |
| --- | --- |
| `2e735bd8-0db2-44fb-a6f7-e28edc64f7e0` | 2026-10-09 |
| `85902cc1-9804-4d6f-af4f-f73a1e7799b8` | 2026-10-10 |
| `d252a275-ebf7-4a09-8cd7-a45706c594a3` | 2026-10-11 |
| `a23393c7-a38b-4bcb-93fe-1a3b057e0fe2` | 2026-10-26 |
| `f725325a-8919-4d9d-b9cb-24f43d185147` | 2026-10-29 |
| `8be4c1e9-3f88-4e7b-b52f-a6f31b5005c8` | 2026-10-30 |
| `acbc1ed1-2fc1-44c7-9c71-c338da7fda2f` | 2026-11-01 |

Exact row versions, fingerprints, original count/reconciliation IDs and live
trigger definitions are captured in the companion metadata-only evidence files.
The prepared `scripts/maintenance/repair-seven-shift-parent-summaries.sql`
statement locks these exact rows, aborts on changed facts, requires
the same branch and unique ORIGINAL count/reconciliation relationship, require
all five destinations still NULL, and recheck finite/nonnegative/two-decimal
amount and variance/status consistency. Validate each full graph after changes
and roll back the whole repair if any predicate fails. Include a maintenance
audit with reviewed before/after fields and verify readback before permitting
normal sync adoption. Existing triggers may publish normal sync-feed updates;
their precise effects must be included in the later approval.

The artifact is one atomic DO statement: no enclosing transaction commit, no
trigger disabling, no schema/grant changes. It pins the two unchanged graph
helper bodies and metadata, all ten actual shift/audit triggers and the existing
nondeferrable child-parent FKs. UTC is set transaction-locally for consistent
fingerprints and restored, as is the existing shift-function context. Failures
roll back the statement, including audits and feed entries. Successful first
execution updates seven parents' five NULL fields, increments each row_version
once and changes updated_at through existing triggers, inserts seven honest
postgres maintenance audits with before/after states, and emits fourteen normal
feed entries (seven shifts and seven audits). It creates no activity or shift
notification. A verified complete replay is a no-op; partial receipts or a valid
but altered graph are rejected. These audits are not cashier impersonation.

Do not recompute today's expectations, change counts or existing non-NULL
summaries, dates, actors, status, permissions, stock, sales or current drawer.
Preserve existing card/digital variance fields. Do not reset checkpoints or
weaken graph validation. The prepared mutation remains subject to separate
exact-project/artifact-hash approval before execution.

## Excluded eighth shift and authority boundary

`1a349429-cea1-4f45-8d2b-36678d37ad27` (STR1, opened 31 October)
is excluded. Its cloud closing is the later administrator web action; the owner
selected the original cashier closing on the affected production PC as the
single effective closing, retaining the web action in audit history. That
separate #359 authority/recovery repair remains ON HOLD. Filling cloud summaries
for this shift would implicitly validate the later graph and must not be folded
into the seven-row proposal. The development SQL database has no copy of this
shift; the original cashier copy belongs to the other affected PC.

## Smallest complete recovery path for all eight

1. Refresh the eight current cloud before-images with
   `shift-reconciliation-current-evidence.readonly.sql`. This SELECT-only query
   returns IDs, timestamps, versions, fingerprints and consistency flags, not
   financial payloads. Changed rows or additional conflicts require review.
2. Apply the separately reviewed future-write helper migration only after its
   exact live approval, so a new closure cannot reproduce missing summaries.
3. Prepare a guarded seven-row repair using the existing reconciliation facts
   and the preconditions above. Keep the held eighth outside that transaction.
4. Resolve the held eighth with a new exact, audited original-authority repair,
   not the obsolete #359 metadata replay. First find the already captured private
   evidence; do not reconstruct original facts from an activity notification.
   The affected-PC CAPTURE manifest was 8,411 characters and its UTF-16LE SHA256
   was `74A53F91A9489C4211004F62F1068EB1AC4A67A67DF770C0BEBF0A77CD8B5756`.
   Verify those exact bytes and compare the full six-table graph with the current
   cloud before-image. The expected original count is
   `dd2b330a-bcfc-44f6-9949-8d912cdbca80`; reconciliation
   `7a49fc63-da14-41c6-b7d7-c1ddda5871fa`; original closing time
   `2026-10-31T13:08:56.837Z`. These identifiers are checks, not a replacement for
   the actual complete rows. Preserve the later deliberate web action and its
   full before-image in protected audit evidence; never delete or silently retag
   it as the cashier's original. Define one effective ORIGINAL count without
   violating its uniqueness constraint or fabricating causal/author signatures.
5. Before approval, test the exact historical repair against disposable copies
   of those private graphs, including changed-row abort, all-or-nothing rollback,
   original-count uniqueness, author/receipt conflicts and legitimate retries.
   Include existing trigger, sync-feed, notification and correction-history
   effects in the proposed exact row-change manifest. The eight-shift repair
   must not alter the current day's shift, current drawer or unrelated counts.
6. After separate exact approval and readback, validate every selected-branch
   graph under the unchanged validator, then observe normal scoped recovery
   complete and checkpoints advance only through the existing recovery path.
   Seven repaired rows alone are insufficient if the held eighth still fails.

The original capture exists according to reviewed records; its actual private
file location/content has not been revalidated in this preparation. If it cannot
be recovered or current affected-PC facts differ, obtain a fresh SELECT-only
capture on `DESKTOP-VIB2MIL\\LCRPOS` / `POS_Local` using the original registered
profile, including the full saved parent, count, reconciliation, three close
events, notification, variance alert, journal/receipt/checkpoint context and
database identity. Do not change that PC, enroll a new key, replay a stale
revision, clear its pending data or assume its saved revision 3 outranks cloud
revision 5. Existing captures can support preparation; an execution preflight
still must prove current facts/queued work have not diverged.

Repairing seven rows alone therefore does not guarantee complete branch graph
recovery: the excluded eighth conflict still needs its separately approved
authority resolution. Future authorized corrections on web or terminal must
continue to synchronize under existing causal/author guards.

## Future-write preparation and evidence

Migration `20261103105157_preserve_shift_reconciliation_parent_summaries.sql`
adds seven already-computed assignments to `shift_reconcile_now`; it changes no
historical rows. Old normalized body MD5:
`8e70ac04aaa3368aea5cbcbe9bd1434a`; expected corrected live-body MD5:
`de87d75592ce3fe5872de90b4be9a466`.

Preparation passed 89 isolated SQL scenarios, 27 focused Vitest tests, scoped
ESLint and TypeScript checking. Tests include strict graph validation,
cash/card/digital/null/zero cases, permissions, recount/retry behavior and
transaction rollback on reconciliation or audit failure. These synthetic tests
do not constitute live application, historical repair, installed-device
acceptance or proof that current ECHANGEGAP recovery has completed.

Historical artifact verification additionally passed 46 disposable PGlite and
47 native PostgreSQL scenarios with the actual captured trigger definitions,
including two-session NOWAIT denial, audit/late-graph rollback and forged receipt
replay rejection; its two-test Vitest bridge passed. Native cluster
`owned-GDpLtG` was stopped and removed. No real SQL Server or cloud database was
used by those tests. The future-write migration was separately approved and
applied with verified readback; historical seven-row execution has not occurred.
The original cashier PC is currently unavailable, so the eighth repair remains
blocked and complete branch recovery must not be claimed.

The owner-approved F202 artifact later aborted before any historical updates:
its trigger list contained normalized source hashes but the guard correctly
compared raw bytes. Root confirmed zero repair audits and all eight graphs
unchanged. The previous native 47-scenario harness substituted fixture-generated
pins, masking that mismatch; that pin-parity evidence is superseded. Corrected
artifact SHA256 is
`95F35B0C2467301326CF2980533EAE3466AA6903338D1955401C77EB45679B83`.
It pins exact captured raw CRLF source bytes, with the same strict guard.
Normal test cases now keep the production trigger list unchanged; server-side
escapes preserve raw function bodies through Windows psql transport. All 68
PGlite and 69 native cases passed, including raw-versus-normalized rejection;
native fixture `owned-LQk5me` was stopped/removed. Root's SELECT-only live parity
check confirmed all ten raw pins, definitions and enabled flags. A renewed exact
approval is required before any attempt with these changed bytes.
