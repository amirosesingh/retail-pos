# POS task tracker

Last reconciled: **2026-10-29, Asia/Brunei**.
Read [../AGENTS.md](../AGENTS.md) and [PROJECT_MEMORY.md](PROJECT_MEMORY.md).
This is the single current task ledger. Existing audit/checkpoint documents remain
supporting evidence, not competing completion lists. Batch 0 authorized documentation
only; the owner's subsequent Batch 1 approval below authorizes its bounded fixes.

## Active plan and approval boundary

| Order | Batch / current state | Exit requirement |
| --- | --- | --- |
| 0 | **Verified: owner-approved documentation only** | Original rules preserved; memory/ledger linked; carried-forward tasks and branch-lock decisions recorded; documentation-only checks and independent review completed. See evidence log. |
| 1 | **Implemented: owner-approved trusted terminal identity and native branch boundaries** | Code commit `608398c6` pushed to beta PR #341; isolated regressions and CI passed. Preserve real-device and alternate-authority acceptance limits below. No live DB change or publication. |
| 2 | Pending approval: management/account scope and alternate authority paths | Correct assigned/selected/terminal scope without blanket role grants; review direct database and legacy RPC boundaries. |
| 3 | Pending approval: settings and permission lifecycle | Section/path/tier ownership, live permission semantics, revocation and saved-state checks agree. |
| 4 | Pending approval: atomic booking collection and receipt recovery | One authoritative financial/stock/link transaction; stable replay; canonical payment identity; ambiguous legacy records remain review-only. |
| 5 | Pending approval: received-payment accounting and remaining sync/inventory gaps | Deposits counted once when received; pending-origin integrity; reviewed warehouse/cluster findings. Split into smaller batches where dependencies require. |
| 6 | Scoped UI refinements DEC-23 through DEC-30 implemented/verified; broader UI audit pending approval | UI-08/10/11/12 scoped verified as recorded below. Broader audit and final physical-device regression remain separate. |
| 7 | Report-only correction implemented / scoped-verified, DEC-32 / FIN-11 | Separate commit after c514762d; align report scope/refund totals and adjustment/sponsorship labels. Preserve checkout/receipts/stock, records and formulas. Publish source to the beta PR and check CI. Owner compares originals for suspected missing bills. |
| 8 | Approved Archive UI clarification DEC-38 / INV-08, committed / scoped-verified | Separate active/archived totals, mode and search/advanced filter context use the authorized catalogue. Commit `45893068` pushed to beta PR #341; tests/types/lint/build passed and desktop/390px render checked. Its CI is running. Stored-count completeness and final live filter interaction remain unverified. |

Membership is **ON HOLD** throughout. Each future batch requires a recoverable
baseline, specific files/dependencies, expected behavior, risks, regression tests,
recovery plan and owner approval. This roadmap does not grant implementation,
database, merge, release or production-promotion approval.

## How to maintain this file

- Capture each new instruction/correction before dependent implementation; add or
  update an ID, source/decision reference, affected scope, acceptance and next step.
  Use the decision log below when it supersedes earlier wording. Update memory for
  an approved lasting rule, not every experiment or suspected defect.
- Preserve unfinished tasks through new requests, pauses and handoffs. Record
  cancellation/supersession explicitly; never remove an unresolved row to tidy up.
- Keep a single editor per file during agent work. Delegate bounded investigation
  or implementation with explicit authority, then independently reconcile evidence.
- A defect record needs expected/actual behavior, reproduction, roles/branch/
  warehouse scope, files/API/DB objects, confirmed cause or remaining uncertainty,
  business impact, proposed correction and regression acceptance. Use IDs in PRs
  and verification notes. Link a detailed artifact instead of duplicating it.
- Completion requires evidence for the stated acceptance at the stated revision/
  environment. Separate code implemented, isolated tests, runtime/device checks,
  SQL applied, PR merged, website deployed and installers/OTA published.
- Source-confirmed means a traced implementation path, not an executed production
  exploit. Never run financial/stock mutations against real data to demonstrate it.
  The same distinction applies to imported security findings and static test checks.

| Status | Meaning |
| --- | --- |
| Pending | Unfinished, awaiting investigation/approval/verification; next step recorded. |
| Active | Work currently in progress within its approved scope. |
| Blocked | A named prerequisite prevents the next step; preserve the task and blocker. |
| Implemented | Source exists or prior execution is recorded, but stated acceptance is not fully verified. |
| Verified | Stated scope passed recorded checks at a specified revision/environment. Never implies all platforms or future changes. |
| On hold | Owner explicitly deferred work; no activation/redesign/change without approval. |
| Superseded / Cancelled | Owner explicitly replaced/cancelled it; keep reason and successor. |

Severity follows the owner's business-impact scheme: **Critical** = security/data
isolation/financial or inventory integrity; **High** = important broken workflow;
**Medium** = inconsistent/confusing behavior; **Low** = minor cosmetic/usability.
This is not a CVSS assessment or a completed formal security scan.

## Decision and instruction log

Earlier conversation decisions are reconciled here on 2026-10-27; dates of the
original statements are not invented. See memory for the full approved semantics.

