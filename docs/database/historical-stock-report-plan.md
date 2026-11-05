# STOCK68: stock at an exact effective time

Status: quantity kernel and synthetic tests implemented; database, loader, writer
and UI integration are not implemented or applied. Baseline: beta `a73f24e8`.
No application routes use the kernel yet. It does not authenticate callers or
certify that supplied history is complete.

## Approved meaning

The owner selected actual operational stock at an exact selected instant. A late
offline movement uses its original physical/effective time and may restate an old
report. Arrival/recording time remains separate. This is not a reconstruction of
what an observer knew at that earlier time. Date+time use the configured IANA
zone; ambiguous/nonexistent local DST times need explicit resolution, never a
silent offset guess. A shift-closing shortcut uses the actual raw `closed_at`,
including submillisecond precision, rather than a rounded minute or duration.

Quantity at T = verified opening at B + unique committed movement deltas with
B < effective_at <= T. Opening includes movements through B. New arrivals with
effective_at <= B invalidate an older baseline unless authoritative coverage can
prove their inclusion; the kernel returns incomplete and requires a rebase.
Corrections append compensating deltas; they do not rewrite old ledger rows.

## Existing evidence and gaps

| Path/source | Evidence | Missing for a trustworthy arbitrary-date balance |
| --- | --- | --- |
| `src/routes/reports.stock.tsx`, `src/lib/stock-adjustment-report.ts` | Adjustment history, paginated and scoped | Not an opening balance or all movement types |
| `public.item_activity_logs` in schema | Deltas, optional before/after, activity type, created_at | Not every stock writer emits it; no separate effective/arrival times |
| `public.stock_delta_applied` | Idempotent movement/product/location delta receipt | applied_at is arrival/application time, not reliably original physical time |
| `electron/db/repositories/receipts.cjs` | Native refund receipt and product stock update in one transaction | Does not emit a matching item activity row |
| `src/lib/pos-store.tsx` upsert/merge paths | Absolute stock edits/merges | Need atomic before/after-derived delta capture and historical identity mapping |
| `electron/jobs/retention.cjs`, schema registry | Activity history retention can remove old acknowledged rows; default history depth is90days | Old logs cannot be silently treated as complete |
| Receiving, transfer and missed-bill paths | Domain documents/stock modes and existing stock-delta routines | Must verify each physical leg/time, corrections and backdated goods movement before assigning effective time |

The base schema has multiple historical routine definitions. Exact current live
definitions and canonical latest migration sources must be captured and compared
before any future writer upgrade. A function name in schema.sql is not proof of
the installed definition. Never replay the whole schema.

No complete immutable opening baseline or historical cost/price/rule catalogue
was established. Do not backfill openings from today's quantities or infer an
effective timestamp from maximum row_version, receipt arrival time, a shift's
closing time, or an invoice date alone. Current catalogue prices/costs are not
historical valuation evidence. This first engine calculates quantities only.

## Implemented safe kernel

`src/lib/stock-as-of.ts` accepts already-authorized, snapshot-consistent evidence:

- Full historical product/location pair scope, including zero/archived products.
- An explicit opening snapshot, its physical cutoff and capture time.
- Unique movement-leg IDs, signed integer quantities as strings, original
  effective instants and separate arrival instants. `recordedAt` is the commit/
  ingestion time at this report source, not the offline PC's original recording
  time. Preserve original local recording separately so a newly arrived movement
  cannot appear to have been included in an older opening snapshot.
- A trusted loader's completeness bounds, read instant and immutable read
  revision. These inputs are not a permission or completeness proof by themselves.

It uses exact integer arithmetic and100ns timestamp comparison, bounded at20,000
product/location pairs and100,000 movements. Exact duplicate replay is ignored;
conflicting movement IDs, malformed quantities, future recorded evidence and
cross-scope rows fail. Missing openings, history gaps, unknown coverage or late
pre-baseline arrivals yield null quantities, not zero or invented estimates.
Negative quantities remain visible. It makes no network/storage/write calls.

