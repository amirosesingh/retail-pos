# POS project memory

Last reconciled: **2026-10-31, Asia/Brunei**. This is approved architecture and
decision memory, not a claim that all implementation conforms to it.

The owner's latest inventory UI refinement (DEC-25) combines adjacent Products
and Categories metrics into one compact card, hides loaded zero inventory
indicators, and requires responsive cards to contain large numbers. Retain
scope, visibility permissions, calculations and real loading/empty states;
The later DEC-26 explicitly extends zero-card hiding to financial/count cards on
Live Dashboard and Live Business Board; keep All Shops zero-valued cards.
Never hide meaningful negative balances or treat incomplete data as loaded zero.
Expand table is phone-only; Columns belongs beside its table/section heading.
DEC-27 further asks for small-screen summary cards to swipe sideways in a manual
loop, last card back to first, with no visible scrollbar. Keep desktop layout,
visibility grants and loaded data; do not interpret infinity as endless database
fetches or introduce automatic movement.
The owner's controlling correction DEC-29 excludes graphs, charts and their
containing cards from the new loop. Apply it only to non-chart summary,
inventory, financial and shop card groups; retain existing chart behavior.
DEC-30 extends the same behavior to Windows/desktop when available container space
would otherwise make cards wrap. Use responsive fit detection, not a phone-only
platform check; keep the ordinary layout when all cards fit on one row.

On30October the owner reconfirmed loaded-zero summary visibility and requested
smooth appearance/reflow when a card gains data (UI-15). Animate presentation
only; do not fetch again or reset operational state to animate. Preserve real
loading/errors, meaningful negative balances, permission-hidden reflow and
reduced-motion accessibility. The owner explicitly reconfirmed that All Shops
continues showing every shop even when its totals are zero. Preserve required
operational actions and chart behavior; a zero summary is not a reason to hide
the controls needed to create the first transaction.

Read [../AGENTS.md](../AGENTS.md) and [TASK_TRACKER.md](TASK_TRACKER.md) first.
The tracker records defects, unfinished work, verification and approvals.
Technical detail remains in the existing references linked below.

Latest30October decisions: SHIFT-14 correction code/isolated tests are approved;
the exact shift-sync migration was subsequently approved and applied at23:59:38
Brunei (livehistory20261030155938). Future live changes still need separate
exact-project approval. Never treat
a client/local closure notification or aggregate applied count as proof that the
central shift closed. Same-branch, same-shift authoritative acknowledgement and
idempotent replay are required; no existing shift/count repair is authorized.
See [prepared correction review](database/shift-closure-sync-review.md).

31October follow-up: the owner explicitly approved the corrective version2
shift-proof helper. The unchanged reviewed20261030164829 source was applied to
the exact ROSEGILL pos target; live history20261030234442 confirms it. Pre/post
checks retain service-only SECURITY INVOKER access and exact closing/branch
facts. Live read-only validation returns cloud revision4/requested revision9;
no business rows were rewritten. Installed-terminal acceptance remains separate.
The owner also approved shared-popup reconnect correction plus isolated browser
tests, and notification acknowledgement correction preparation/isolated tests
only. No live notification migration approval is inferred.

The owner also approved compact Low/Negative stock alerts with clickable numbers
and a review→existing stock-count workflow. Physical counts begin blank, require
explicit review (0 when actually counted), permission and audited posting. Never
silently zero live stock. Numeric current-branch Stock column searches explicitly
include both Active and Archive; clear UI scope must distinguish this from the
ordinary selected-view filter. Preserve branch/cluster boundaries and global SKU.

Manage locations keeps All Shops/Live Dashboard buttons. Catalogue and quantity
scope are distinct: same-cluster products, per-location quantities, permitted
same-cluster availability and authorized management views. A saved privateStock
preference currently has no independent runtime consumer; explanatory text must
not claim that switch alone enforces privacy. Do not silently invent a new rule.

## Authority and current work boundary

1. The owner's latest explicit instruction controls; document corrections and
   superseded decisions rather than silently combining conflicting requirements.
2. AGENTS.md holds permanent development safeguards. This file records approved
   business architecture/decisions. TASK_TRACKER.md is the single current ledger.
3. Source and deployed-definition inspection establish actual behavior, including
   discrepancies from the approved architecture. They do not authorize changing it.