| ID | Owner decision / correction | What it supersedes or constrains |
| --- | --- | --- |
| DEC-01 | Normal Electron/mobile Operations terminal is permanently branch-locked for all roles, including admin/manager. Enforce every backend/offline path with trusted registration. | Overrides any assumption that a wider role or warehouse permission permits ordinary branch switching on a normal till. |
| DEC-02 | Management admission, account-authorized scope and selected view are distinct; web has no native terminal registration. | Neither NULL assignment nor management type alone grants all branches. |
| DEC-03 | Management local SQL retains authorized shop data; physical co-location does not grant access; retries preserve origin. | Replaces old documentation claiming management SQL synchronization is always blocked. Integration remains defective, not fully verified. |
| DEC-04 | Existing Electron and mobile terminal activation, including Normal/Operations and Management, must be reviewed together with temporary registration/pairing. | Owner clarified the “number two” reference on 2026-10-27; AUTH-09. Do not create a duplicate mechanism or infer removal approval. |
| DEC-05 | Staff management is delegatable through saved `can_manage_staff`. | Later correction supersedes temporary admin-only wording; existing global staff-management scope is not silently changed. |
| DEC-06 | Role presets initialize users; individual additions/denials remain editable. Management sign-in switches belong at bottom of Edit account. | Supersedes earlier placement in Edit permissions; device admission is not an action grant. |
| DEC-07 | Page/action visibility belongs in Edit permissions; approver users/limits belong in Approver rules. | Avoid duplicate “manage elsewhere” controls and invented approval gates for ordinary grants. |
| DEC-08 | Store/system timezone and saved currency govern business display/filtering. | Supersedes earlier viewer-region/timezone suggestion. |
| DEC-09 | Central notification rule table includes WhatsApp and selected users/roles; personal Clear preserves immutable event/delivery history. | Supersedes shared-team clearing and duplicate alert controls. New events must not replay old toasts. |
| DEC-10 | Sponsorship needs selected approval at any amount except configured admin/direct issuers; include discount, reference, receipt, recipient and once-only stock. | Later configured exceptions supersede absolute approval-for-everyone wording. |
| DEC-11 | Deposits count in payment/drawer totals when actually received; merchandise sale counted once at collection. | Approved, not yet implemented consistently. Do not infer historical shift allocations. |
| DEC-12 | Selected approver may approve on the same offline PC only when offline approval policy is enabled. | Preserve identity/action/branch/limit/replay checks and audit; offline phone tokens do not create offline phone billing. |
| DEC-13 | Booking receipt/tag editing stays in Booking Rules & Services; sales receipts separate. | Customer slip plus separate racket tag is intentional, not a duplicate-barcode bug by itself. |
| DEC-14 | Stock quantities in product catalogue are view-only; use purchase/receiving or authorized movements. E-commerce administration management-owned. | Do not silently change opening stock or widen cost/e-commerce visibility to cashiers. |
| DEC-15 | Try configured local SQL before Electron opens; automatic online fallback approved for unavailable SQL, preserving pending/uncertain writes. | Supersedes explicit Continue-online-only recovery choice and older no-fallback documentation. Never retry a business denial as connectivity fallback. |
| DEC-16 | Update availability/install applies to all users, signed out included; circular native indicator near profile/bell/login, hidden after completion. | Supersedes admin-only update controls; publication still requires separate authorization. |
| DEC-17 | Membership is ON HOLD; critical shared dependency changes require approval first. | Supersedes earlier membership tier/email enhancement requests for now; existing data/features stay preserved. |
| DEC-18 | Read-only audit first; small approved batches; preserve unrelated functionality; no silent rules/settings/grant changes. | Supersedes blanket assumptions that earlier “fix everything/publish” requests authorize new unreviewed corrections or promotions. |
| DEC-19 | Owner approved documentation-only Batch 0 on 2026-10-27. | Authorizes the instruction/memory/tracker and targeted documentation reconciliation only. |
| DEC-20 | One clear management home per setting/field responsibility; consolidate genuine duplicate editors after tracing persistence/consumers. | Preserve necessary fields, distinct scopes and separate permissions/approver and sales/booking receipt responsibilities. No application-change approval implied. |
| DEC-21 | One concise update on task start, entry into verification and completion; show completed/working/pending. | Preserve honest verification states and avoid repeated unchanged updates. |
| DEC-22 | Owner approved Batch 1: check Electron/mobile activation for normal and management terminals, fix trusted branch locking, preserve cashier checkout and other functionality, use agents and beta first; Membership stays on hold. | Supersedes Batch-0-only application-work pause for this narrow batch. Does not approve unrelated fixes, live SQL/data changes, native publication or production promotion. |
| DEC-23 | Owner explicitly requests removal of all added sales-breakdown panels, including Home, Selling, All Shops and Reports, while retaining normal totals and receipt details. | Supersedes the earlier request to add those reconciliation panels. Apply as a separate UI-only change/commit, not mixed into branch/security logic or financial formulas. |
| DEC-24 | Show financial breakdown through small hover/click information icons on Revenue, Gross Profit and related summary totals instead of standalone panels; explain original amounts, deductions and resulting value using existing data. | Refines DEC-23. Keep icons compact, keyboard/touch usable, and calculations/receipts unchanged; do not fetch new item histories merely to open a tooltip. |
| DEC-25 | Combine adjacent Products and Categories inventory metrics into one compact card on Live Dashboard and other existing inventory summary cards. Hide zero inventory indicators after loading and reveal changed nonzero values; prevent numeric overflow at desktop and mobile sizes. | Refines UI-08. Preserve calculation, scope, permissions and meaningful loading/empty states. This concerns inventory summaries, not removal of zero sales/payment totals. |
| DEC-26 | On Live Dashboard and Live Business Board, hide loaded zero financial/count cards too; reveal changed positive data and keep nonzero negative financial values visible. Keep All Shops cards even when their values are zero. Align Bills with peer cards. Show Expand table only on phones and align Columns beside the table/section heading. | Supersedes DEC-25's zero-sales exclusion on these two live pages only. Preserve loading/error/empty states, filters, formulas, grants, normal table actions and mobile expansion. Shared table presentation changes need adjacent regression checks. |
| DEC-27 | On smaller screens, summary-card groups (including Inventory position) should swipe sideways with no visible scrollbar; owner clarified an infinity slide, interpreted as a manual loop from last card back to first. Desktop keeps its normal layout. | Refines the mobile stacking/grid presentation of DEC-25/26. Reuse the existing carousel capability; no automatic movement, extra data loading, duplicated business records or widened visibility. Respect reduced-motion, touch/keyboard and too-few-cards behavior. |
| DEC-28 | Owner reinforced DEC-27 for all cards. An intermediate assistant interpretation included whole graph cards after ambiguous wording; the owner then explicitly corrected this in DEC-29. | Superseded interpretation, not continuing permission to loop chart cards. Preserve full form/table workflows and desktop presentation; inventory implemented card groups before marking coverage complete. |
| DEC-29 | Controlling correction: do not implement infinite scrolling on graphs or charts; apply it to other cards. Exclude graph/chart card containers too and preserve their existing finite behavior. | Supersedes DEC-28's ambiguous graph-card interpretation. New loop applies to non-chart summary, inventory, financial and shop card groups only; no plot/chart/container behavior change. |
| DEC-30 | Apply the non-chart card loop on Windows too whenever cards would otherwise wrap into another row/column. Detect available container space rather than relying only on a phone/device breakpoint; retain the ordinary row when all cards fit. | Refines DEC-27's desktop exception: a Windows/desktop group that cannot fit must slide too. Keep card widths readable, loop real existing nodes, preserve graph exclusions and respond to window/container resizing and hidden-card changes. |
| DEC-31 | Investigate conflicting sales/payment/sponsorship totals. Owner corrected expected all-method total collected to **6,851**, not 6,841; reported revenue around 6,489 and collected 6,468. Show without-sponsorship and including-sponsorship values clearly when applicable. | Manual expected total is evidence to reconcile, not permission to force values to match. Trace branch/cluster/date/timezone/status/payment/refund/rounding/discount sources before proposing financial corrections. Preserve checkout/receipts and original records. |
| DEC-32 | Owner approved report-only fixes: same authorized branch scope for sales/sponsorship, consistent refunded-bill totals, and clear before/after Extra Discount and sponsorship labels. Preserve checkout, receipts, stock and stored records. | Separate reviewed commit/baseline after UI work. No permission, schema, historical financial data or checkout/receipt change; manual source of 6,851 remains a pending clarification, not a target to force. |
| DEC-33 | Owner suspects some cashier bills were never entered and requests an Add missed bill option alongside Corrections. | Record a separate historical-sale workflow, not a fabricated report adjustment or edit of an existing bill. Investigate reuse first; stock-already-corrected handling, already-received payments and original/closed shift attribution require explicit decisions. No historical data entry, grant change or new financial write implementation in DEC-32. |
| DEC-34 | Owner confirmed missed bills are historical sales already paid and handed over, with a required stock-handling choice. | Distinguish deducting unrecorded stock from stock already corrected; never charge or deduct twice. |
| DEC-35 | Owner selected Review the design before implementation for Add missed bill. | FIN-13 remains proposal-only. Administrator correction access, original branch/date/cashier, received tenders, reason, optional original-shift link and current-drawer preservation were proposed, not approved for implementation. Present any migration separately before application. |
| DEC-36 | Investigate Archive showing only four products and an inactive product apparently absent from the top metric. | Check archived versus zero-stock status, retained filters/pagination, metric definition and authorized branch/cluster scope. Do not archive, unarchive, change stock or widen access during investigation. |
| DEC-37 | Owner clarified the expected 6,851 may include bills never entered and will check the originals. | Missing bills are suspected, not confirmed. Do not force reports or create transactions to bridge the difference; link genuine omissions to the separately reviewed FIN-13 workflow. |
| DEC-38 | Owner approved a separate UI-only clarification: explicit Archived products count, clear Active/Archived mode and visible active filters. | Baseline eb970d1b; preserve product status, stock, branch/cluster scope, valuation and filter behavior. Does not authorize automatic archiving, ownership repairs or database changes. |
| DEC-39 | Owner superseded the new Catalogue status box: remove it, keep search/filter/actions, and show only Total / Active / Archived product counts at the bottom. | Supersedes DEC-38's box, mode and filter-chip presentation. Preserve filters, pagination, metric cards, status/stock and authorized catalogue scope; totals refer to the accessible catalogue, not inaccessible other companies. |
| DEC-40 | Owner reports over 100 Supabase products below zero. | Negative stock is not equivalent to archived status. Trace archived-negative exclusion from metrics, zero-stock lifecycle and branch/cluster read scope before proposing corrections; do not alter real quantities, widen access or claim the loaded five rows exhaust database records. |
| DEC-41 | Use ROSEGILL only for this chat; before any Supabase edit identify organization, project, ref and URLs and present the proposed change for approval. | Connector routing still denied the POS ref, but owner-opened Chrome independently exposes pos in rosegill0011@gmail.com's Org (bjxgimekljzlnwejuawj), project qhrufhtbeguxydenzfey. Do not use unrelated Primary projects as substitutes. Browser inspection is read-only; database writes need separate approval. |
| DEC-42 | Owner confirmed the 592 hidden archived products belong to STR1 / 361 Degree Sports and requested preparation of the targeted repair for review. | STR1 ID a611a328-2217-4d77-944a-5f6a637d123b verified in the live stores table. Record ownership confirmation, capture exact IDs and inspect deployed triggers/sync before proposing application. This confirms provenance and authorizes repair preparation, not live execution. See database/archive-ownership-repair-review.md. |
| DEC-43 | Private stock must not hide a cluster's own catalogue: products belonging to a cluster remain visible within that cluster until an explicitly approved transfer/merge changes availability. | Separate product catalogue membership from branch stock quantities. Preserve normal-terminal branch restrictions, action permissions, private-stock settings and other clusters' isolation. The ownership repair must use STR1's configured cluster, not merge catalogues or expose other branches' protected quantities. |
| DEC-44 | Owner requests checking and correcting the location Private catalogue / Private stock behavior against cluster-shared products and private branch quantities. | Actual STR1 edit dialog shows cluster 361 DEGREE SPORTS and both privacy switches on. Keep saved switches; explain their distinct effects. Audit confirms same-cluster catalogue sharing already implemented but privateStock only affects All Shops stock presentation; Inventory Other Sources and raw product stock-map reads lack that policy. Required management-scope exception clarification is pending. Present a bounded correction batch; do not silently redact mutation inputs or apply live schema/data changes. |
| DEC-45 | Owner confirms authorized management keeps stock access within its granted branch scope; normal branch terminals see only their own quantities. | Resolves DEC-44 management clarification. Management terminal type alone is not an entitlement: require verified account scope and existing function permission. A manager using a normal terminal remains branch-locked. Preserve same-cluster catalogue sharing, private quantities, transfer workflows and authoritative lifecycle/checkout data. This decision does not approve live DB execution or the 592-row ownership repair. |
| DEC-46 | Owner approved the proposed first code-only stock display/copy/regression batch: Okay, do it. | Baseline HEAD 9e65a0c6 with existing footer/doc drafts preserved. Share one display scope between Inventory Other Sources and All Shops, clarify privacy copy and test terminal/user binding precedence and granted management scope. Preserve table column positions, selected-cluster stock export, catalogue visibility, stock maps, lifecycle and checkout. This fixes presentation only; backend read privacy and 592-row live repair are separate pending batches. No DB writes, installer publication or production promotion. |
| DEC-47 | Owner clarified Other sources: show only sources with stock available, IN RESPECTED CLUSTER. | Narrow Other Sources to positive-stock, active, permitted locations in the currently selected branch's own cluster. Exclude zero/negative quantities, current branch, inactive and other-cluster sources; an approved transfer does not turn this popup into an all-clusters stock view. Keep management scope and normal-terminal restrictions; All Shops management card access remains separately authorized. |

