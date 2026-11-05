# STOCK68: stock at an exact effective time

Status: draft quantity kernel plus storage/capture/authorized-read foundation.
Current beta `8b1cb17b` is integrated by feature merge `e4f3badb`. Main/IPC,
complete writer coverage, validated cloud upload, activation and Inventory UI/export
remain unfinished. No database change has been applied and no baseline established.
The foundation does not certify complete history or a production-ready report.

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

No proposed ledger, baseline backfill, RPC or schema change has been applied to a
live database. No current business stock correction or production publication has
been performed. The following foundation runs only in isolated fixtures.

## STOCK401 foundation checkpoint — 5 November

Owner explicitly approved completing the report, including the necessary additive
storage, atomic capture, existing sync-lane integration and authorized reads. The
receiving-time decision is **actual goods arrival**, defaulting to the original
Main/save physical stock-operation instant unless an authorized explicit arrival
is supplied. Invoice date is separate. Do not infer arrival from old invoice dates
or backfill old rows. That arrival-input UI is not implemented in this checkpoint.

The latest urgent release decision defers this entire unfinished draft. Do not
merge PR401 or include prepared local031 in the urgent production/SQL72 bundle.
UI/export are unstarted/deferred. The upcoming local upgrade bundle025–030 and
current production candidate exclude this stock preparation. No live cloud/local
DDL, activation, historical repair or publication is authorized by this checkpoint.

Prepared files:

- CLI-created `20261105113916_stock_history_effective_ledger.sql` proposes four
  stock-history tables, exact effective-time ticks/raw instants, immutable claims,
  RLS/revoked client writes and a service-only bounded-row read RPC. It is marked
  DRAFT/not applicable yet. Existing colliding objects cause review-required abort;
  this is not an approved upgrade of an installed history schema.
- `database/sqlserver/prepared/031_stock_history_effective_ledger.sql` is outside
  the auto-installer. It creates four optional metadata tables, checks53 exact
  column definitions and56 constraint/default/index/FK/trigger fingerprints,
  rejects unknown/partial/registered-but-missing structures and preserves an
  existing outer transaction. No business rows/openings are inserted. Native-only
  local commit cursors are separate from cloud ingestion cursors.
- `electron/db/stock-history*.cjs/json` prepares physical-schema capability,
  immutable original JSON/hash, stable operation/product/location legs, source
  activity/adjustment/stock-receipt references and a scoped SQL reader. Capability
  is bound to the live pool, database GUID and observed schema generation.
- Optional hooks in OperationsRepository, AggregateRepository, ReceiptRepository
  and the FIN62 repository factory stay **null by default**. No Main factory or
  IPC installs/activates the store. The prototype captures existing persisted
  effects or freezes a pending authorized domain movement in the same transaction
  and existing journal; it never applies a second stock delta. Capture uses one
  bounded metadata batch per affected branch instead of one query per item.
- `stock-history-report`, validation, client/functions/server and hosted-function
  registration prepare the read contract. Windows requires a future dedicated
  Main reader; there is no native IPC implementation yet. Web/phone reads reuse
  current credential/scope helpers and current database actor/terminal/branch
  checks. Management preserves its existing online path, not a new local replica.
  No generic ledger write/upload API is exposed.

The actual receiving aggregate revealed an existing deferred-effect path: it
saves purchase documents/activity locally; cloud stock application occurs later.
The prototype therefore retains that original physical intent and its source IDs
as **pending**, without changing existing stock arithmetic. A future server adapter
must prove the actual accepted effect before accepting/counting the history leg.
Existing ordinary native sync permits terminal-only background uploads; that is
not fresh staff authority for original actor/backdated claims. Unknown actor/time
grades remain incomplete. Do not fabricate author signatures or strengthen this
into a new authentication protocol without separate reviewed authority.

Verified foundation evidence on frozen runtime source:

-81 focused tests across five suites passed:32 quantity-kernel,19 protocol/schema,
  15 actual isolated PostgreSQL reader/admission,10 actual server-function/current
  account-scope composition and5 existing native checkout-stock guard cases.
-20 actual uniquely owned disposable LocalDB groups passed: exact/idempotent schema,
  no backfill, atomic product/evidence/journal rollback, unchanged replay, awaited
  source handover, immutable claims, branch/export denials, zero/archived pagination,
  100ns cutoff and source-resolved CLOSED shift, late pre-baseline invalidation,
  actual receiving aggregate/retry and foreign denial, unknown constraint refusal,
  and caller-owned consolidation transaction. The fixture cleans only its own
  `CodexStockHistory_*`/`StockHistoryFixture_*` instance/database, never POS_Local.
-PostgreSQL tests reuse current read/write scope validator definitions and actual
  mobile Management helper parity. Bare activation/direct anon/authenticated RPC,
  current permission/page/branch/terminal/capability revocation and export denial
  are tested. These are isolated/source compositions, not deployed device acceptance.
-TypeScript, scoped ESLint and diff checks passed. No full-suite, actual PostgREST,
  hosted CPU, installed report or historical coverage acceptance is claimed.

Resume in this order:

1. Independent foundation review; do not reuse old91e4 CI for the new source.
2. Finish original-byte/native source identity and actual cloud stock-effect
   binding; use existing durable lane/receipts. Keep ordinary stock background
   uploads working and all history pending until a valid matching acknowledgement.
3. Capture every actual stock writer including refunds/reversals, receiving and
   correction, each transfer leg, sponsorship/missed-bill modes, import/count,
   absolute edit/creation/merge. Add verified creation/zero-before-birth evidence;
   do not silently omit post-opening products. No arbitrary history upsert.
4. Complete exact cloud/local shape checks, bounded byte responses and optional
   registry/engine capability integration. Missing all tables preserves old core
   business sync; unknown/partial history is explicitly unavailable.
5. Select a proven eligible opening at/before the requested time; newer openings
   must not erase previously supported dates. Preserve source revision/pagination,
   late<=opening invalidation, retention, terminal watermarks, pending and clock
   uncertainty. No real opening/terminal-cohort coverage has been proved yet.
6. Wire genuine Main POS session/branch/profile/epoch reads/capture and test actual
   IPC, online/offline/restart/long-outage sync, then Inventory dialog/export.
7. Run combined full regression, independent review and beta/device acceptance.
   Present exact cloud/local files/hashes/targets before any application. Only then
   consider beta integration and separately approved production promotion.
