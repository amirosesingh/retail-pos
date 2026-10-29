# STR1 archived catalogue ownership repair: review only

Prepared and owner-approved/applied 2026-10-29. **594 exact products repaired.** A frozen, guarded review script is
available at [str1-archive-ownership-repair.review.sql](str1-archive-ownership-repair.review.sql).
It is not a schema migration and must not be replayed. Its fingerprints reject a retry.

Application evidence: owner explicitly approved the exact 594-product repair to
ROSEGILL POS. Pre-apply backup confirmed all 594 full-row fingerprints unchanged.
Transaction returned 594 before/after images, all assigned STR1; no differences
except owner_store_id,row_version,updated_at. Post-read: 2,169 total /1,569 active /
600 archived /600 STR1-visible archived. All repaired rows remain archived with
zero stock; foreign-cluster availability is zero. Verified 594 normal change_history
entries and 594 sync feed entries at repaired row versions. No checkout routine,
sales record, SKU, stock or price was changed. Local .pending archive backup and
application JSON files retain before/after images; do not commit business backups.
These current facts supersede the preparation-only statements below. Signed-in
UI refresh and installed SQL replication remain unverified; known higher-version
NULL-owner sync replay risk is still separate work.

Latest connector SELECT evidence supersedes earlier counts below: **2,169 total,
1,569 active, 600 archived, 6 STR1-visible archived, 594 hidden candidates**.
All 594 candidate maps are canonical, stored quantity matches canonical sum,
transfer projections are current, no foreign nonzero stock or conflicting
legacy owner mapping was found. Exact IDs and full-row MD5 fingerprints are
frozen in the review SQL. Any subsequent row change aborts the complete repair.
The earlier owner confirmation was for 592; request approval for this exact
594-row manifest before execution. Connector label beta resolves to the verified
live project/org, not an isolated test database.

Planned SET changes only owner_store_id to STR1. Existing triggers also update
row_version/updated_at, recompute unchanged canonical maps/projections, and append
normal change-history and sync-feed records. Postchecks reject any other product
field change, including stock, archive status, SKU, prices and e-commerce flags.
No checkout routine or transaction is updated. Guarded rollback requires saved
before/after images and rejection of subsequent legitimate edits. The supplied
script returns both images for secure capture; no live mutation has run.

Durability limitation: deployed sync_apply_products accepts newer row revisions
containing NULL ownership. A stale local product edited offline can undo this
repair on later upload; older/equal revisions are rejected. Fixing that sync
contract needs separate review/approval and should not be claimed complete here.

Final isolated verification: root and agent ran
`node scripts/test-archive-ownership-repair.mjs`; **11 cases passed**, including
stock/SKU/prices/archive/sale preservation, same-cluster allow/foreign deny,
audit/feed and safe retry, concurrent drift, missing row, unexpected trigger
mutation/deletion rollback, canonical-map/projection mismatch. The final SQL
locks the STR1 stores row FOR SHARE against concurrent cluster reassignment and
locks only reviewed products. Synthetic fixtures use representative trigger
contracts, not a live transaction. Application approval is still pending.

## Target and authority

- Connection nickname: **ROSEGILL** only.
- Organization: **rosegill0011@gmail.com's Org**, ID `bjxgimekljzlnwejuawj`.
- Project: **pos**, ref `qhrufhtbeguxydenzfey`; dashboard shows **main / Production**.
- Dashboard: <https://supabase.com/dashboard/project/qhrufhtbeguxydenzfey>.
- API URL: <https://qhrufhtbeguxydenzfey.supabase.co> (historically supplied by owner;
  the matching dashboard ref was independently verified).
- Branch: **STR1 / 361 Degree Sports**, ID
  `a611a328-2217-4d77-944a-5f6a637d123b`, verified in `public.stores`.
- Owner confirmed the 592 hidden archived products belong to STR1. This approves
  provenance and preparation for review, **not execution of a database update**.
  Identify this target again and obtain explicit application approval first.