## Current work register

DEC-56: owner requests updating beta. Prepare reviewed source commit/PR341 update
and merge into beta only after required checks pass. No production promotion,
installer/OTA publication or live sync migration application. Final candidate
14suites/126tests plus29 sync and11 repair checks passed. Exclude .pending business
backups, unrelated booking helpers/empty migration and supabase temp files from Git.

Beta source1d24dae7 pushed. Initial CI: web/compile/windows/iOS/label passed;
regression failed only on expected migration-list and superseded global-export
source assertions. Corrected those two tests retaining payload/permission checks.
Full local isolated suite passed551files/3422tests. Unrelated empty SQL draft was
temporarily held and restored in finally (zero bytes) to match shipped CI files.
Push follow-up and require fresh CI before beta merge. No live sync migration or
installer publication performed.

DEC-55: owner reports1/2 stock filter still not selecting quantities. Confirmed
actual JSX heading plainText creates Stock ·  HC (double space), while parent
columnValues uses Stock · HC; unknown-key fallback skipped filtering. Normalize
column-label whitespace before matching and parse complete quantity token.
Regression covers actual spaced label,1versus2 and scientific decimal quantities.
No branch/data/checkout change.

DEC-54: owner reports stock-column1/-1/0 filters return wrong quantities.
Confirmed substring matching erroneously matches10/-10 etc. Match plain numeric
stock queries by exact quantity, retaining textual stock searches and the current
branch/cluster/Active-Archive scope. No stock/data/checkout changes.

DEC-54 implemented: signed decimal stock terms use exact numeric equality;
other column/text filters retain text matching. 3suites/22tests and scoped lint
passed, including1/-1/0/fractional cases, text warnings and AND filters. Zero and
negative matches remain under selected branch Archive, not Active. No DB writes.

DEC-53: owner reports Inventory column filters ineffective and requires each
column filter to match only that column while main search remains cross-field.
Confirmed shared table filters run after Inventory slices pageRows. Add opt-in
parent filtering callback so Inventory filters full authorized catalogue before
pagination; preserve other tables' default behavior, scopes and checkout.

DEC-53 implemented: optional shared-table label-keyed filter callback delegates
Inventory filtering before usePagination. Per-column text covers Product,
Category/Sub-category, visible monetary columns, branch stock and permitted
same-cluster Other Sources; global search remains cross-product-field. Table's
default internal filtering retained for other callers. 6 suites/36 tests,
TypeScript, scoped lint and diff checks passed; previewHTTP200. Actual signed-in
browser interaction remains unverified. No database or checkout changes.

DEC-52 (2026-10-29): owner approves selected-branch Inventory Active qty>0,
Archive qty<=0 with negative-stock warning. This is a read-only classification;
never mutate shared is_archived flags, other branch status or checkout. Update
rows/footer/cost-review/export classification consistently; preserve shared
valuation formulas and label any existing global Archive/Restore actions clearly.
Use agent review and fixture tests; no database change required.

DEC-52 implemented locally: inventory-branch-view.ts canonical branch quantities
classify rows, cost review, footer and Inventory export. Negative branch stock
gets a warning banner and red labeled badge; product/negative counts use branch
classification. Shared valuation helpers, product flags/maps and checkout untouched;
global archive/restore actions explicitly labeled. 7 isolated suites/73 tests,
TypeScript, scoped lint and diff checks passed. Local preview HTTP200. Browser
visual/device verification is not established; no live DB data/status changes.

DEC-51 (2026-10-29): owner authorizes ownership sync durability correction,
Electron/mobile archive read checks and agent review; preserve checkout. Prepare
minimal NULL/blank-owner upload protection in product sync conflict assignment,
generator and local renderer upsert. Preserve insert semantics, nonblank owner
assignments, version ordering, stock exclusions and authoritative cloud pulls.
Live routine application requires exact change disclosure/approval. Inter-cluster
barcode collision request is investigation/advice, not authorization to merge
products or reassign ownership. Membership remains on hold.

DEC-51 candidate implemented: migration20261029064933 updates only conflict-owner
assignment in public.sync_apply_products(jsonb) to preserve established ownership
when EXCLUDED.owner_store_id is NULL/blank. Same fix in contract generator/canonical
schema and product-only native renderer upsert; authoritative cloud pull unchanged.
29 isolated PGlite checks passed; 7 focused suites/82 tests passed (600 archive
pagination, cluster/native scope, offline sync, ownership and checkout). TypeScript,
scoped lint/syntax and diff checks passed. Live SELECT remains600archived/600visible/
0hidden ownerless; migration NOT APPLIED. Need project-specific routine-update
approval; installed Electron/mobile cache/replication and real checkout unverified.
Transfer audit: existing product_id retained, quantities moved by branch, posted
receipt grants destination availability, global SKU/barcode unique. Legacy verifier
matches exact barcode and destination bucket; do not auto-merge similar names or
different items. Duplicate/alias conflict review is separate proposed hardening.

DEC-50 (2026-10-29): owner explicitly approved execution of exact594 ownership
repair in ROSEGILL pos. Applied successfully after 594/594 fingerprint backup
check. All594 before/after images differ only owner/version/time. Post-read:
2169total/1569active/600archived/600 STR1-visible; repaired foreign-cluster visibility0,
audit594/feed594; archive/stock/SKU/prices preserved, checkout code untouched.
Before/after business backups remain local .pending files, excluded from commits.
INV-09 ownership data correction is applied/DB-verified; signed-in UI and native
SQL propagation not verified. Higher-version NULL-owner sync durability and raw
stock-read enforcement remain pending; do not claim those fixed or replay repair.

DEC-49 (2026-10-29): owner requests completing archived ownership repair, exact
database change disclosed before application, agents and checkout preservation.
ROSEGILL project pos qhrufhtbeguxydenzfey / org bjxgimekljzlnwejuawj is now
accessible through connector link_6ab102f426708191b544bc0e70170ba0 (connector label
beta; database is live). Latest SELECT: 2169 total /1569 active /600 archived /
6 visible to STR1 /594 hidden ownerless archived zero-stock candidates. Frozen
594-ID/full-row-MD5 manifest prepared in database/str1-archive-ownership-repair.review.sql.
Preflight: no canonical stock map drift, quantity mismatch, transfer projection
drift, foreign nonzero stock or conflicting legacy productOwners. Do not apply
until isolated tests/review and project-specific approval. Owner confirmation
previously covered 592; latest 594 cohort must be explicitly presented. Newer
NULL-owner replica uploads can undo ownership; sync preservation remains a
separately reviewed change, not silently bundled in data repair. Membership hold.

Owner decision DEC-48 (2026-10-29): normal terminals may read positive available
stock at other active branches/warehouses in their registered branch's cluster.
This supersedes DEC-45/46's own-quantity-only display rule, not terminal branch
locking for sales, mutations, settings or protected reports. Other clusters stay
hidden. Authorized management scope remains unchanged. Keep SKU allocation one
global sequence; use agents for implementation/review. No live data migration is
approved by this code-change instruction. Membership remains ON HOLD.

DEC-49 repair candidate verified: independent agent review plus root execution of
11 isolated PGlite cases passed against final guarded SQL, including target-store
FOR SHARE lock, frozen row fingerprints, stock/price/SKU/archive/sale preservation,
same-cluster allow/foreign denial and failure rollback. Test harness uses synthetic
representative triggers; no live UPDATE occurred. Await owner approval for exactly
594 candidates in ROSEGILL pos; do not silently expand if manifest/data drifts.

DEC-48 implementation: added separate clusterAvailableStockLocations for Inventory
Other Sources; trusted terminal/account branch anchors its same-cluster read-only
availability. Full stock reports retain stockDisplayLocations restrictions; no
checkout/write/branch-switch guard changed. Updated privacy copy and tests.
Agent SKU audit confirmed singleton global range allocation, with one stale
cross-tab cache defect: readLease preferred memory over an advanced persisted
cursor. Fixed persisted-cursor precedence while preserving quota fallback and
added shared-storage two-module A1/B2/A3 regression. Final 9 focused suites /88
tests passed; full raw-data read enforcement and archive ownership repair remain
unapplied. SKU leases reserve ranges, so global uniqueness does not imply gapless
chronological numbering across offline terminals. Source remains local/uncommitted.

Source anchors below refer to checkpoint `1af373f5` unless stated otherwise.
“Existing tests” means reviewed source coverage, not a new executed test result.
No earlier chat-wide “completed” message is treated as blanket verification.

### Documentation, source and approval