4. Historical audits/checkpoints retain their dated/revision-specific evidence.
   They do not override current owner decisions or certify a later build.

The owner approved **documentation-only Batch 0** on 2026-10-27: preserve existing
rules, record branch locking and all pending work, and keep Membership on hold.
No application/test code, migration, database record, permission or operator
configuration change is authorized by that batch. Later correction batches need
separate review/approval. Publication and production promotion retain AGENTS.md's
separate approval gates.

On **2026-10-27** the owner separately approved **Batch 1**: check Electron and
mobile activation for Operations/normal and Management terminals; fix trusted
branch locking; preserve cashier checkout and unrelated functionality; use agents
and the beta-first workflow; keep Membership on hold. AUTH-09 investigation and
the narrow AUTH-01/02 identity/branch enforcement corrections and their necessary
tests are now authorized. No live database mutation, unrelated workflow redesign,
installer publication or production promotion is approved by that instruction.
Record required shared-boundary changes and remaining later-batch risks explicitly.

On 2026-10-27 the owner additionally approved **report-only corrections** (DEC-32):
align authorized sales/sponsorship scope and refunded-bill totals and explain
before/after receipt adjustments and sponsorship values. Preserve checkout,
receipts, stock and stored records; use a separate recoverable commit. This does
not authorize forcing totals to a manually expected amount or rewriting history.

The owner subsequently confirmed that a proposed missed-bill entry is for a
historical sale already paid and handed over, with a mandatory choice about
whether its stock was already corrected (DEC-34). The owner explicitly requested
design review before implementation (DEC-35). Keep that proposal separate from
ordinary checkout and report display; no new financial write is authorized yet.
The manual expected total may include unentered bills; the owner will compare
the originals (DEC-37). Do not treat a suspected omission as an existing record
that may be invented, overwritten or silently reattributed.

On 2026-10-29 the owner approved UI-only Archive clarification (DEC-38): display
the archived-product count separately from active-stock metrics, identify the
current Active/Archived view and disclose filters limiting it. Preserve product
status, branch/cluster catalogue visibility, stock and valuation calculations.
This is not approval to automatically archive every zero-stock branch row.

## Archive ownership clarification (2026-10-29)

DEC-41..43 require ROSEGILL only for POS checks and explicit identification and
approval before any database edit. Chrome independently verified project pos
(`qhrufhtbeguxydenzfey`) in rosegill0011@gmail.com's Org
(`bjxgimekljzlnwejuawj`). The owner confirmed the 592 hidden archived products
belong to STR1 / 361 Degree Sports (`a611a328-2217-4d77-944a-5f6a637d123b`).
Prepare the [ownership repair review](database/archive-ownership-repair-review.md);
do not apply a database update without separate approval and trigger/sync checks.
Private stock restricts quantities; it must not hide products belonging to the
same configured cluster. Preserve other clusters' isolation and normal-terminal
branch restrictions. Confirmation of provenance is not permission to merge
catalogues, change stock/archive flags or bypass authorization.
Actual STR1 location dialog confirms cluster **361 DEGREE SPORTS**, with both
Private catalogue and Private stock enabled. Source audit INV-10 found stock
privacy is not yet enforced consistently; do not describe the switches as proof
of protected reads. DEC-45 confirms authorized management keeps stock access only
within its granted branch scope; normal terminals expose their own quantities
even when a management-role user signs in. Device type alone grants no scope.
Keep redacted display/read projections separate from authoritative
stock maps used for company-wide lifecycle and checkout mutation validation.
DEC-47 further narrows Inventory Other Sources to active, authorized locations
with positive stock in the selected branch's own cluster. Exclude zero/negative
stock and other clusters even for a product available through a completed
transfer; this does not narrow authorized management's separate All Shops cards.

## Membership: ON HOLD

DEC-57 approved Add missed bill implementation (supersedes FIN-13 design-only
status). Administrator-only historical, already-paid entry uses a separate atomic
online service and requires an explicit stock-handling choice. Record original
sale/payment time and cashier; keep operational shift IDs NULL and original shift
as audit metadata, preserving current drawer and issued shift snapshots. No
provider charge/drawer pulse/auto print. Web/mobile/Electron use hosted online
transport; offline historical creation is deferred. Migration application is
separately approved, never inferred from code approval. See
[implementation/migration review](database/add-missed-bill-review.md).