The synthetic tests cover during/after-shift cutoffs, raw close precision,
offset equivalence and ambiguous wall times, late arrivals/restatement, exact
replay, changed replay, transfer legs, after-cutoff returns, negative/large
integers, missing baselines/coverage, archived/zero pairs, scope refusal and
oversized evidence. These are kernel tests, not installed integration acceptance.

Independent review reproduced and corrected order-dependent intermediate overflow:
valid near-limit movements can cancel after an unordered page merge. Accumulate
bounded exact integers, then enforce the38-digit final-balance limit. Four new
positive/negative cancellation and true-final-overflow regressions pass. Final
focused run:32 kernel plus4 stock-adjustment tests passed; scoped lint/diff checks
passed. No full-suite or installed report acceptance is claimed.

## Proposed next independently reviewable batches

1. **Ledger and baseline contract, preparation only.** Add append-only stock-leg
   evidence and immutable opening snapshots/coverage metadata to cloud/local SQL.
   A leg needs unique movement ID, operation/source identity, business/branch/
   location/product context, original actor/terminal, quantity delta, effective
   time, local recording time, cloud arrival time and monotonic ingestion position.
   Preserve offline device-clock uncertainty and show provisional coverage when
   original physical time cannot be proved. Enforce uniqueness/immutability and
   use existing authorized transaction writers; expose no generic client ledger
   write or new permission grants. Existing stock/business rows remain unchanged
   on schema application. Exact reviewed files/hashes need owner approval later.
2. **Atomic writer capture.** Capture delta evidence and durable outbox entry in
   the same transaction as sale, refund/reversal, receiving/correction, dispatch
   and receipt legs, count/adjustment, import/restock, initial stock, absolute edit
   and merge. Reuse existing movement IDs and acknowledgements to prevent double
   counting header/activity/receipt representations. Do not change quantities or
   existing stock picking/approval/calculation semantics. A count records its
   actual previous-to-counted delta. Historical missed-bill stock mode determines
   whether any physical movement exists; do not invent a backdated deduction from
   sale.created_at without that evidence. This batch touches shared financial/
   inventory writers and needs separate scoped review before implementation.
3. **Activation/coverage.** Establish a reviewed opening after all relevant
   terminals' pending stock work is accounted for, or mark coverage incomplete.
   A software upgrade alone cannot certify old history. Never discard an offline
   terminal's outbox to establish a baseline. Retention may not delete required
   ledger/baseline evidence or unacknowledged operations. Dates before proven
   coverage remain unsupported unless independently reconciled evidence exists.
4. **Authorized read adapters.** Reuse trusted terminal branch, user report/
   warehouse permissions and cluster catalogue guards. Normal terminals cannot
   obtain another branch's protected historical stock merely because a same-
   cluster positive-availability exception exists. Web/management read only
   granted scope. Use bounded service read RPC/native SQL aggregation and keyset
   product pages filtered to a captured immutable ingestion watermark; all pages
   share one source revision and effective cutoff. Recheck authorization each
   request. Avoid downloading all historical transactions into the browser or
   running this100k-row kernel inside a10ms Worker request. Test SQL/kernel parity.
5. **Inventory UI/export.** Add a distinct Stock as of view without replacing the
   adjustment report/current inventory. Show date/time/zone, location, raw shift
   cutoff shortcut, source/read revision, effective-time/restatement note,
   coverage start/gaps and offline/pending/provisional state. Incomplete history
   must not render zero balances. Keep cost/retail valuation out until historical
   price/cost evidence and costing rules are approved. Export inherits identical
   scope/coverage metadata; no cost/other-branch data leaks through exports.

Required integration checks include native/cloud parity, parallel tills and
late uploads,100ns boundaries/DST, partial returns, dispatch versus receipt,
receiving corrections, count/merge/import, missed-bill stock choices, duplicate
and interrupted operations, baseline invalidation, history retention, branch/
warehouse/cluster denials, revoked permissions and responsive rendered UI.

No proposed ledger, baseline backfill, RPC, schema change, shared writer change,
current stock correction or production publication has been executed here.