| ID | Status / severity | Requirement, evidence and next step |
| --- | --- | --- |
| DOC-00 | Verified / High | Documentation-only Batch 0 completed on 2026-10-27: original AGENTS content retained verbatim; 10 Markdown files checked; local links valid; 75 unique task IDs, 21 decisions and eight terminal cases recorded. Two agent reviews reconciled PRIVATE settings, subset-scope and revocation wording. No application/runtime acceptance implied. |
| DOC-01 | Pending / High | Maintain verified feature/dependency, per-operation permission and settings-scope matrices using existing `audit/feature-inventory.md`, audits and generators. Current 123-route/45-settings inventory is not an end-to-end pass. Expand evidence without duplicating trackers. |
| SRC-01 | Implemented / High | Batch 1 source commit `608398c6` follows documentation `d0519d5a` and source baseline `1af373f5`, package 1.4.80; older primary folder remains 1.4.65. UI refinement follows separately. Refresh refs/source/release identity before each batch; no old folder cleanup/reset authorized here. |
| REL-01 | Active / High | Beta PR #341 includes report-only eb970d1b and separate Archive UI `45893068`, pushed on 2026-10-29. Report commit gates all succeeded, CodeRabbit skipped; Archive commit checks are running. GitHub connector unavailable, so authorized GitHub CLI updated concise PR summary/status. Inspect new-head CI before merge. Broader security review remains SEC-02; no merge, installer, OTA or production promotion in these batches. |
| REL-02 | Pending / High | Any beta merge, paired installers or native OTA: select checked immutable source and follow release runbook. Batch 0 grants no publication; exact “Publish beta now” gate remains. Record actual version/artifact/feed verification separately. |
| REL-03 | Pending / Critical | Any new production promotion: separate beta→main PR and owner approval for that specific promotion. Earlier approvals or passes do not authorize this roadmap. |
| REL-04 | Pending / Medium | Old build/source cleanup and signing-key preservation: prior cleanup request not fully reconciled. Inventory active checkouts/builds and unrelated work before any separately approved removal; never delete/rotate signing material. |

### Branch, terminal, management and permission integrity

| ID | Status / severity | Expected versus actual; scope; next step / acceptance |
| --- | --- | --- |
| AUTH-01 | Implemented / Critical | Batch 1 now retains persisted raw/cashier-session terminal identity when a request token is omitted; rejects contradictory, revoked, missing or reassigned activation and validates device proof for terminal-only/unbound issuance. Isolated hosted RPC/sync tests preserve cashier A and deny foreign branch B. Remaining: browser-shaped unbound Auth issuance is not native attestation; direct database/RLS/legacy boundaries remain AUTH-04/SEC-01, not certified closed. See evidence below and physical-device acceptance TST-01/04. |
| AUTH-02 | Implemented / Critical | Main now rejects ordinary token/mode/branch/alias reassignment, verifies canonical activation descriptors, preserves operator-managed config/secrets, and checks account scope before local reads. Legacy missing proof is repaired only after server validation. Clearing removes usable identity while retaining non-secret origin; replacement requires administrative recovery, clean pending/failed/conflicted SQL work and local diagnostic attribution. Installed wrapper→Main isolated tests cover denied substitution and granted cashier access. Real DPAPI/SQL/device/restart acceptance remains TST-01/04; legacy plaintext import is not OS-user tamper protection. |
| AUTH-03 | Pending / Critical | Assigned web manager A must not receive B scope. `relay-policy.server.ts:301,326` conditions restriction on terminal ID and then supervisor role. Current account scope principally represents one branch or NULL/all, not an explicit A+B-excluding-C subset. Verify actual representation and owner intent before any scope design; test assigned and all-authorized cases without inventing grants. |
| AUTH-04 | Pending / Critical | Direct authenticated database/RPC paths must match terminal/account restrictions. `schema.sql:4418` `store_visible` grants supervisors broad visibility; generic cloud proxy does not establish terminal branch. Deployed definition inspected read-only. Trace all alternate consumers; do not blindly remove legitimate management access. |
| AUTH-05 | Pending / High | Generic approval scope must allow authorized all-store supervisors while keeping bound admins A-only. `authorization.functions.ts:192,202` admin-only broad scope ignores normal-terminal binding. Align verified scope without granting action/approver rights; include sponsorship and product/transfer approvals. |
| AUTH-06 | Pending / High | Sparse/null permission matrices must resolve the same way online, native and frontend. `permissions.ts:393` frontend supervisor defaults versus explicit-only `relay-claims.server.ts:19`. Confirm legacy cases; no automatic grant expansion or silent saved-matrix rewrite. |
| AUTH-07 | Pending / Medium | Revoked/deleted/expired identity must be distinct from network unavailability. `session-permissions.server.ts:37` catches rejection as unavailable; `pos-auth.tsx:1320` preserves cached rights. UI staleness confirmed; native-write consequences unverified. Preserve legitimate offline behavior and test revocation. |
| AUTH-08 | Pending / High | Correct warehouse role/access classification. `pos-auth.tsx:1509` treats ordinary web `staff` as warehouse; :1567 permits unassigned warehouse switching while relay may deny writes. Verify actual role slug and explicit scope; independent warehouse ACL remains unproven. |
| AUTH-09 | Implemented / High | Existing preclaim/manual/QR pairing, claim, PC/mobile Operations/Management descriptors, issuance, adoption, revalidation and revocation/re-pair paths reviewed under DEC-04/22. Preclaim discovery remains separate from completed activation; NULL branch needs explicit management designation and saved account admission. Compatibility proof handoffs repaired for staff rosters, approval credentials, recovery PIN and Operations replication. Typed registry outage stays unavailable; authoritative activation denial cannot trigger cached-login fallback. Real-device acceptance remains outstanding; no new activation mechanism or live records changed. |
| AUTH-10 | Pending / Critical | Reassignment must handle pending/failed/conflicted offline transactions across remote reissue and all IPC paths. Local Unpair UI checks pending work; remote `20261021013221_terminal_reissue_and_mobile_tokens.sql:12` does not establish equivalent recovery. No data deletion proven. Require audit and recovery without relabeling old A work to B. |
| AUTH-11 | Implemented / High | Role defaults, consolidated Edit permissions, account management-admission flags and delegated `can_manage_staff` exist. Complete create/edit/save/reload/revocation, direct URL/API and checkbox→actual-operation matrix; preserve explicit denials, cashier sale grant and admin's intentional authority. |
| AUTH-12 | Implemented / High | Per-user approval PIN/soft-token paths exist; prior delayed-first-PIN/token failures were addressed in earlier patches but not certified on affected phone→offline Windows pair. Test eligibility, branch, limits, expiry/clocks, replay, attribution and unavailable-versus-incorrect messaging without sharing credentials. |

### Settings and persistence

| ID | Status / severity | Requirement / evidence / next step |
| --- | --- | --- |
| SET-01 | Pending / High | Section/path ownership: `relay-policy.server.ts:709` checks label/lock but not contained fields; `branch-settings.ts:223` merges entire patch; native `operations.cjs:317` analogous. Test unlocked-tax payload carrying locked rounding/terminal fields, unknown labels, tier/lock checks and valid saves. Do not silently change settings. |
| SET-02 | Pending / Medium | Scope-switch save race: `SettingsFrame.tsx:252` clears saving unconditionally after an old request. Confirm with isolated slow A/B save tests before correction; draft ownership and authoritative acknowledgement must survive late replies. |
| SET-03 | Pending / Medium | Delegated e-commerce/global-save UI mismatch: `settings.catalog.tsx:302` offers a write backend may deny; optimistic settings can remain changed. Verify rejection rollback and management-only visibility; preserve actual e-commerce data. |
| SET-04 | Implemented / High | Three Payments pages loaded read-only: payment methods, bank transfer details, payment accounts. Earlier save bugs were patched; no live save done in latest audit. Verify all three save/reload/error paths with isolated settings, tender account scope and checkout integration. |
| SET-05 | Implemented / High | Sales receipt designer, QR, typography/custom font size, extra sections, printer width/margins and permanent preview require integrated save/reload/print verification. Prior SettingsFrame context crash must not recur. Do not alter receipt/payment business logic for appearance. |
| SET-06 | Implemented / High | Booking rules/deposits, services/fees and booking receipt/tag settings remain together, separate from sales receipts. Verify compact section editing, terms/content/fonts and persistence; avoid duplicate controls and excessive scrolling. |
| SET-07 | Implemented / High | Identity deletion must persist cleared registration/taxpayer fields; saved country/currency/store timezone must apply to display and date queries everywhere. Recheck scoped save/cache/reload and receipt/report formatting; no migration or live value change in Batch 0. |
| SET-08 | Pending / High | Complete all 45 settings-route/subpage checks: scopes/inheritance/locks, stale refresh, defaults, previews versus explicit Save, operational policies and hidden controls. Reuse existing section map; warehouse/company tiers not assumed. Source inventory is complete, runtime acceptance is not. |
| SET-09 | Pending / Medium | Latest owner request DEC-20: inventory every setting/field's management home, saved value and consumers; identify duplicate editors and unused/unwired controls. Propose minimal consolidation with links and necessary fields retained; no blind removal or collapsing distinct scopes. |

### Financial workflows, bookings and sponsorship