DEC-52 selected-branch Inventory classification: Active means quantity>0, Archive
means quantity<=0 with explicit negative warning. It is a read-only catalogue
view, not a change to global product archived flags or another branch's status.
Footer, cost review and Inventory export choices follow the same branch view.
Existing manual shared-status actions are explicitly labeled global/shared.

Ownership sync durability candidate DEC-51 preserves established product owners
on newer NULL/blank-owner uploads (cloud conflict update and local renderer
upsert). Explicit nonblank assignment, new inserts and version/stock rules remain
unchanged. Migration20261029064933 is locally tested, not yet applied; do not claim
live protection until owner approves and the routine is deployed. Real installed
Electron/mobile catalogue refresh remains unverified despite fixture pagination.

Latest DEC-48 overrides the earlier own-stock-only display assumption: normal
terminals may view positive available stock from other active locations in their
registered branch's cluster. This is read-only stock availability, not permission
to switch the operating branch or write another branch's stock/sales. SKU numbers
remain globally allocated across clusters; catalogue data remains cluster-scoped.

Do not redesign, activate or modify Membership. Preserve existing functionality
and data. Only a confirmed critical shared dependency, with the owner's explicit
approval before the Membership change, permits an exception. Earlier membership
tier/email enhancement and consolidation requests remain deferred in HOLD-01.

## Source identity and evidence baseline

