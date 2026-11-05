## Verified execution — 4 November 2026

Owner approved these exact local repairs and confirmed Electron closed, no unsaved checkout and no concurrent schema maintenance. Both guarded artifacts applied to the pinned POS_Local identity. Readback verified three summary targets and one receipt, plus fourth CLOSED revision 3 with seven existing children and one receipt. Lossless comparison found all 18 retained local graphs equal to the reviewed cloud snapshot under both privacy projections, with no orphans. PR382 merged beta at e6af19de. Electron reopened Ready; automatic recovery is advancing through existing checkpoints. Full recovery completion remains under observation. No stock/sales/permission/configuration edits, queue clearing or manual checkpoint reset. The preparation text below records the approved design, not current execution status. Private package stays ignored; its preparedOnly manifest is an immutable artifact descriptor, not a live authorization registry.
# Fourth local shift: accepted cloud closing adoption proposal

Prepared 4 November 2026. **Plan and isolated-test contract only.** This document
does not authorize execution, supply live SQL, or establish installed-device
acceptance. An immutable execution artifact, fresh evidence and separate exact
server/database approval are still required.

The owner separately approved investigating this fourth difference after the
three-parent summary proposal. It is a different operation: local OPEN → the
already accepted cloud CLOSED graph, rather than filling summaries on an already
closed local parent. The general rule remains bidirectional synchronization:
upload genuinely pending local closings before authoritative download, preserve
their complete graphs, and never decide authority from wall-clock order alone.
This one proposal relies on the explicitly selected, verified cloud closing and
the exact reviewed local before-image. It grants no general “cloud always wins”
exception.

## Target and exact proposed effects

Local target: `LAPTOP-N0QBONGL\LCRPOS` / `POS_Local`; branch STR1
`a611a328-2217-4d77-944a-5f6a637d123b`; shift
`f7c9512a-92dc-4f88-b49d-71d55c577670`. Authoritative source: ROSEGILL →
`rosegill0011@gmail.com's Org` (`bjxgimekljzlnwejuawj`) → pos
`qhrufhtbeguxydenzfey`, database `postgres`,
https://qhrufhtbeguxydenzfey.supabase.co.

Private read-only captures contain 18 local and 28 cloud shift graphs. The
selected local parent is OPEN/ACTIVE, revision 1, with no rows in its five child
tables. Its opening remains `2026-10-26T02:22:12.063Z`. Both existing privacy
projections report the same 17 parent differences and seven cloud-only children.
The captures stay in ignored `.tmp/local54-*-private.json`; do not publish their
financial/operator payloads, connection details or unrelated records.
Before execution, retain the full original before-image and accepted source in
the durable ignored `maintenance-private.local` package; temporary captures alone
are insufficient. Bind its exact SHA256 in the execution proposal and local
receipt. Public plan/artifact files contain field identities and approved effect
counts, not actual financial amounts or operator payloads.

Copy exactly these existing cloud facts, after guarded approval:

| Parent field | Local before | Existing accepted cloud fact |
| --- | --- | --- |
| closed_at | NULL | `2026-10-26T13:08:07.260Z` |
| counted_cash | NULL | Exact accepted cloud amount, privately pinned |
| expected_cash | NULL | Exact accepted cloud amount, privately pinned |
| updated_at | `2026-10-26T02:22:12.064Z` | `2026-10-26T13:08:08.376323Z` |
| status | OPEN | CLOSED |
| closing_float | NULL | Exact accepted cloud amount, privately pinned |
| row_version | 1 | 3 |
| expected_card | NULL | Exact accepted cloud amount, privately pinned |
| expected_digital | NULL | Exact accepted cloud amount, privately pinned |
| variance_cash | NULL | Exact accepted cloud amount, privately pinned |
| variance_total | NULL | Exact accepted cloud amount, privately pinned |
| state | ACTIVE | CLOSED |
| close_reason | NULL | Exact existing cloud reason, privately captured |
| closing_started_at | NULL | `2026-10-26T13:07:40.417Z` |
| closing_started_by | NULL | Exact existing cloud actor reference, privately captured |
| final_counted_cash | NULL | Exact accepted cloud amount, privately pinned |
| variance_status | NULL | OVER |

Copy seven existing child rows, preserving every field and identity:

| Table | Existing cloud ID |
| --- | --- |
| shift_cash_counts | `91cb2994-a675-4ae4-a427-7fb70cec4e4a` |
| shift_reconciliations | `f00ed267-3cc0-4397-9986-075455b16608` |
| shift_close_events | `0c693b41-a384-44ba-85d0-25cd1e75c7cb` |
| shift_close_events | `b0fa6f45-0205-408f-991d-c663cc3ff419` |
| shift_close_events | `c2584907-eb82-43de-a75f-4eca431458c5` |
| shift_notifications | `b7ea54b7-9182-4193-86cb-35359f2679c1` |
| shift_variance_alerts | `8da5fdf3-4904-4fdc-9b79-929aed7ca1da` |

This is adoption of existing history, not a new closing, cash collection,
payment, sale, recount, signature, author enrollment or notification publication.
Do not recalculate expectations, relabel a time or actor, allocate child IDs,
change counted card/digital values, or update other shifts, stock or sales.
The later execution proposal must state its precise local maintenance receipt
and all trigger/Change Tracking effects, including approved `CLOUD` context.
It must preserve the local before-image rather than pretend that the local
cashier just performed this closing.

## Active checkout, notification and database prerequisites

This target was the **only local OPEN shift** in the reviewed 18-row snapshot.
Changing its state affects active-shift selection. Therefore “no drawer table
update” is not proof that current checkout is unaffected. Before execution:

- Establish a maintenance window with no active checkout write or unsaved local
  work using this shift. Preserve all current sessions, carts and pending work;
  do not open a replacement shift automatically.
- Review branch-local held orders linked to the target **or with NULL shift_id**,
  including unknown statuses. The actual enabled unfinished-ticket trigger
  rejects ACTIVE → non-ACTIVE / new closed_at with error 51022 while unfinished
  tickets remain. Preserve the trigger; never cancel tickets or disable it.
- Review linked sales, bookings, booking payments, payment transactions, journal
  keys and author intents. Zero graph journal entries alone is insufficient.
  Pending, unattributable or changed local work stops adoption.
- Capture exact column definitions, defaults, computed/identity columns,
  constraints, filtered ORIGINAL-count/client-key indexes, FKs and **all triggers
  on all six graph tables and the chosen local receipt table**. Unknown or changed
  metadata aborts preparation/execution rather than expanding writes.

The cloud variance alert currently has `delivery_status=pending`, attempts 0 and
no acknowledgement. Preserve these existing values. Do not mark it delivered to
hide a duplicate-delivery risk. Source review found protected closing generates
notifications; normal download does not invoke that closing publisher. However,
actual local triggers/consumers still need verification before claiming that a
local insert cannot publish or resend anything. Reuse the existing cloud IDs and
do not enqueue `activity_events`, invoke a publishing RPC or fabricate new alerts.

## Required guarded transaction design

After complete evidence and constraints are reviewed, a proposed execution must:

1. Require the exact original SQL Server, database identity/GUID, branch, shift,
   canonical local before-image and pinned accepted cloud graph. Reject an
   enclosing transaction or unsafe session mode if the eventual script owns its
   transaction. Do not commit or roll back unrelated operator work.
2. Lock deterministic receipt key, parent, children, pending-work metadata and
   relevant ticket ranges in a reviewed order. Use bounded busy failure;
   no automatic retry of uncertain writes.
3. Recheck all 17 original parent facts, zero original child rows, exact existing
   cloud child links/IDs, branch/terminal ownership and absence of pending work.
   Validate losslessly, preserving decimal and timestamp precision.
4. Insert only the seven pinned rows in FK/dependency order and update only the
   17 approved parent fields. Keep real guards and constraints enabled. The
   unfinished-ticket guard must see a legitimate complete adoption transaction,
   not a special bypass flag.
5. Read back the full six-table target graph; require exact equality to the
   approved privacy projection and strict graph validation. Verify every
   unrelated row, checkpoint, cursor, queue, author intent, baseline and receipt
   sentinel remains unchanged except the explicitly approved maintenance receipt.
6. Save an honest local before/after receipt. Identical replay is a verified
   no-op; partial children, conflicting IDs, changed fingerprints, missing receipt
   parts, modified authority or different source facts abort the whole operation.

No broad checkpoint advance, queue acknowledgement, baseline forgery or permission
change is part of this transaction. RECOVERY53 may later finish its existing
normal scoped proof and checkpoint advancement if all prerequisites genuinely
pass; this maintenance operation must not perform that advancement itself.

## Isolated fixture acceptance contract

Prepare a uniquely owned disposable SQL Server database using the reviewed real
schema and captured trigger definitions. Synthetic fixtures must not import real
operator names, financial payloads, credentials or live connection strings.
No real execution artifact may be tested by changing its target to POS_Local.

| Scenario | Required outcome |
| --- | --- |
| Exact reviewed OPEN parent / no children / accepted CLOSED source | One 17-field parent update, seven child inserts, one reviewed receipt; full graph exact |
| Local CLOSED/cloud OPEN with pending closing | Hold and preserve local upload; never apply the fourth-shift direction to it |
| Changed parent, unknown local close/recount or any existing child | Abort; no parent, child, receipt or checkpoint writes |
| Different source branch/terminal/shift, invalid precision, forged receipt | Abort; retain all evidence |
| Held order for target or unassigned to a shift | Real trigger 51022; full rollback; ticket stays intact |
| Pending journal, local author intent or linked transaction | Hold; no acknowledgement or deletion |
| Concurrent parent/child/ticket writer | Busy failure or serialized revalidation; no mixed graph |
| Failure after any child insertion / parent update / receipt write | Entire adoption rolls back; no partial graph or accepted receipt |
| Exact replay | No additional rows, clocks, notifications or receipts |
| Conflicting/partial replay or authority-source tampering | Abort and retain state |
| Notification/alert insert | Preserve IDs, delivery flags and history; no dispatcher/network call or new activity publication |
| All unrelated shifts, sales, stock and current work | Unchanged, including the separately prepared three-parent repair scope |
| Subsequent normal RECOVERY53 attempt | Exact target matches naturally; no maintenance checkpoint reset |

These are acceptance requirements, not passing test results. Real data repair,
installed-device adoption and notification delivery remain unverified here.

## Order with the three-parent proposal

Prepare the two changes independently. If the owner approves execution in the
order **three-parent repair, then fourth adoption**, refresh and rebind the fourth
proposal's branch-wide before-image after the three-parent result is verified.
Do not bypass a stale all-branch fingerprint or silently add the three changes to
the fourth artifact. Conversely, replaying the three-parent artifact after the
fourth changes its protected branch state must be explicitly accounted for.

An in-flight RECOVERY53 run captured before maintenance may correctly refuse its
old inventory/fingerprints. Allow a fresh ordinary run under the existing native
scheduler after verified maintenance; do not force its old proof to pass. Compare
the full branch again, then verify natural graph adoption and checkpoint progress.
Publishing installers, production promotion, changing Membership or touching the
unavailable original cashier PC are outside this preparation.