| ID | Status / severity | Requirement / evidence / next step |
| --- | --- | --- |
| FIN-01 | Pending / Critical | Atomic booking collection: `pos-store.tsx:2497,2510,2546` separately completes payment/status, sale/stock, then link. Failure/retry can leave incomplete or duplicate effects. Shared ID helper/empty migration are drafts only. Require authoritative atomic native/cloud operation, both legitimate action permissions, concurrency/replay and closed-shift read recovery. |
| FIN-02 | Pending / High | Canonical booking payment identity: RPC generates UUID, provider appends another without retaining idempotency key; later `bookings-db.ts:166` history save can duplicate/conflict. Test deposit→edit/save without reload, duplicate acknowledgements and authoritative response reconciliation. |
| FIN-03 | Pending / High | Approved received-payment accounting: 40 cash deposit in shift1 +60 card in shift2 must report 40/60, not final-method100. Fully prepaid handover must not add new cash. `pos-store.tsx:2518`, `shift-close.ts:29`, `daily-payment-summary.ts:8`. Preserve full merchandise sale once; no guessed historical allocation. |
| FIN-04 | Pending / Critical | Legacy booking RPC scope: `booking_balance_state`, `booking_net_paid`, `booking_collect` lack full branch/terminal checks. Deployed catalog confirmed authenticated execute, anon denied, definer authority bypasses table RLS. Secure all entry points with live permissions; test A→B denial and authorized management without invoking real bookings. |
| FIN-05 | Pending / Medium | Persist booking reference: provider :2524 sets `bookingRef`, `pos-db.ts:837,932` mapping omits it, `pos-print.ts:438` expects it. Reprint/reload must retain correct reference/service details; ambiguous historical links remain Needs review, no auto-rebilling/stock repair. |
| FIN-06 | Implemented / Critical | Cashier online/Electron Complete & Print, persisted sale/tender/line order, draft-payment errors and printer/drawer separation: earlier fixes/test coverage exist. Verify two successive bills during catalogue sync, late acknowledgement/retry, no-print drawer pulse and correct granted/denied action combinations. Do not require catalogue-edit/stock-adjustment grants to sell. |
| FIN-07 | Implemented / High | Sponsorship: named approvers/direct issuers, limits/any-amount approval, selected stores, discounts, configurable reference, handover/retry stock-once and receipt exist. Earlier mobile Unknown app operation was reported resolved by owner; recheck compatible backend/build, not unrelated endpoints. Physical printing/current full workflow still unverified. |
| FIN-08 | Pending / High | Offline sponsorship request/selected approval/handover/history/printing and sync remain incomplete. DEC-12 permits selected approver on PC only with offline approvals enabled. No fake zero history, unreviewed stock transaction or automatic historical repair. |
| FIN-09 | Implemented / High | Racket/general booking intake: simplify unnecessary repeat fields; racket-only/customer-owned-string behavior, stocked materials, reservations, ready/collected/payment flow and customer display need per-workflow verification. Separate customer slip/tag is intentional. |
| FIN-10 | Pending / Medium | Legacy records apparently saved under wrong branch or missing shift link need owner-reviewed evidence and explicit data-correction approval. Preserve original rows while diagnosing; UI branch fixes do not authorize historical rewrites. |
| FIN-11 | Implemented / pending record reconciliation / High | DEC-31/32: owner expects all-method collected 6,851. Bounded live SELECT confirmed configured Asia/Singapore period 2026-09-28..2026-10-27, STR1, 79 nonrefunded bills: cash 2,311 + card 3,489 + bank transfer 668 = 6,468; header/tender JSON/paid-minus-change/ledger agree. Net before saved Extra Discount adjustment 6,489.50; adjustment -21.50, tax 0; one issued sponsorship 348 yields combined 6,816; separate refunded bill 220. No broken header equations/orphan sale links found in this cohort; unexplained owner delta 383 is not auto-adjusted. Report-only scope/refund/label corrections committed and pushed as eb970d1b, scoped-verified below. Owner will compare originals for suspected unentered bills (DEC-37); no missing bill is independently confirmed. Preserve checkout, receipts and stored records. |

| FIN-12 | Pending / Medium | Independent report review found an unchanged tender-display inconsistency: `PaymentsReport.tsx` sums gross `Payment.amount`, while `daily-payment-summary.ts` subtracts represented cash change. A valid 90 bill paid with 100 cash/change 10 can therefore show collected 90 but Cash 100. Confirm affected saved representations with isolated fixtures and reuse retained-tender semantics in a separately approved correction; do not alter checkout or assume this explains FIN-11's observed zero-change cohort. |
| FIN-13 | Pending design approval / High | DEC-33/34/35: owner confirmed already-paid historical entry with required stock choice, then requested design review before implementation. Existing posted-sale correction requires an existing ID/version; ordinary checkout requires an open shift, stamps now and deducts stock, so neither can be repurposed by bypassing guards. The proposed design below covers original attribution, received tenders, audit, retries and stock treatment. No new application write, live financial entry or migration authorized. |

### Inventory, warehouse, reports and data loading

| ID | Status / severity | Requirement / evidence / next step |
| --- | --- | --- |
| INV-01 | Implemented / Critical | Cluster-owned catalogue visibility, branch stock isolation and trusted transfer provenance exist. Verify every picker/import/scan/receive/sale/report path, private legacy zero-stock ownership and inter-cluster named approvals. Ambiguous owner rows require review, not automatic reassignment. |
| INV-02 | Pending / High | Candidate: importProducts indexes all products before branch ownership at `pos-store.tsx:2835`; purchasing barcode lookup :540 similarly broad. Trace backend effects before confirming cross-cluster mutation. Test identical barcode in private catalogues and approved transfer reuse. |
| INV-03 | Pending / Critical | Warehouse hierarchy/picking exist, but independent subordinate ACL coverage is not established. Verify receiving/adjustment/reservation/transfer/return/reversal source and destination, branch ancestry and concurrency without changing real quantities. Clarify unsupported subset scope before design changes. |
| INV-04 | Implemented / High | Catalogue quantities view-only; costs/e-commerce columns/action grants/management-terminal ownership must match saved settings and backend enforcement. Verify ordinary cashier versus warehouse/supervisor/admin combinations; do not widen access by role alone. |
| INV-05 | Implemented / High | Purchase cost, Total Unit Cost and retail on-hand values have calculation tests and UI; verify branch/cluster/date semantics at scale, negative signed quantities, archived items and historical cost estimates. Current source review found no separate Home-vs-Inventory formula; readiness issue is DATA-01. |
| INV-06 | Implemented / High | Bulk import/purchase finalization progress, failure recovery, decimal costs/rounding/conflict matching and workbook-sheet selection need unified acceptance across import surfaces. Prior UI/workflow improvements do not certify concurrent native finalization. |
| INV-07 | Pending / High | Default category/group/subcategory naming and starting quantity via purchase must be reconciled against current imports/creation paths. No real catalogue renaming or stock initialization authorized. |
| INV-08 | Implemented UI / pending completeness / Medium | DEC-36/38: source and preview show five archived products, no four/five-row cap; retained filters/catalogue scope apply. New InventoryCatalogueStatus shows separate active/archived counts, mode and search/advanced matches/filter labels. Counts use authorized catalogProducts before filters; active-only valuation remains unchanged. Eight focused suites / 59 tests, TypeScript, three-file ESLint and web build passed; desktop Active/Archived and 390px Archive display observed with no panel/document overflow. Preview signed out before final live search interaction; fixture filter tests pass. Supabase read unavailable, so stored-count completeness remains unverified. No lifecycle/scope/stock/backend changes. Revert only the separate UI commit for recovery. |
| INV-09 | Confirmed discrepancy / repair preparation / High | DEC-40..43: read-only ROSEGILL Chrome table filters on 2026-10-29 showed 2,169 products, 597 archived, 596 stock_quantity=0 and 597 stock_quantity<1; 592 archived, non-deleted, stock_quantity=0 records have owner_store_id IS NULL. Inventory STR1 shows 1,577 / 1,572 active / 5 archived. The ownerless zero-stock cohort exactly matches the 592 count gap; source branch-policy and SQL catalogue rules exclude ambiguous zero-stock provenance, and the isolation migration deliberately had no ownership backfill. Owner confirms these 592 belong to STR1; prepare guarded identity-frozen repair, do not apply yet. Check stock_by_store, legacy productOwners, transfer evidence and deployed triggers/sync before execution; stock_quantity alone is not the lifecycle input. Archived-negative exclusion from inventoryMetrics is a separate confirmed calculation limitation awaiting its own approval. Do not widen cross-cluster access or silently change quantities/status. Review: database/archive-ownership-repair-review.md. |
| INV-10 | Display implemented / scoped verified; backend pending / High | DEC-44..47 approved code-only batch: shared stockDisplayLocations enforces terminal binding, then account binding, then authorized management directory; unknown binding fails closed. Inventory Other Sources uses permitted product-catalogue locations, selected-cluster scope, active locations and qty>0 for rows/count/total; no hidden counts masquerade as zero. All Shops management stock cards retain authorized access; stock export remains selected-cluster scoped. Clarified private toggle copy; table column positions, authoritative stock maps, checkout, lifecycle and saved flags unchanged. Final 14 isolated suites /114 tests, TypeScript, scoped ESLint and diff checks passed; independent candidate review found no actionable regression. Preview signed out, so real signed-in popup/native behavior is unverified. Backend raw product stock maps still lack privacy projection, and the 592-record ownership repair is unapplied. No live migration or data change. |
| REP-01 | Implemented / High | Complete paginated sales/shift history, current-shift/date-range receipt filters, branch/cluster totals, store timezone, full selected/all-shops totals and profit were patched. Verify thousands of records, midnight shifts and simultaneous management/normal clients; inspect final PR CI. |
| REP-02 | Pending / High | Management report service exists, but `ipc-privilege.cjs:638` blanket business-channel guard blocks its installed handler with MANAGEMENT_ONLINE_ONLY. Test installed wrapper→repository with scoped complete replicas; preserve operations restrictions. |
| REP-03 | Pending / High | Replica scope/completeness: current management discovery (`sync-endpoint.server.ts:257`) enumerates all stores; arbitrary configured subsets are not established. Separate desired scope from actual model. Do not infer completeness from schema-ready or bootstrap_7300 job name alone; verify compatible no-cutoff contract, counts/checkpoints and failed bootstrap behavior. |
| REP-04 | Implemented / Medium | Display line-wise subtotal, discounts, tax-if-applicable, rounding and collected total; keep sponsorship value separate from cash, follow inclusion policy and hide zero rows. Verify home/selling/report/shifts graph consistency without rewriting sale amounts. |
| REP-05 | Pending / Medium | Some audit/history readers remain bounded (including large booking payment histories); identify/document truncation and paginate required histories. Estimated legacy profit may use current costs; label estimates instead of asserting captured historical cost. |
| DATA-01 | Pending / High | Readiness race: directory load sets ready in `pos-store.tsx:760` before full snapshot; dashboard :131,:233 renders unloaded inventory as zero while independent sales history is complete. Gate unknown/failed/partial data explicitly; test cold sign-in, delayed catalogue, currency/default hydration and retry. Navigation-to-Inventory is not proven the cause. |
| DATA-02 | Implemented / High | Query caching/coalescing/date predicates/indexed financial metadata and quiet refresh improvements exist (performance report). Continue full-freeze/slow staff/notification/database-loading investigation on phone/PC; use measured profiles, not process-count assumptions. |
| DATA-03 | Pending / High | Electron startup SQL ready versus actual trading/bootstrap readiness, automatic online fallback, reconnection and long cashier-PIN latency need isolated integration/affected-device evidence. Network/verifier errors must not become incorrect PIN; preserve uncertain transactions. |
| DATA-04 | Pending / Medium | Separate success/failure diagnostic files and clearer live connection/status terminology were requested; reconcile current logging implementation before another mechanism. Preserve credential redaction and useful state/stage/code evidence. |

