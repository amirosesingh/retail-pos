# Three STR1 product catalogue differences — repair preparation

Status: exact owner-approved guard and three-row repair applied on 6 November;
cloud readback and ordinary local Electron adoption verified. History-table
completion and final release acceptance remain separate.
The exact applied files and hashes are recorded below. This document is not
executable SQL. The root agent owns the repair file, fresh captures and final
application proposal.

## Exact target and proposed change

- Connector: **ROSEGILL**.
- Organization: **rosegill0011@gmail.com's Org** (`bjxgimekljzlnwejuawj`).
- Project: **pos** (`qhrufhtbeguxydenzfey`), database **postgres**.
- API: <https://qhrufhtbeguxydenzfey.supabase.co>.
- Dashboard: <https://supabase.com/dashboard/project/qhrufhtbeguxydenzfey>.
- Source branch: **STR1**, `a611a328-2217-4d77-944a-5f6a637d123b`.

Prepare one guarded transaction assigning only `products.owner_store_id` from
SQL NULL to that STR1 branch on exactly these three existing product IDs:

| Product ID | Current owner | Proposed owner |
| --- | --- | --- |
| `27b5b2a7-71c3-4334-9b15-6087aeab8cf0` | NULL | STR1 |
| `29da1541-a922-40f9-aaf5-b336b24107a8` | NULL | STR1 |
| `9ffab37c-7d1e-425b-b4b1-bf887be41714` | NULL | STR1 |

Do not copy stock from either database or assign ownership to other ownerless
products. Existing cloud quantities/maps stay zero. Preserve SKU, barcodes,
prices, catalogue transfer projections, archive/deletion flags, sales, payments,
permissions, settings, local queues and checkpoints. Normal existing triggers
may advance product row versions/update times and append the normal audit/feed
evidence; verify their exact effects against the freshly captured definitions.

## Confirmed cause and provenance boundary

The root's read-only comparison reports original STR1 goods receipts dated
8 October and accepted STR1 sale movements of minus one on 5 November for each
product. Their current cloud quantity is zero; the local copy still has one.
The exact receipt, sale, movement and acceptance identifiers must be frozen with
the final preflight before an executable repair is approved. This source
provenance, rather than whichever terminal currently holds a positive stock
value, is the reason STR1 ownership can be proposed.

The catalogue rules intentionally admit an owned product to its source branch
and sibling cluster even after stock reaches zero. An ownerless legacy product
instead needs nonzero stock or accepted transfer evidence in that cluster, apart
from the narrowly permitted legacy shared catalogue. These three original
products retained NULL ownership. The accepted sale made their cloud quantity
zero, removing the remaining stock-based visibility proof. Stale local quantity
one still supplies that local proof, producing a catalogue/count difference.

This is the same missing-provenance class documented by the earlier
[22-product repair](str1-22-product-ownership-repair-plan.md). That repair's frozen
zero-stock cohort did not authorize assigning every remaining positive legacy
product. Do not replay its SQL, substitute three IDs into its old captures, or
replay the earlier 594-product repair.

The current ordinary new-product save and import paths already call
`branchOwnsNewCatalogue` and stamp the creating branch for grouped/private NEW
catalogues. Existing-product edits deliberately do not guess a missing original
owner. Canonical/native code already preserves a repaired owner against
NULL/blank legacy uploads, but the captured live cloud routine does not yet
have that protection. The separately prepared upgrade below must be approved
and applied before the three-row repair. Thus the investigated three records
are a legacy ownership gap; no current new-product stamping regression has been
established by this investigation. Other positive ownerless legacy products can
reach the same condition later and need a separate provenance review, not a
stock-based blanket ownership assignment.

## Why ordinary sync has not corrected the local copy

The protected feed preserves the original event cursor and product ID while
the catalogue-filtered row lookup can return `row_data = null`. This is an
ID-only invalidation, not a product deletion. Current `CloudClient` skips a
non-tombstone null payload because it has no registered primary-key values to
apply. `PullWorker` commits the consumed feed cursor. Catalogue snapshots omit
the unavailable product and do not prune retained local rows.