## Read-only evidence and limits

Owner-opened Chrome Table Editor, postgres role, public.products:

| Filter | Count |
| --- | ---: |
| No filter | 2,169 |
| is_archived = true | 597 |
| stock_quantity = 0 | 596 |
| stock_quantity < 1 | 597 |
| is_archived = true AND deleted_at IS NULL AND owner_store_id IS NULL | 593 |
| Above plus stock_quantity = 0 | 592 |

Settled Inventory footer for STR1: total 1,577; active 1,572; archived 5.
The 592 ownerless zero-stock archived rows exactly match the count discrepancy.
This is aggregate evidence, not a captured manifest proving every row's full
stock map, transfer projection, legacy owner setting or sync history.

`src/lib/branch-policy.ts:createCatalogueVisibility` admits an owned product in
its branch/cluster, completed incoming-transfer availability, or nonzero local
cluster stock evidence for ownerless legacy rows. It excludes ambiguous unowned
zero-stock rows in private/multi-cluster catalogues. Matching database read rules
are in `20261026162030_isolate_cluster_catalogue_reads.sql`, which explicitly
did not backfill ownership. This explains the compatibility gap; it does not
establish which original import or sync wrote each NULL owner.

Automatic archive state uses the net numeric `stock_by_store` map. Do not infer
it solely from `stock_quantity`, change quantities, or re-run lifecycle backfills.
The negative-stock metric's exclusion of archived products is separate work.

## Required preflight before proposing executable repair

1. Reverify project, branch ID/code/name and configured cluster membership. The
   current stores UI verified branch identity, not its group_id value.
2. SELECT/export exact candidate IDs and complete before-images. The predicate
   is archived=true, deleted_at IS NULL, owner_store_id IS NULL,
   stock_quantity=0. Require the reviewed cohort of 592; stop on drift and review
   the difference rather than broadening or forcing a count.
3. Check each candidate's stock_by_store, catalogue_store_ids, legacy
   integration_settings.productOwners and actual transfer/purchase evidence.
   Surface conflicting non-STR1 ownership/provenance; do not overwrite it.
   A zero bucket by itself is not ownership proof; the owner's explicit
   confirmation supplies the missing business decision for the reviewed cohort.
4. Inspect live products column types, all UPDATE triggers, audit hooks,
   row-version rules and sync routines. Verify the update cannot silently
   reactivate items, change stock, replace prices or clear transfer availability.
5. Determine whether old local SQL replicas can upload NULL ownership again.
   If that requires a code/schema change, present a separate beta-first batch.
6. Prepare SQL through the documented migration workflow, then test it on an
   isolated schema with representative actual trigger contracts. Test changed
   candidates, conflicting owners, concurrent edits, retries and rollback.

## Proposed write scope, once separately approved

Freeze the reviewed IDs; update **only missing owner_store_id** to STR1 within
one short transaction. Do not select the write population by a broad filter at
execution time. Recheck each frozen before-image under appropriate row locks and
abort on drift. Respect existing audit/version hooks; document any unavoidable
metadata side effects before application. Never disable triggers or RLS to make
the repair succeed. Preserve stock maps, quantities, archive/deletion status,
prices, costs, business records and all grants.

Private stock and catalogue visibility are separate: branches in STR1's existing
cluster may see its catalogue according to existing authorization, while private
quantities stay restricted. Do not change cluster assignments or privacy switches.
Membership stays ON HOLD.

## Acceptance and recovery

- No unexpected before/after field changes; no duplicate products or quantities.
- With unchanged data, STR1 should gain the reviewed 592 archived rows: footer
  2,169 total / 1,572 active / 597 archived. These are provisional expectations,
  not a reason to force totals or bypass ownership/authorization.
- Archive rows and footer use the same authorized catalogue before search/table
  filters. Same-cluster visibility and other-cluster denial must both be checked.