### UI, notifications, policies and security follow-up

| ID | Status / severity | Requirement / evidence / next step |
| --- | --- | --- |
| UI-01 | Pending / Medium | Observed inventory summary amounts wrap mid-number at ~1155px. `styles.css:1454` allows arbitrary wrapping. Fix only presentation in an approved UI batch; test realistic large amounts and currency labels without changing calculation. |
| UI-02 | Pending / Medium | Observed mobile staff cards have excessive height/stacked actions and duplicated Last login label. Compact essential fields and accessible controls; test 15–20 users and no lost actions. |
| UI-03 | Pending / Medium | Bank-transfer form has seven unassociated input/textarea labels (read-only DOM check; `settings.payment.tsx:53` onward). Associate accessible names and test keyboard/assistive interaction; do not change bank details. |
| UI-04 | Implemented / Medium | Selling/card reflow, bill reference, readable before/after item and bill discounts, compact colored buttons/icons, barcode/camera/mobile search and flexible labels were improved. Audit actual rendered cart/charge controls without real transactions; no oversized/hidden critical actions. |
| UI-05 | Implemented / Medium | Login keypad collapsed behind circular control, minimum six PIN dots expanding for long PINs, bounded staff list, branding, splash and sidebar collapse need physical Electron/mobile acceptance. Remove special @ shortcut while preserving plain usernames/email and cashier PIN. |
| UI-06 | Implemented / Medium | Native update indicator is global for signed-in/signed-out/nonadmin users, progress ring near login/profile/bell, hidden once completed. Verify availability/download/install/restart at all platforms/channels; web/native boundaries and signing keys preserved. |
| UI-07 | Pending / Medium | Complete page/subpage/modal audit at mobile/tablet/desktop sizes, direct links and keyboard. Prior double app-shell/navigation reports and alignment/overflow require per-page evidence; do not include Membership redesign. |
| UI-08 | Verified (scoped UI) / Medium | DEC-25: Dashboard/Inventory share one Products/Categories card, hide loaded zero inventory indicators and preserve nonzero/signed values, loading/error/empty states and visibility grants. Home/All Shops zero inventory hints reflow without empty warning cards. Existing AnimatedMetric reused; no formula/API/global CSS changes. UI tests 12 files / 69 passed; full candidate 544 files / 3,354 passed. Live Inventory at default desktop, 390px phone and 768px tablet had no card or summary horizontal overflow; zero negative-stock card absent. DEC-26 financial-card hiding is separate UI-11. |
| UI-09 | Pending / Low | Confirmed dev warning: exported RulesSettings route reused by staff prevents code splitting. Profile production impact and isolate only in an approved batch; not proof of a runtime freeze. |
| UI-10 | Verified (scoped UI) / Medium | DEC-23/24: standalone SalesReconciliation panels removed from Home, Selling, All Shops, Reports and Shifts. Compact hover/click info icons explain existing financial totals, including Live Business Board, without new detail requests or cost-permission widening. Financial/visibility regression tests passed; live admin preview verified desktop and 390px phone-sized Revenue/Gross Profit tooltips plus Dashboard deductions. Calculations, receipts and loaded filters preserved. Physical phone/native rendering remains TST-04; DEC-25 inventory refinement is separate UI-08. |
| UI-11 | Verified (scoped UI) / Medium | DEC-26: loaded zero live financial/count cards hidden; negative values and zero-price bill counts preserved, All Shops zero-valued cards retained. Bills/peer values align; Dashboard Columns uses existing right-hand heading targets, shared Expand is phone-only. Twelve focused files / 64 tests, scoped lint, TypeScript and web build passed. Live Dashboard empty totals observed; both Columns buttons vertically aligned within 0.01px; desktop Expand hidden; at 390px phone Expanded table opened and closed with permitted columns intact. Viewport restored. No table data/actions, calculations or authorization changed. |
| UI-12 | Verified (scoped UI) / Medium | DEC-27/29/30: adaptive manual loop implemented for non-chart summary/inventory/shop/category groups, normal rows when cards fit. Graph components/helpers retain finite behavior; no extra records/fetches. Eleven focused files / 69 tests, 19-file lint, TypeScript and final web build passed. Real preview: narrow Windows first→last via ArrowLeft succeeded after fixing Embla spare-width edge gaps; phone 390px last→first returned Catalogue to x0; at 2200px loop disabled and six cards shared y0 without overflow. Viewport reset. Physical touch hardware remains TST-04. |
| NTF-01 | Implemented / High | Single rule table with selected users/roles, in-app/push/WhatsApp routes and no duplicate controls. Prior additive upgrade applied with owner approval; verify rule save/reload/delivery/disabled channel and only-selected audience using isolated fixtures, not sending real messages. |
| NTF-02 | Implemented / High | Personal Clear/unseen queue/immutable audit and token-owner/admin notifications were patched. Verify new-event-only toasts, stale offline acknowledgements, restart/concurrency and unauthorized recipient denial; retain delivery audit even after personal clear. |
| NTF-03 | Pending / High | External WhatsApp/push/device delivery and offline audit→cloud notification timing remain unverified. No real external messages authorized for this batch; provider/device tests need reviewed isolated recipients/configuration. |
| OPS-01 | Implemented / High | Operational policies consolidated under Staff & Permissions; global restrictions/duplicate authorization controls retired previously. Verify every saved policy actually drives backend/native behavior, including negative stock, authorized other-user shift close, table columns and offline approval—not UI alone. |
| SEC-01 | Pending / Critical | Reconcile all 10 findings in the original supplied Security Review against latest source/evidence (matrix below), especially finding #10. Earlier fixes are not proof the original report is fully remediated. Do not silently mark imported findings confirmed or fixed. |
| SEC-02 | Pending / High | Broader system/security review and requested PR Codex/ChatGPT Security review remain outstanding. Record exact scope/revision, validated findings, coverage and unavailable checks; initial agent source audit was not a formal completed scan. |
| SEC-03 | Pending / High | Supabase advisories/warnings, dependency vulnerability checks and historical error reconciliation need fresh scoped evidence before corrections. Keep migration/code/runtime failures distinct; no live SQL change authorized by Batch 0. |

### Required verification and owner-held work

| ID | Status | Acceptance / next step |
| --- | --- | --- |
| TST-01 | Pending | Execute all eight terminal cases in PROJECT_MEMORY.md with allowed/denied roles, omitted/forged token, shared SQL, direct APIs/RPCs/IPC, offline/retry/reconnect and safe reassignment. Existing test filenames are not pass results. |
| TST-02 | Pending | Establish isolated fixtures/environments for role/branch/warehouse matrices, transactional failure and concurrency tests. A beta database label is not isolation; never mutate real sales/stock/credentials to demonstrate a bug. |
| TST-03 | Pending | After each approved correction, targeted regressions then appropriate shared suite/type/lint/build checks, installed IPC integration and final diff review; broaden tests when changes/failures justify it. Record revision and actual commands/results. |
| TST-04 | Pending | Full end-to-end/page/device/printing/customer-display/SQL-failure acceptance and final system regression remain unfinished. Track unavailable access or evidence explicitly; do not declare global verification from browser/admin smoke checks. |
| HOLD-01 | On hold | Membership tiers, custom member email, table consolidation and related redesign requests are deferred by owner. Preserve existing behavior/data. Only a confirmed critical shared dependency with explicit Membership-change approval permits modification. |

