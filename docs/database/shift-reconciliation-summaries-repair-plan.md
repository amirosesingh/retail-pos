# Shift reconciliation summaries: read-only repair proposal

Prepared 3 November 2026. This is a plan, not an executable repair or live-change approval.

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

Before preparing executable SQL, capture and review exact row versions and
fingerprints, original count/reconciliation IDs and audit implications. The
eventual transaction must lock these exact rows, abort on changed facts, require
the same branch and unique ORIGINAL count/reconciliation relationship, require
all five destinations still NULL, and recheck finite/nonnegative/two-decimal
amount and variance/status consistency. Validate each full graph after changes
and roll back the whole repair if any predicate fails. Include a maintenance
audit with reviewed before/after fields and verify readback before permitting
normal sync adoption. Existing triggers may publish normal sync-feed updates;
their precise effects must be included in the later approval.

Do not recompute today's expectations, change counts or existing non-NULL
summaries, dates, actors, status, permissions, stock, sales or current drawer.
Preserve existing card/digital variance fields. Do not reset checkpoints or
weaken graph validation. No mutating historical SQL is supplied by this plan.

## Excluded eighth shift and authority boundary

`1a349429-cea1-4f45-8d2b-36678d37ad27` (STR1, opened 31 October)
is excluded. Its cloud closing is the later administrator web action; the owner
selected the original cashier closing on the affected production PC as the
single effective closing, retaining the web action in audit history. That
separate #359 authority/recovery repair remains ON HOLD. Filling cloud summaries
for this shift would implicitly validate the later graph and must not be folded
into the seven-row proposal. The development SQL database has no copy of this
shift; the original cashier copy belongs to the other affected PC.

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