- Verify cloud reload plus applicable local SQL propagation and stale-upload
  handling; do not declare Windows/phone behavior verified from a web view alone.
- Preserve exact before-images and applied ID manifest. Recovery must target
  only repaired IDs whose state has not subsequently changed and must undergo
  review; reverting ownership will hide these items again. Do not blindly clear
  owners or overwrite subsequent legitimate edits.

Pending: live trigger/sync preflight, captured manifest, isolated executable SQL
tests, application approval, execution and post-repair verification.

## Separate private-stock gap: INV-10

The live STR1 location dialog confirms group/cluster **361 DEGREE SPORTS** and
both Private stock and Private catalogue enabled. Source and independent agent
review confirm same-cluster catalogue sharing already precedes private-catalogue
fallback checks. Do not disable either switch as a workaround for missing owners.

However, privateStock is only consumed by All Shops stock presentation.
OtherSourcesPopover displays other active stores' quantities without that policy;
inspected online/native product reads return full stock maps without a
private-stock projection. This requires a separate reviewed correction batch.

Proposed source scope: clearer policy copy in branch-policy.ts; one explicit
stock-read policy for trusted terminal branch versus authorized management scope;
Inventory Other Sources and all other consumers of that policy; cloud/native
read projections and their contracts, with allowed/denied regression cases.
Any required schema/RPC change must be reviewed separately before live deployment.

Do not simply remove buckets from Product.stockByStore: product-lifecycle.ts
recomputes company-wide archive state from it, and commitSale/financial-stock-policy
validate full-map stock changes. Preserve these authoritative contracts or
introduce a separately tested server-authoritative replacement. A zero current
branch with positive private sibling stock must retain the correct product state.
Hidden quantities must not be misrepresented as real zero stock.

DEC-45 resolves the management clarification: authorized management retains
private-stock visibility within its granted scope; normal terminals expose only
their own branch quantities, including when the signed-in user is a manager.
Management device classification alone grants no account entitlement.
The initial 35 focused catalogue/mapper/native SQL tests passed. The separately
approved DEC-46/47 display batch is now implemented with 14 suites /114 tests,
types/lint/diff checks and independent candidate review. It does not enforce
privacy on raw cloud/native stock maps; no end-to-end confidentiality claim is
made. Live popup inspection could not finish because the preview was signed out.

### Proposed controlled implementation batches

1. **Stock presentation and regression contract: implemented, scoped-verified.** Introduce a pure shared
   stock-display policy using existing terminal/account scope; apply it to
   Inventory Other Sources and All Shops. Update the misleading private-toggle
   descriptions in branch-policy.ts without renaming saved keys. Keep product
   catalogue filtering and full authoritative stock maps unchanged. Tests must
   cover normal-terminal manager/cashier own-branch restriction, management
   allowed/denied scope, private foreign branches, hidden-versus-zero states,
   same-cluster products and zero-stock archive/checkout non-regression.
   DEC-47 additionally limits popup rows to permitted active sources with
   positive stock inside the selected cluster. This batch alone is a display
   correction, not full database confidentiality. Source remains uncommitted.
2. **Authoritative cloud/native read contract.** Review direct Supabase reads,
   relay queries, native snapshot/repository projections and export/sync consumers.
   Enforce stock read scope at each boundary; preserve server-authoritative
   lifecycle metadata and safe stock mutation contracts. Existing full-map sale
   validation must not receive a truncated map. Prepare any required read/RPC,
   write-contract and local SQL migrations with isolated regression tests before
   proposing deployment. Do not weaken RLS, grants or terminal identity checks.
3. **Separately approved legacy data repair.** Capture/test the exact 592-row
   manifest and execute only after project-specific application approval.

Recover source batches using separate reviewed beta commits/reverts. Recover data
only from verified before-images after checking for subsequent legitimate edits.
Full cloud/Windows/phone privacy verification remains pending across all batches.