AUTH-01/02/09 are implemented under Batch 1 with the verification limits below;
UI-08/10/11/12 are separately approved, scoped-verified UI changes. FIN-11 has
approved report-only corrections; its unentered-bill hypothesis is not verified.
FIN-13 remains design-only. Other corrections require separate approval.
No task is currently designated Blocked merely because it is difficult or pending;
record a concrete environment/access/decision blocker if it actually stops work.

## FIN-13: proposed Add missed bill design (awaiting review)

This is a proposal, not implemented functionality or a new permission grant.

- Entry point: an Add missed bill option beside the existing Audit/Corrections
  links. Keep the current posted-record administrator correction boundary for
  this first proposal; any future delegated permission needs its own decision.
- Capture original branch, date/time interpreted in the saved store time zone,
  original cashier, items with actual historical prices/discounts/tax, already
  received tender amounts, original reference when available and a required
  reason. Preserve the verified entering actor and entry timestamp separately.
  Do not infer historical prices/costs from today's catalogue without disclosure.
- Required stock choice, approved in principle by DEC-34: deduct unrecorded
  quantities exactly once, or stock already corrected (no stock movement).
  For the latter require an explanation and related adjustment reference when
  available. Never silently alter starting stock or bypass stock policies.
- Branch-locked terminals remain within their registered branch, including
  administrators. Management may select only authorized branches. Product and
  warehouse scope still follow the approved branch/cluster rules.
- Proposed shift treatment: link the actual original shift if reliably known;
  otherwise retain a clearly marked historical correction with unresolved shift
  attribution. Never attach it to today's open shift just to satisfy checkout.
  Closed-shift corrections must be visible as later adjustments, not rewrite a
  previously issued Z report invisibly. This reporting treatment needs review.
- Use a dedicated atomic authoritative operation with a stable idempotency key,
  deterministic child/movement identity and an append-only audit trail. Reuse
  existing mappings/journaling, not the ordinary checkout's current-time/open-shift
  assumptions. Warn about a possible matching branch/reference/date/items before
  entry; enforce persisted retry identity without conflating legitimate duplicate
  reference numbers. Resolve concurrent online/local retries before acceptance.
- No payment-provider charge, drawer pulse or automatic print. A later explicit
  reprint may show the original sale date and that it was entered as a correction.
  Proposed received-payment reporting belongs to the original payment context;
  it must not add fresh money to today's drawer. Unknown attribution is explicit.
- Acceptance before release: allowed/denied scope and correction access, both
  stock choices, closed/unknown shift behavior, exact reports, timeout/retry,
  duplicate/concurrent submission, native offline/reconnect and audit/reprint.
  Use isolated fixtures only. Any cloud/local schema change requires a reviewed
  migration and separate application approval; no live rollout is authorized.

Existing source evidence: `audit.tsx` links to existing-record correction;
`sale-corrections.functions.ts` requires an existing sale ID/version;
`pos-store.tsx` ordinary recordSale requires a matching open shift and stamps now;
`pos-db.ts` commitSale already has stable transaction identity/atomic posting.
Do not bypass those safeguards to implement historical entry.

## Original supplied security report reconciliation

Source: owner's attachment titled **Security Review: retail-pos-main**, 10
reportable findings. Original severity/confidence are not silently carried forward
to a new revision. Preserve the report; do not commit credential-bearing evidence.

| Original finding | Current ledger disposition |
| --- | --- |
| 1. A valid device proof can mint a session for another employee | Pending latest-code validation; related device identity work is not a complete closure. |
| 2. A requester can inflate the baseline used for relative approval limits | Prior amount/provenance fixes reported; reconcile all entry points and regression evidence before closure. |
| 3. A stock aggregate can modify unrelated product fields | Stock-only update guards reported implemented; verify native/cloud alternate paths. |
| 4. Per-record history reads do not check branch ownership | Pending complete read-boundary reconciliation; AUTH-02/04 overlap only where proven. |
| 5. A denied parent write can authorize a child write by ID | Prior persisted-parent/ownership fixes reported; revalidate current contract and retry tests. |
| 6. A revoked server session can fall back to a still-valid cashier token | Verify proof precedence and rejection classifications, including AUTH-07; UI refresh alone is not the whole issue. |
| 7. Authenticated callers can forge actor identity in central audit events | Pending actor/provenance boundary validation across relay/native/sync. |
| 8. Clearing terminal enrollment reopens privileged first-run IPC | Pending installed-wrapper and enrollment-clear/restart/reassignment validation. |
| 9. Terminal SQL synchronization can modify stores outside its branch | Prior scoped contracts exist; revalidate omissions, alternate paths and replay origin. |
| 10. A staff branch lookup can fail open to company-wide comparison data | Explicit original investigation remains pending; verify failed/missing branch lookup fails closed without breaking authorized management comparisons. |

## Verification / deployment evidence log