An isolated actual `CloudClient` plus `PullWorker` reproduction confirmed zero
product SQL writes and an advanced feed cursor for such a null payload. The
existing merged/progress counters count the consumed entry as one even though
no product value changed; they are not evidence of a stock write. The ordinary
metadata journal stores keys, entity versions, aggregate IDs and acknowledgement
times, not an exact accepted product before/after baseline. Zero pending rows
alone does not establish stock authority.

Do not make every non-tombstone null payload block the feed: legitimate global
events for another cluster can have exactly that privacy-filtered shape. A future
typed visible/out-of-scope/missing protocol and any catalogue revocation cache
would be separate reviewed security scope. This three-row repair needs neither
a null-as-delete rule nor a new out-of-catalogue signal.

## Normal adoption after an approved repair

An explicit STR1 owner restores the three cloud catalogue relationships even at
zero stock. The normal product-update trigger emits new feed entries; STR1 and
authorized sibling-cluster downloads can then receive complete product rows.
Other clusters remain excluded without a separately valid transfer relationship.
Existing guarded native sync, rather than maintenance SQL on a terminal, should
adopt the already-existing cloud zero quantities and repaired owners.

Before relying on that adoption, compare current local/cloud versions and local
pending evidence. The ordinary product merge does not overwrite a higher local
version, and unacknowledged local edits block a feed page. A newer local number
or timestamp is not itself proof of financial authority. Verify valid products
Change Tracking bounds/checkpoints, product/activity/delta journals, accepted
movement receipts, and the three exact source records. Unknown or conflicting
local work remains retained and requires a separate plan. Do not reset tracking,
clear queues, lower a local version or force a cloud snapshot to make this pass.

## Guard and fixture reuse

Reuse the existing `test-ownership22-repair.mjs` architecture, not its historical
production metadata: build disposable PGlite and native PostgreSQL fixtures from
the new captured table/constraint/trigger/function definitions, preserving raw
CRLF bodies and relevant owner, security, search-path and ACL attributes. Change
only synthetic fixture rows and their expected before-image hashes in tests.
Keep the real trigger execution path and a transactional synthetic realtime
sink; do not replace those triggers with simplified approximations.

The new artifact should pin the three full before-image fingerprints, exact
branch/cluster identity, original receipt and accepted sale/movement provenance,
and current trigger/routine/schema layouts. Use its own maintenance advisory lock
and audit key. Lock the source branch identity and exact product rows without
waiting indefinitely; changed, missing, busy, foreign or ambiguous records abort
the entire transaction. Run the captured metadata guards before DML and before
commit. Keep every trigger/grant enabled and make no routine or DDL change.

Verify that the sole product delta is owner plus normal version/time, and that
all zero-stock maps, SKU counters, unrelated products and business tables remain
unchanged. With the same relevant trigger structure as the 22-row repair, expect
three product history records, three global product-feed records, one honest
maintenance audit and its one branch audit-feed record. Fresh capture and tests
must confirm these counts; realtime wake hints are best effort, not proof of
durable acceptance. A valid replay must prove the original receipt and complete
before/after evidence and perform no new writes. A changed or fabricated receipt
must fail closed.

Required cases include exact success/replay; foreign or changed provenance;
missing/changed product or branch; changed/disabled/extra triggers or routines;
injected mutation/deletion; transaction failure after the product update; actual
lock contention; preservation of stock/SKU/prices/archive state and unrelated
sales; same-cluster allow and foreign-cluster deny; stale NULL-owner upload;
and actual native adoption with an existing pending edit retained. The final
application proposal needs the committed artifact's SHA256 and exact normal
effects, not only a passing helper or an aggregate count.

## Acceptance, unknowns and rollback boundary

After separate approval and fresh preflight, verify the exact three owner changes,
unchanged remaining cloud product fields and accepted sale/delta records, one
maintenance receipt and the normal history/feed counterparts. Then observe
ordinary Electron sync without clearing or resetting anything: the owners and
zero quantities must arrive, pending work must remain protected, same-cluster
visibility must persist at zero, and foreign-cluster access must remain denied.
Reconcile the complete applicable table counts on the same current branch and
profile. Total stored products do not increase. Do not declare the three
differences fixed from the maintenance result alone.