| Item | Recorded baseline; re-check every session |
| --- | --- |
| Development checkout | `D:/Retail POS/retail-pos-main/retail-pos-main/work/security-review-fixes-beta` |
| Branch / source checkpoint | `codex/shift-variance-colors` / report-only commit `eb970d1b21e7d7e5def4ad5d305cc523882f8414` after separate UI checkpoint `c514762d`; re-check HEAD for later approved Archive UI work |
| Source package version at that checkpoint | `1.4.80`; not an assertion of the latest published installer version |
| Existing review | [PR #341](https://github.com/amirosesingh/retail-pos/pull/341), target `beta`; source/merge/check state must be refreshed before acting |
| Last inspected remote refs | `origin/beta` `e86bf889`; `origin/main` `2f404e6f` (stable 1.4.79). Cached observations, not current remote guarantees. |
| Older primary checkout | `D:/Retail POS/retail-pos-main/retail-pos-main`, commit `3b35eb27`, release 1.4.65; do not overwrite current source with it |
| Other chat-attached checkout | `C:/Users/Asus/.codex/worktrees/security-findings-beta/retail-pos-main`; a separate checkout, not automatically the newest source |

Multiple worktrees and distinct source/release version labels caused confusion.
Verify root, branch, commit, dirty files and actual release channel separately.
These paths identify the reviewed session; they are not permanent machine paths
that future contributors must recreate. Preserve unrelated local work and drafts.

## Approved architecture

### Normal / Operations terminals: controlling owner correction

- Register each normal Electron or mobile POS terminal to one specific branch.
  Users cannot ordinarily switch its branch or access another branch's protected
  sales, inventory, settings, reports, employees or other operational information.
- User permissions determine actions **inside** that branch. Wider manager/admin
  account authority never overrides a normal terminal's registered restriction.
- Verify the restriction in backend APIs/RPCs, RLS/equivalent controls, Main/IPC,
  local SQL/offline operations and caches, as well as navigation and selectors.
  Preserve verified session terminal identity even if request fields are absent.
- Never trust renderer/request branch identity as the terminal's registration.
  DPAPI/Keystore sealing protects storage; it does not authenticate arbitrary
  activation fields supplied by a renderer.
- Reassignment is a distinct authorized administrative operation with safeguards,
  audit attribution and a pending-transaction recovery/drain protocol. No session
  adoption, temporary pairing or activation mirroring may silently reassign it.

### Management and web

- Management terminal classification grants neither a staff role nor action or
  all-branch access. Device admission, account assignment, authorized branch set,
  action grants and selected operating/report view are separate concepts.
- Authorized management devices may select branches or consolidated views only
  within the account/device's allowed scope. Do not bind an authorized management
  device to a stale normal-terminal branch. A NULL assignment is not proof of
  unrestricted access or of a particular multi-branch subset.
- A browser is web management: use normal authenticated account scope; do not
  require native terminal registration or inherit cached native activation.
- The owner's 2026-10-27 clarification specifically includes **existing Electron
  terminal activation and mobile terminal activation, for both Operations and
  Management**. Review temporary registration, pairing, claim, verification,
  session adoption, expiry/revocation and reissue together before correcting
  online authority. Their existence is not proof of a bypass or a reason to
  duplicate/remove them. See AUTH-09 in the tracker.
- Home/consolidated management views use all authorized shops. All Shops shows
  each authorized shop separately; totals have explicit cluster/all-cluster and
  period scope. A normal branch terminal displays its branch only. Selected-store
  views must not reuse another branch's shift, bills, cache or totals.
- A management PC configured for local SQL should retain data from all shops in
  its configured authorized scope, supporting protected offline reads. Operations
  PCs use their own branch locally; other permitted remote views require online
  access. Do not present incomplete replicas as authoritative complete totals.
- Current implementation limitation: the inspected account model principally
  represents one assigned branch or NULL/all, and management replica discovery
  enumerates all stores. An arbitrary authorized subset such as A+B excluding C
  is not demonstrated. AUTH-03/REP-03 must resolve this distinction before claiming
  configured subset isolation; documenting the desired scope does not implement it.

### Warehouses, clusters and stock

- The implemented model represents stores, buildings, central warehouses and
  sub-warehouses as locations (`Store.locationType`, `parentId`). Hierarchy and
  picking exist; an independent per-warehouse ACL is not yet established across
  all paths. Do not invent that feature or equate parenthood with access.
- On a normal terminal warehouse permissions remain subordinate to its registered
  branch. Another branch's protected warehouses/stock require an explicitly
  approved cross-branch workflow.
- Cluster catalogues remain separate unless products are transferred through the
  approved workflow or the owner approves a merge. Broad management visibility
  does not merge catalogues, stock ownership or private data. Intra-cluster moves
  retain ordinary action permissions; inter-cluster moves additionally follow
  configured approver rules. Do not add a blanket higher-authority approval to
  every intra-cluster move.
- Catalogue stock is view-only for current and other locations. Change quantities
  through receiving/purchasing, transfers and authorized stock movements/counts,
  not incidental product-detail edits. Avoid creating starting stock implicitly.
- Purchase cost value, configured Total Unit Cost value and retail value are
  distinct. On-hand valuation uses that branch's quantity and applicable costs/
  prices; do not combine different valuation concepts or rewrite history for UI.
- Negative stock follows the saved operational policy, not a hardcoded universal
  allow/deny. Enforce the authoritative policy online/offline and on retry.
- Missing category/group/subcategory should follow the approved `Default` naming
  behavior; ambiguous legacy ownership needs review, not guessed cluster assignment.
- E-commerce visibility/editing is management-owned and setting/permission gated.
  Branch sync must preserve management-owned e-commerce fields/settings. Do not
  indiscriminately copy them to normal terminals or grant cost visibility to cashiers.

### Storage, synchronization and configuration

- Electron uses **Microsoft SQL Server**, not SQLite, for local business storage.
  Web/Android/iOS operational data are online-only; offline phone token generation
  is not offline billing.
- Try configured local SQL during Electron startup; use the canonical connection/
  readiness state. The owner approved automatic online fallback when local SQL
  becomes unavailable. Preserve pending/uncertain local transactions and stable
  identities; a business denial is not a connection failure or fallback permission.
- Shared physical storage grants no shared access. Preserve original business,
  branch, warehouse, terminal and user context where applicable. Retries,
  reconnects, replication and reassignment must not relabel old transactions.
- Use transactional sale/payment/stock writes, dependency-aware sync and durable
  retry identities. Receiving a new catalogue must not block checkout or replace
  pending financial/stock work. Avoid a second competing synchronization engine.
- Cache by database/session/user/permissions/branch/period as appropriate. Reuse
  loaded data, invalidate matching changes, coalesce concurrent reads and avoid
  needless whole-page refreshes. Do not promise row-only reads where the actual
  report implementation reconciles an authoritative range.
- `supabaseConfig()` remains the single runtime resolver. Native operator values
  are sealed and supplied through Settings; hosting supplies web values. Never
  restore generated clients that bypass this configuration or disclose secrets.
- The connection named **beta has used the same real POS database as the preview**.
  A name or a beta website is not an isolated test environment. Use disposable
  fixtures for financial, inventory, security and destructive tests.
- Existing Postgres upgrades use reviewed incremental migrations, not replaying
  the full schema against production. Local SQL uses its controlled/generated
  update process. Record actual database migration state separately from code.

### Permissions, settings and approval credentials

- Copy appropriate role defaults when creating/changing a role; preserve explicit
  user additions/denials on ordinary account edits. Do not grant rights to resolve
  frontend/backend mismatches. A page flag, action grant, approver eligibility,
  financial limit and device admission flag are distinct controls.
- **Staff management is delegatable** through the saved `can_manage_staff` grant.
  The owner's later correction supersedes the temporary admin-only suggestion.
  Existing global staff administration is not silently narrowed or widened.
- Management computer and management mobile/tablet sign-in switches belong at
  the bottom of **Edit account**. Earlier requests placing them in Edit permissions
  were superseded. Page/action/element controls belong in Edit permissions;
  selected approvers and their limits belong in Approver rules.
- Settings need explicit Save, authoritative acknowledgement, correct reload,
  locks, path ownership and scope-specific cache invalidation. Live previews must
  not auto-save. Shared sections inherit Global → Cluster → Branch or Global →
  Cluster → Terminal according to section ownership. PRIVATE owner preferences
  use a separate path; they are not a generic SettingsFrame override tier.
  Separate company/warehouse tiers are not proven implemented features.
- Personal themes/display preferences are private. Store/system timezone and
  saved currency govern business dates, date filters, receipts and reports, not
  the remote viewer's timezone. The owner reversed the earlier viewer-local idea.
- PINs and per-user soft tokens authorize only eligible users/actions/branches
  within limits, offline-policy validity and replay controls. Preserve approval
  attribution. A delayed/unavailable verifier response must not say incorrect PIN.
- Offline selected-approver verification on the same PC is allowed only when
  offline approvals are enabled. Offline phone-generated tokens require a valid
  enrolled Windows verifier and accurate clocks; do not promise immediate offline
  revocation discovery or global single-use coordination across disconnected PCs.
- Successful token use records who approved and notifies the verified owner and
  administrator through notification rules after synchronization as applicable.
  Device-level token setup must not be exposed indiscriminately on branch tills.

### Sponsorship, booking, receipts, reporting and notifications

- Sponsorship records recipient, time, reference, discount, approval and handover;
  prints a receipt and deducts stock once. Numbering is configurable with other
  documents. The daily-sales inclusion policy is explicit; stock value is not
  customer cash. Hide zero sponsorship rows.
- The latest sponsorship decision allows configured administrator/direct-issuer
  exceptions. Other issuers require selected eligible approval at **any amount**.
  This supersedes the earlier absolute approval-for-everyone wording. Offline
  sponsorship coverage remains unfinished; do not claim the UI establishes it.
- Booking deposit money counts in the drawer/payment totals of the shift that
  actually receives it. Count the full merchandise sale once at collection;
  never count the old deposit as newly received cash. This is approved but not yet
  implemented consistently. Do not guess historical payment/shift allocations.
- Fully paid booking collection should not ask for payment again. An outstanding
  balance uses the ordinary payment-method/customer-display flow. Atomic payment,
  sale, stock and receipt linkage/retry recovery are unfinished work.
- Collected legacy bookings without a provable sale link require **Needs review**.
  Never automatically charge, issue a second sale or deduct stock to repair them.
- Booking/racket receipt and tag controls stay in **Booking Rules & Services**;
  sales receipt printing is separate. A customer slip and a separate racket tag
  are intentional outputs, not evidence of two barcodes on one receipt.
- Receipt preview reflects paper size/margins and printable layout. Preserve
  business/cluster visibility/order, per-section content, font family/font/custom
  size, extra sections, QR/barcodes and configured numbering. Per-bill print-off
  must not suppress an otherwise required cash-drawer pulse.
- Explain subtotal, item/bill discounts, net sales, applicable tax, rounding and
  final collected total in order. Hide zero tax/sponsorship breakdown rows. Report
  scope, sale-period versus shift-period semantics and cost estimates explicitly.
- Later owner correction (2026-10-27, DEC-23): remove **all added sales-breakdown
  panels** from Home, Selling, All Shops, Reports and other pages where added.
  Preserve normal totals, receipt details and financial calculations. This
  supersedes the presentation-panel request above, not the accounting rules.
- DEC-24 clarifies that financial breakdown belongs in compact hover/click
  information icons for Revenue, Gross Profit and related totals, including the
  Business Board. Explain existing amounts/deductions and resulting values with
  small keyboard/touch-accessible icons; avoid extra network/item-history reads
  or revealing cost details without the existing permission.
- One notification rules table includes WhatsApp, selected users/roles and routes;
  remove duplicate controls only after proving their responsibilities are covered.
  New events must not replay old toasts; retain unseen items in the user's queue.
  **Clear hides for the current user only**; retain immutable events/delivery audit.
- Native software update availability/install is global, including signed-out and
  cashier users. Show the small circular progress indicator on login or beside
  profile/bell as applicable only while an update is available/in progress/requires
  action. No unnecessary percentage label; no completed-update icon left behind.
- Keep branding consistent with the configured company/Retail identity; preserve
  existing login, printer and hardware behavior while improving the UI. Compact,
  readable mobile forms/search/buttons and reflow of hidden cards are required.
- The owner's latest refinement is one clear management home per setting/field
  responsibility, removing genuinely duplicate editors only after checking saved
  data and consumers. Preserve distinct scopes and purpose (permissions versus
  approvers; sales versus booking receipts), necessary fields and existing behavior.
- Give one concise status update when a task starts, enters verification or
  completes, identifying completed/working/pending work. Do not repeatedly report
  unchanged status or call an unverified draft complete.

## Mandatory terminal acceptance matrix

These are **requirements, not current pass results**. See tracker TST-01 and the
AUTH findings for missing cases. Use isolated data and installed IPC integration.

| Case | Required result |
| --- | --- |
| 1. Normal A + cashier | A only, with saved action permissions |
| 2. Normal A + manager/admin | Still A only despite wider account rights |
| 3. Normal A directly requests B via API/RPC/IPC | Denied; omitted/forged request fields do not remove binding |
| 4. Normal A offline | A only, including shared physical SQL and warehouse reads |
| 5. Normal A reconnects/retries/synchronizes | Original A ownership and attribution retained; no duplicate effects |
| 6. Management authorized for A+B | Both allowed, with correct selected/consolidated data |
| 7. Management authorized only for A | B denied; do not infer global access from role/device type |
| 8. Branch reassignment | Separately authorized/audited; pending work remains recoverable and unrelabeled |

## What is actually verified versus unfinished

- Batch 1 source commit `608398c6` retains verified session terminal identity,
  validates native activation adoption and protects sealed configuration. Hosted
  and installed-Main isolated regressions pass, including legitimate cashier
  grants. This does not close alternate direct database/RPC authority or establish
  native-versus-web attestation; TASK_TRACKER.md records the residual scope.
- Approved tooltip and inventory-card UI refinements use existing data/formulas
  and permissions. The DEC-25 full candidate passed 544 files / 3,354 tests and
  desktop/phone/tablet inventory card containment checks. DEC-26's live zero cards
  and table controls passed separate render, allowed/denied visibility, desktop
  heading and phone expanded-dialog checks. Adaptive non-chart loops passed actual
  narrow-Windows/390px phone wraparound and 2200px fitting-row checks; graph
  behavior is unchanged. There is no global UI/device verification guarantee.
- The 2026-10-27 read-only audit inventoried 123 route source files, including 20
  API and 45 settings files, and a 70-table synchronization registry. Existing
  tests were inspected; no new automated suite or formal Codex Security scan ran
  as part of that read-only pass. Browser observations do not certify native apps.
- The session's prior checkpoint reported 531 test files / 3,266 tests, then focused
  compatibility (29) and reconciliation/guard (27) checks, TypeScript, lint and web
  build. Those are historical execution reports, not a fresh full run on all later
  or untracked files. Re-run appropriate checks after approved implementation.
- Source-confirmed gaps include lost terminal proof, untrusted native activation
  adoption, account/management scope mismatch, legacy booking RPC scope, settings
  patch ownership, permission refresh/normalization, blocked management report IPC,
  and non-atomic booking/payment/deposit accounting. None is fixed by Batch 0.
- Read-only database catalog inspection confirmed deployed `booking_balance_state`,
  `booking_collect` and `store_visible` definitions. Authenticated execution is
  permitted for legacy booking routines; anonymous execution is denied. No
  unauthorized call or business mutation was executed to demonstrate impact.
- The prior session recorded owner approval, successful application and invariant
  checks for four migrations listed in TASK_TRACKER.md. Batch 0 does not reapply
  them or independently recheck live migration history.
- The empty atomic-booking migration and shared-ID helper are unfinished,
  untracked drafts, not a completed/applied upgrade. Preserve them and other
  local scratch work; never stage them with documentation by accident.

## Existing technical references (reuse, do not duplicate)

- [Technical master](POS-MASTER-DOCUMENTATION.md): detailed legacy architecture;
  flagged historical portions require revision-specific interpretation.
- [Platform capabilities](PLATFORM-PARITY.md),
  [management activation](management-device-onboarding.md),
  [management replication](management-terminal-replication.md).
- [Sync architecture](audit/system-sync-architecture.md),
  [table scopes](audit/table-scope-classification.md),
  [generated sync coverage](audit/sync-coverage.md),
  [conflict rules](audit/conflict-rules.md). Generated reports retain their generators.
- [Database upgrades](database-upgrade.md),
  [existing Postgres deployment precautions](../supabase/sql/README.md).
- [Native approval credentials](native-approval-tokens.md),
  [token notifications](soft-token-approval-notifications.md),
  [settings behavior](settings-health-fixes.md).
- [Feature inventory](audit/feature-inventory.md),
  [historical functionality audit](audit/feature-functionality-audit-2026-10-03.md),
  [verification history](audit/verification-matrix.md),
  [go-live checklist](audit/go-live-checklist.md),
  [browser performance evidence](audit/signed-in-performance-2026-10-24.md).
- [Beta releases](beta-releases.md), [iOS OTA](ios-ota.md),
  [stable revisions](stable-release-revisions.md),
  [PR template](../.github/PULL_REQUEST_TEMPLATE.md).

## 30 October 2026 — login and loading recovery
The owner approved fixing administrator/password and cashier/PIN login, Auth resume, Realtime refresh duplication and confirmed service-delay classification. Preserve real credential lockouts, branch/device binding and user permissions; unavailable verification must not consume incorrect-credential attempts or grant a new session. Scope downstream timeouts to login callers, preserving shared checkout defaults.
The owner explicitly declined the proposed Membership shared-loader correction and repeated: ignore Membership for now. Membership workflows AND bootstrap dependencies remain unchanged, even though the audit recorded that a denied Membership read can block the shared snapshot. Do not silently mark that dependency resolved or remove its reads in a later session.
Catalogue read-policy optimization remains approved for pos qhrufhtbeguxydenzfey but last confirmed helper is absent. Supabase migration-history initialization repeatedly times out. Product/barcode UUID pagination and typed PIN verifier are applied. Recheck exact catalog state before any retry; do not infer application from a source commit or successful isolated test.

## Loading readiness boundary — 30 October 2026
A verified location directory or SQL connection is not a complete POS business snapshot. Initial data readiness must match the current authenticated person, backend mode and branch. Retire superseded reads synchronously on retry/branch changes and recheck deferred state updates; expose recovery on stalled/failed startup rather than showing default/empty data as healthy. Preserve prior matching confirmed data during failed refreshes. These guards do not change Membership dependencies or authorize skipping permission checks.
Live catalogue policy fallback was submitted through SQL editor query 36802140-949a-47b1-bb5a-cccd02f34360, but execution/readback remained unconfirmed. Supersedes earlier "definitely not applied" as a statement of current state: last successful catalog showed absence, later attempt has unknown outcome. Check catalog/pending execution before any retry; do not infer migration history or successful deployment. Database CPU/memory/IO warnings remain a separate operational blocker.

## CPU incident checkpoint — 30 October 2026
The previously approved catalogue read policy is now verified active (18:26/18:27 Brunei), superseding the earlier unknown deployment state. No history entry is inferred. New20261030102943 branch-sync migration is prepared/tested only and requires separate live approval. CPU summary values lack current ten-minute samples; schema-cache PGRST002/57014 is the confirmed direct Data API outage, with expensive PostgREST14.5 timezone metadata work observed. Preserve distinctions between host pressure, SQL query cost, cached metrics and authorization. Owner approved one project restart; browser control was lost before submission, agent has not performed it. Do not duplicate if owner restarts. Membership remains unchanged.

## Owner restart and Authentication-first scope — 30 October 2026
The owner performed the approved restart; PostgreSQL start is verified at 18:48:29 Asia/Brunei. Do not issue another restart under the consumed approval. Authentication is now the first live incident priority; preserve other pending tasks. Auth role/login/expiry, required grants, listening addresses and sampled connection capacity are valid. Internal connection/lookup timeouts persist; do not treat them as wrong passwords, PINs or missing staff permissions. No credential/grant/TLS change was made. Prepared sync migration remains unapplied and Membership dependencies remain unchanged. Current recovery code is independently reviewed and regression-tested, but hosted Auth/Data API recovery and fresh CPU usage are not certified.

## Latest source and deployment boundary — 31 October 2026

PR342's pushed source ec4e3e7e includes reviewed initial report/scoped-settings
readiness and restored-session landing corrections in8b840192. Confirm current
person/session generation, mode and branch/cluster/terminal before declaring
settings ready. Keep confirmed same-scope data during background failure; bounded
loading status does not cancel/restart the underlying read. Retry must preserve a
real trailing change hint and avoid overlapping composite reads. No permission,
formula, operator configuration or Membership dependency changed.

Shift proof v1 was applied with exact approval, but its first fixture omitted the
actual revision trigger. Local and cloud revision clocks are independent: valid
local CLOSEDv8/cloud OPENv4 can become cloud CLOSEDv5. Source correction v2 binds
requested_row_version separately while preserving exact closing facts and branch
checks. All seven actual triggers are now tested. The owner's31October approval
was followed by live v2 application (history20261030234442); see the exact-target
application evidence above and shift-closure-sync-review.md. Do not silently
alter the global revision trigger/business rows. A stale high-version
OPEN upload can also reopen a closed shift on the pre-change baseline; this is a
separate unresolved lifecycle defect requiring a controlled correction plan.

The reconnect retained-content/portal experiment and notification acknowledgement
correction are in newly approved preparation, not the last pushed HEAD. Actual
earlier browser tests found portal escape/modal-lock problems; isolated notification
tests found a foreign-branch event-ID acknowledgement mutation. Preserve both
findings until independently verified corrections are committed. The notification
approval permits preparation/isolated tests only, not live application.
Do not apply the old personal-clear migration unchanged or claim either fixed.
Keep beta merge, live migration, website deployment and installer/OTA publication
as separate states. Membership remains ON HOLD.

## Public PIN response boundary — 31 October 2026

AUTH-12 was approved by the owner's “Check and fix” instruction. Keep typed PIN
diagnostics private through server accounting, then use the shared public response
serializer in every exposed login transport. Unknown/wrong, inactive, unavailable
verifier, lock and private input-validation results must not disclose account
state through body or status, including repeated attempts and aliases. Validate
blank public usernames before lock checks. Public failures use neutral guidance;
actual server lock enforcement/counters, successful permissions and device/branch
checks remain unchanged. Preserve independent offline messages and safe fallback
only for existing infrastructure failures. Never turn a missing verifier into a
wrong-PIN attempt or grant a stale local session after authoritative denial.

## Terminal restore and repair navigation — 31 October2026

TERM-13 confirms native login setup links must reach the existing protected
recovery flow, not authenticated PC token administration. Search/section hints
are presentation only; retain EmergencyPinGate and web's no-native-registration
redirect. Await shared profile hydration before deciding registration/connection
is missing, preserve unreadable stored activation for retry, and subscribe to
configuration changes with stale-result fences. An unavailable staff roster does
not invalidate proven registration. Never overwrite/clear unreadable sealed or
legacy activation, fall through from a failed sealed read to editable plaintext,
or broaden a user's branch scope to make setup/login succeed. Saved registration
details are local evidence, not proof of online authorization. Default bundled
Android/iOS/Electron sources are tested; actual installed-device acceptance and
the optional remote-hosted Android artifact remain distinct verification limits.