| Evidence | Actual scope and limits |
| --- | --- |
| DEC-46/47 stock display candidate, 2026-10-29 | 14 final focused suites /114 tests passed: stock display scope/render, canonical IDs, management branch switching, same-cluster/private catalogue, archive lifecycle/metrics/footer, cashier-sale permission and checkout contracts, exports, table columns, native catalogue predicates. TypeScript and six-file ESLint passed; git diff --check passed. Independent candidate review found no actionable regressions. Existing footer draft preserved. User preview was signed out during final render inspection; no user permissions/settings or transactions were changed. This proves the code-only display batch, not cloud/local raw-data isolation or installed end-to-end behavior. |
| DEC-32 report-only candidate, 2026-10-27 | Independent read-only correctness review completed. Full isolated Vitest: 547 files / 3,381 tests passed after correcting two obsolete label assertions, with amount/permission/negative-visibility checks preserved. TypeScript, 14-file scoped ESLint, diff and web build passed. Sponsorship uses the sales report's authorized store IDs; completed summaries deduplicate/exclude refunds, while history/export retain explicit status in the original Bill column. No checkout/pricing/receipt/stock/formula or database writes. |
| DEC-32 browser check, 2026-10-27 | Settled Bills/Payments matched at 80 completed bills; a new sale arrived after the earlier 79-bill snapshot. The saved Extra Discount reconciled before-adjustment net to final collections; sponsorship remained separate. At 390px the tooltip and report document stayed within the viewport, and temporary viewport was reset. Initial settings/currency hydration flicker remains DATA-01. No live business mutations were performed by the audit. |
| Resumption, 2026-10-29 | Verified latest root/branch/HEAD/dirty files against c514762d; report changes preserved. The earlier documentation-update attempt failed because automatic approval review hit an account usage limit; it did not execute and was not an unsafe-action determination. Decisions DEC-34..37 now recorded. Restarted only the owned preview after sandbox socket/Wrangler errors; outside-sandbox server returned HTTP200 using existing .env.local without exposing values or changing configuration. New Archive investigation is read-only. |
| Report candidate recheck, 2026-10-29 | Eight focused report/financial/cashier-permission suites / 50 tests passed after replacing test amounts with synthetic fixtures. The final application diff is the same candidate that passed the 547-file broad run; report helpers/formulas, scoped visibility, refunds and table-column positions retained. Generated build report preserved separately in stash ad285e6d16afa83078aac1c30ee6ffe4223fc9ef. Documentation checks: 77 task IDs / 37 decisions unique; Membership hold and untouched zero-byte booking migration confirmed. |
| DEC-38 Archive UI candidate, 2026-10-29 | Root independently reviewed the three-file presentation diff after agent implementation. Eight final focused suites / 59 tests passed (status, inventory metrics/summary, catalogue loading/isolation, lifecycle, export and shared controls); TypeScript, scoped ESLint, diff and web build passed. Desktop preview showed active/archived modes and five archived rows; 390px panel scrollWidth350 <= clientWidth350, document390 matched viewport390. No product/stock/permission setting was saved. Final live search interaction remains unverified after preview sign-out; temporary viewport reset and server left running. This targeted UI pass does not replace the separate report candidate's 547-file broad run or certify every installed platform. |
| Source delivery, 2026-10-29 | Report correction eb970d1b and UI `45893068` are separately committed/pushed to existing beta PR #341; concise PR description updated. At the last read, Archive CI compile/role/windows/iOS remained running, label passed, CodeRabbit skipped. Worktree has no application changes left; unrelated drafts/empty SQL migration and all three generated-health stashes preserved. Rollback is a separate reviewed revert of `45893068` for Archive or eb970d1b for reports; neither requires a database rollback. Membership remains on hold. |
| Documentation-only Batch 0, 2026-10-27 | All 10 intended Markdown files checked for local links and allowed diff scope; original HEAD AGENTS retained as exact text prefix, below 32 KiB; 75 task IDs and 21 decisions unique; eight required cases and explicit Membership hold present; git diff --check passed. Two independent agent reviews completed and actionable corrections applied. Pre-existing drafts preserved, empty booking migration unchanged and signing-key path still ignored. No app tests/build/SQL or runtime data changes performed for this batch. |
| Batch 1 + DEC-23/24, 2026-10-27 candidate | Independent pre-patch boundary investigation and one fresh candidate review; concrete compatibility findings corrected. Full isolated Vitest: 543 files / 3,344 tests passed; TypeScript and touched security/UI ESLint passed; web production build passed with existing bundler/config warnings. Post-review native attribution/compatibility follow-up: 8 files / 72 tests passed; financial/source-contract follow-up: 11 files / 94 tests passed. No real checkout, stock, credentials, terminal enrollment or database writes performed. |
| Test-environment qualification | Windows sandbox module collection failed before assertions; authorized external-sandbox mocked runs succeeded. Initial broad run also exposed five obsolete source-contract assertions, now corrected, and the pre-existing empty untracked booking migration. Final full run temporarily held only that zero-byte draft under a non-SQL filename and restored it unchanged in finally; it is not part of the PR or applied SQL. Generated build health report restored; no test failure was hidden by deleting a draft or changing business logic to satisfy strings. |
| Batch 1 remaining architecture limits | Persisted terminal identity retention and Main enforcement are tested; this is not a full security certification. Native/browser requests using the same unbound account bearer are not cryptographically distinguishable here. Legacy sessions/plaintext migration require separate reconciliation; direct RLS/RPC scope, arbitrary management branch subsets and installed Management report denial (REP-02) remain pending. Remote installed phone/Windows, DPAPI/shared SQL failure/reconnect and physical checkout/printing have not been executed in this batch. |
| DEC-25 inventory refinement, 2026-10-27 | Full isolated candidate suite: 544 files / 3,354 tests passed; focused shared financial/inventory/render suites: 12 files / 69 tests passed; TypeScript, 14-file UI lint, diff and final web build passed. Inventory cards verified at 390/768/default desktop using actual render and DOM scroll/client-width checks; temporary viewport reset. No live inventory/setting/payment edits. |
| DEC-26 zero cards/table controls, 2026-10-27 | Twelve final focused files / 64 tests passed, including negative and zero-price bills, loading/errors, shared table columns/loading/export. Scoped ESLint, parent TypeScript and web build passed. Actual desktop heading alignment and 390px phone expanded-dialog checks passed; no live business mutation. Brief secondary read-only browser tab had no sign-in and was closed; primary later required reauthentication, supplied by owner. No causal cross-tab sign-out defect is claimed from that observation. |
| DEC-31 financial investigation, 2026-10-27 | Connected beta account/project URL verified as the existing POS qhrufhtbeguxydenzfey project. SELECT-only aggregates matched displayed 79-bill cohort and reconciled ledger/header/sponsorship as FIN-11. No financial code, schema, records or settings changed. Configured display currency is read from UI/settings, never inferred from geography. Await report-batch approval and manual/local 6,851 evidence; do not silently force totals. |
| DEC-27/29/30 adaptive card rails, 2026-10-27 | Eleven final focused files / 69 tests, scoped lint, TypeScript and local web build passed. Runtime initially exposed a real Embla finite fallback at exact gap-based sizing; spare width now excludes all edge gaps, and actual Windows/phone wraparound succeeded. At 2200px fitting cards restored a single untransformed row, no slide overflow. Global carousel, chart helper, pricing and financial-math helpers unchanged. No auto movement, duplicate business records or new backend queries; temporary viewport restored. |
| Source checkpoint `1af373f5` | Branch write/shift guards, cluster ownership/provenance, paged reports/shift history, timezone and settings/notification changes previously committed/pushed to PR #341. Newly audited defects remain. |
| Prior automated runs (conversation record) | 531 files / 3,266 tests before final focused follow-ups; compatibility 29 and reconciliation/guards 27 checks; TypeScript, lint and web build reported passed. No fresh full run during read-only audit/Batch 0; untracked drafts not certified. |
| Prior sync checks (conversation record) | 70-table registry/contract verified; 31 sync-pipeline checks passed. Not a field SQL Server failure/restore acceptance. |
| 2026-10-27 read-only audit | Three bounded agent reviews plus parent source review; 123 route files, 20 APIs, 45 settings inventoried. Browser admin/read-only screens inspected at representative sizes. No full permission-by-operation runtime matrix or formal security scan completed. |
| Read-only deployed catalog checks | Booking balance/collect/net-paid routine grants/definitions and store_visible inspected. No exploit call, financial mutation or security bypass performed. |
| Browser observations | Staff, Home, Inventory, Selling landing, Approvals/Bookings and three Payments pages inspected to varying depth. Reauthentication restored session; no live save, checkout, approval, stock post, print/drawer or credential change performed. Temporary viewport overrides reset. |
| Latest owner confirmation | Earlier mobile Sponsorship/account-save issue reported successful by owner after backend-address/account correction; not independent full-platform certification. |

Four migrations were **recorded by the prior session as owner-approved, applied
successfully to the connected POS project and checked against financial/stock/
permission invariants**. This is historical application evidence, not a Batch 0
database action or an assertion that every pending migration is applied:

1. `20261026161839_honor_configured_cross_cluster_transfer_approvers.sql`
2. `20261026162030_isolate_cluster_catalogue_reads.sql`
3. `20261026231535_verified_native_transfer_approval.sql`
4. `20261026232513_paged_secure_shift_history.sql`

Other notification/sponsorship/security migrations require their own history
reconciliation before another rollout. Never replay a migration based on a filename
or old report alone. In particular, the following are **unfinished untracked drafts**:

- `supabase/migrations/20261026235201_atomic_booking_collection.sql` — empty,
  officially generated filename, no implementation and not applied.
- `electron/booking-collection-ids.mjs` and `.d.mts` — helper draft only.
- `src/lib/__tests__/booking-collection-gap.repro.test.ts` — isolated reproduction
  draft, not the completed replacement workflow.

Also preserve pre-existing `.pending-*` notes/backups and `supabase/.temp/`.
Do not stage, delete or treat them as part of documentation-only Batch 0.

## Current handoff

- Latest 2026-10-29: DEC-41..43 supersede the earlier account-access blocker for
  read-only browser inspection only. ROSEGILL pos and STR1 identities verified;
  the 592 ownerless archived zero-stock records match the missing count, and the
  owner confirms STR1 provenance. Repair preparation is documented in
  [the review plan](database/archive-ownership-repair-review.md), not applied or
  tested as executable SQL. Same-cluster catalogue visibility must coexist with
  private branch stock. Finish manifest/live trigger/sync preflight and isolated
  repair tests before application approval. Connector routing remains denied;
  no Primary project, credentials, stock or grant workaround is authorized.
- DEC-46/47 display-only stock correction is implemented and scoped-verified
  (14 suites /114 tests, types/lint/diff, independent review). Preserve its
  explicit backend-read limitation and unapplied legacy repair. Worktree source
  remains local/uncommitted with earlier approved footer draft; do not claim PR
  delivery or installer publication. No additional live action is approved.
- The activation clarification is DEC-04; newer refinements are DEC-20 (one clear
  management home per field responsibility) and DEC-21 (concise transition updates).
  They refine coverage/reporting, not the approved application-change boundary.
- DOC-00 is verified and committed locally as d0519d5a. The owner separately
  approved Batch 1 (DEC-22); no approval is inferred for other AUTH/FIN/SET work.
- Batch 1 baseline/code: d0519d5a → 608398c6, followed by independent UI
  commit c514762d, pushed to beta PR #341 with all reported CI gates successful
  (CodeRabbit skipped). Preserve pre-existing booking/scratch drafts. Origin/beta
  e86bf889 remains the inspected PR base. Continue without mixing older source.
- AUTH-01/02/09 source corrections and isolated regressions implemented. Preserve
  recorded limitations; do not mark all eight device scenarios globally verified.
  UI-08/10/11/12 are committed as c514762d. Approved report-only FIN-11/DEC-32
  corrections passed local checks and are pushed as eb970d1b; reported CI passed
  (CodeRabbit skipped). Preserve
  original records/calculations; show sponsorship separately from cash receipts.
  Owner will compare originals for suspected unentered bills behind the expected
  6,851 (DEC-37); no missing bill is independently confirmed.
- FIN-13 is proposed design only. INV-08's five-row Archive list was observed;
  source has no row cap or zero-stock exclusion, but stored-count completeness
  could not be checked because Supabase read permission is unavailable.
  Its separately approved UI counts/mode/filter clarification is DEC-38.
- DEC-38 code is now committed/pushed as `45893068`; finish its CI and the optional
  live search interaction after the owner signs in. Database source-count checking
  needs the connected read access restored; do not retrieve or expose credentials.
- Generated UI-build health metadata was preserved in scoped Git stash
  c935d915326ba6f7563dd391b7e195adcf8b3b18 after approval review rejected a restore.
  Later report-build metadata is preserved in stash
  ad285e6d16afa83078aac1c30ee6ffe4223fc9ef; Archive-build metadata is in
  d6a65a6d6104d3ff4c10e87b47ef67ef3c9bc914. Do not drop these stashes.
- Recovery: code-only batch must be a separate reviewed commit, reversible without
  rewriting business data; no live SQL migration, role grant or terminal reassignment
  is part of Batch 1. An expanded architecture/schema need requires new approval.
- Keep the local preview process unchanged/available for owner review. Starting,
  restarting or checking a server is not proof of correct SQL or authorization.
- Before stopping, record any new decision, task change, approval and verification
  limit here. Preserve Membership hold and every unresolved row.