Prepared evidence: exact cloud versions8/11/10 exceed the stale local7/10/9; owner repair should produce9/12/11. All three stock maps contain only STR1 at0, all are archived, all transfer catalogue projections are empty. Original posted receiving+1 and accepted sale-1 identities and all six applied movement receipts are checked inside the transaction. Local CT proves old CLOUD product projections predate the downloaded accepted sale/delta records; exact related pending work is0. Dates alone do not choose authority.

Root verification:25 isolated captured-trigger PGlite and26 actual native PostgreSQL repair scenarios pass, including the extra foreign-receiving guard, independent parent-lock contention and verified owned-fixture cleanup. The real SQL Server CloudClient/PullWorker/PushWorker adoption fixture passes6 groups: normal owner/zero/archive adoption with exact saved100ns archive times, replay/no duplicate uploads, branch/proof/context refusal and pending-edit/cursor retention. Existing SKU/prices/sales/receipts stay unchanged. The live upload-owner guard separately passes61 captured-source PGlite and61 native PostgreSQL cases plus29 existing checks; current branch admission, OID/ACL and all other source bytes remain unchanged. Final independent review/CI and live post-application acceptance remain required.

Prepared repair file: scripts/maintenance/repair-str1-three-product-ownership.sql, SHA256 E6F3D4C4C3C36D7A2ADF1E200338CF236DCDFB4F014870BF0DA5574D484CBAB0. Required first upgrade: supabase/migrations/20261106015347_guard_existing_product_owner_during_native_sync.sql, SHA256 5669C64B22FDFE3ADDDBCE7DCBDE807EABB5099655626CD1E68C9EEE5A98CB35. It preserves repaired ownership only against NULL/blank legacy uploads; it rewrites no products and changes no existing grants. The older29October preparation was absent from the live ledger; canonical/native protections alone were not live-server evidence.

A separate read-only count-contract gap was discovered during acceptance: live counts cover69/70 tables and omit change_history; history insert feed wiring is also absent. Its count/feed/recovery preparation is separate, not part of this three-row repair or permission to skip history. Do not claim all-table convergence from resolving these three products.

Keep secure complete before/after images outside Git. Rollback requires a newly
reviewed plan against those exact images, preserving append-only histories and
rejecting subsequent legitimate edits. Do not clear normal feed history, reverse
accepted sales or blindly restore a backup. No checkout/permission rollout,
unrelated historical-stock-report change or installer publication is authorized
by this repair preparation.

## Applied checkpoint — 6 November

The owner approved both exact hashes after checks. Required CI passed at
`b440aae2b1643defdf5f04916aeec5e72228979e`; fresh target health, identity,
routine/OID/ACL and all three full before-image fingerprints matched. The guard
was applied first through migration ledger `20261106024316`, preserving OID26279,
the existing grants/security mode and all product values. Its readback body MD5
is `a076aea59e1cc926542052040f20465e`.

The exact guarded repair then committed. Readback confirmed only ownership and
normal row version/time changes, versions9/12/11, unchanged stock0, SKU, prices
and archive state, three product histories, three product-feed events and one
maintenance audit with its branch feed. Product events164989–164991 and audit
event164992 are durable. STR1 and BET2 catalogue predicates both admit all three;
no other active cluster exists in this current live directory, so foreign-cluster
denials remain isolated-test evidence rather than a claimed live user test.

The existing local Electron app was closed and reopened against unchanged merged
beta source/profile and the existing SQL connection. Its ordinary synchronization
advanced the existing feed cursor164856→165028 without resetting it. SELECT-only,
GUID-guarded readback of LAPTOP-N0QBONGL\\LCRPOS / POS_Local / database GUID
CEAFA630-D613-423C-8997-8A31DF70C506 confirmed all three owners, stock0, archive1
and versions9/12/11. No manual local product write, extra deduction, queue clearing
or registration/configuration change was performed. Private before/after evidence
is retained under the ignored `.tmp` application proof. This proves these three
normal product downloads, not complete history synchronization or checkout
acceptance for the eventual release. Do not replay or extend this repair to other
records without a separately reviewed manifest.
