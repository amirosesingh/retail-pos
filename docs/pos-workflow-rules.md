# POS workflow rules

Approved terminal, staff permission and Settings requirements, with page-specific
operational requirements requested by the owner on 13 November 2026. These rules
are mandatory through [AGENTS.md](../AGENTS.md). They describe required behavior;
they do not certify that the current application implements or passes every rule.
The [task tracker](TASK_TRACKER.md) records implementation and verification status.

Preserve the existing approved business decisions in
[project memory](PROJECT_MEMORY.md), the
[two-way sync plan](database/pos-sync-implementation-plan.md) and the exact-target
database/production/release approval boundaries. This rulebook introduces no new
financial formula, branch entitlement or automatic migration. Resolve an actual
policy conflict with the owner rather than silently broadening authority.

## Terminal login and staff permissions

| ID | Required behavior |
| --- | --- |
| T1 | Restore saved database connection, terminal registration and device binding before choosing setup, activation or login. Preserve unreadable saved values and show recovery. Missing copies alone do not prove a fresh device. |
| T2 | Registration belongs to the device; login belongs to the person. Logout, lock, restart and update preserve registration, connection settings and pending business work. |
| T3 | Windows automatically opens the enabled, saved SQL Server connection during startup. Verify the target, required schema and scoped readiness before local business operations. A connected socket alone is insufficient. |
| T4 | When local SQL is unavailable, use the configured online database through the approved fallback. Preserve pending/uncertain local work and its identity. A business or permission denial is not a reason to change database. |
| T5 | First activation has no previous-local-SQL prerequisite. Codes and phone pairing verify project, device family, physical proof and canonical binding. Report success only after native persistence and strict read-back. |
| T6 | Replacement registration preserves previous connection, identity and pending-work evidence. If old local work cannot be verified, retain the sealed recovery hold and prevent that storage from reopening or syncing under the replacement identity until recovery is verified. |
| T7 | Operations terminals remain bound to their registered branch for every role. Preserve the approved read-only positive-stock availability exception for other active locations in the same cluster. It grants no branch switch or other-branch writes. |
| T8 | Management device admission, account branch scope, role and action permission are separate. Management may select only authorized branches/views; NULL or device type does not establish unrestricted access. |
| T9 | Login verifies credentials, active/locked status, device eligibility and authorized branch through the authoritative path. Distinguish network/service failure from incorrect credentials and access denial. |
| T10 | Automatically synchronize all eligible PIN users, account status, authorized branch scope, effective permissions and protected sign-in verification data to the terminal's connected local SQL when the online source is reachable. Include users who have never logged in on that PC. Provision through verified registered-device sync authority, independently of which person is signed in or whether a person session is open. After sign-in, every granted action within the person's authority works without another approval PIN. |
| T11 | Emergency Access grants only its native-verified, allowlisted repair functions. It grants no cashier session, financial approval or cross-branch authority. |
| T12 | A verified permission save and refresh makes the grant usable without separate user acceptance, reinstall or reactivation. Never display an unverified write as a successful grant. |
| T13 | Roles supply starting presets. Ordinary account edits preserve individual grants/denials. Before an intentional role change, explain which permissions the new preset changes. Preserve existing administrator policy and terminal/branch restrictions. |
| T14 | Page visibility, page entry and action rights are distinct. Opening a page grants no implicit edit, delete, export or approval authority. |
| T15 | Display permission dependencies. If an action needs page-entry access or another prerequisite, explain the missing requirement and let an authorized editor choose the necessary grant. Do not silently grant broader rights or save an unusable combination as fully effective. |
| T16 | Apply the same permission meaning in menus, search, direct URLs, tabs, popups, server requests, RPCs, Electron IPC, SQL/offline writers and sync. Hiding a control is insufficient authorization. |
| T17 | Delegatable grants work without an unrelated role-only blocker. In particular, preserve delegated staff management through `can_manage_staff`; separately restricted administrator-only functions keep their own checks. |
| T18 | General Settings access grants no implicit staff management, terminal management, database administration or approval authority. A specific grant needs a reachable permitted navigation path with its prerequisites shown. |
| T19 | Refresh online permission/account changes promptly through the existing refresh mechanism on sign-in, restore and authoritative changes. Reject stale responses after logout/user switch. Offline devices use only their verified synchronized authorization within approved validity rules. |
| T20 | Separate approval applies to actions beyond the person's configured direct authority, only through a supported approval workflow. Determine that authority using effective grants and the approved action policy/limits; do not request another approval PIN for an action already within it. Verify eligible approver, action/request binding, branch, amount limits, credential purpose/validity and replay rules. Approval authorizes that operation only. |
| T21 | Audit account/access changes with actor, affected user, scope, previous/new values and outcome. Never log passwords, PINs, private keys or tokens. |
| T22 | With no actual pending work, close normally even from login. With pending work, attempt sync and preserve durable transactions. Finish renderer saves and accepted local writes before exit; block where active writes or storage cannot finish safely. Committed pending cloud work must remain recoverable, with truthful status and no false acceptance. |
| T23 | Download updates independently of sign-in and sync completion. Install through the safe-update barrier; preserve registration, credentials, pending transactions, receipts and checkpoints. Resume eligible sync after restart. |
| T24 | Updates preserve device data. An explicit uninstall-cleanup choice explains what it removes and protects unresolved transactions through the approved recovery/backup process. Never treat reinstall or cache deletion as an ordinary repair of unreadable registration. |

T10 means the device must already hold verified synchronized authorization; the
person need not have previously signed in there. Download only the terminal's
authorized staff projection, including selected approvers where applicable under
existing policy, not an unrestricted company-wide credential directory. Store
only the approved protected verifiers, never readable PINs or passwords. Keep
sign-in, offline sign-in and approval credentials separate; an approval PIN does
not automatically become a sign-in credential. SQL connectivity alone cannot
download a new account while its online authority is unreachable.

Known inactive/locked/revoked accounts, explicit wrong credentials and actual
permission denials must not fall back to offline admission. An offline PC cannot
discover a newer remote revocation until reconnect: follow the existing validity
and freshness limits without promising immediate offline revocation. A missing
verifier reports synchronization/provisioning required, not an incorrect PIN.
Synchronization never signs a person in or grants all actions merely because
their account has a PIN. Do not require a manager's prior sign-in as part of T10.

### Staff tabs and dialogs

The home is `/staff`, with `tab=accounts`, `tab=roles`, `tab=policies` and
`tab=approvals`. Deep links and embedded Settings panels enforce identical rights.

| Area | Responsibility |
| --- | --- |
| People and permissions | Authorized staff managers create/edit/activate/deactivate accounts. Preserve historical user attribution and the approved scope of delegated administration. |
| Edit account | Identity, role, account status, branch/account scope and Management PC/mobile admission. Keep existing credentials unless explicitly replaced. Management admission switches stay at the bottom of this form. |
| Edit permissions | Page, action, Settings visibility and protected-column controls. Show effective grants, explicit denials and dependencies; save and read back the authoritative result. |
| Role defaults | Maintain reusable presets. Distinguish editing a preset from applying it to existing accounts; do not silently overwrite their individual choices. |
| Approver rules | Configure eligible requesters/approvers, branch scope and financial authority. These are separate from page grants, account admission and operational policies. |
| Operational policies | Configure permitted business limits and workflow requirements without silently granting user permissions. Keep a policies-only entry for authorized operators without staff-management access. |
| Sign-in/password/approval credential dialogs | Preserve credential purposes and current administrator-only credential-management restrictions unless separately changed by the owner. Never reveal an existing secret. Account edits must not reset unrelated credentials. |
| Idle/session limits | Preserve branch/global server limits and per-user limits. Explain when a saved limit takes effect; personal limits may be shorter, not longer than the applicable maximum. |

## Settings rules

| ID | Required behavior |
| --- | --- |
| S1 | Give each setting one authoritative management home. Shortcuts use the same saved values, scope and authorization, not a competing editor. |
| S2 | Show the actual editing scope: personal, terminal, branch, cluster or global according to approved section ownership. Edit only authorized scopes. Do not invent additional inheritance tiers. |
| S3 | Show inherited values, their source and applicable locks. Explain whether an override is allowed. Preserve Global → Cluster → Branch or Global → Cluster → Terminal as applicable; private preferences use their separate path. |
| S4 | Use explicit Save/Cancel for edits. Previews do not persist. Protect unsaved changes on navigation and distinguish intentionally immediate operational actions. |
| S5 | Show Saved only after authoritative acceptance and appropriate read-back. Supported offline saves show Saved locally—pending synchronization, with their verified baseline protected. |
| S6 | Failed loads do not become editable defaults. Preserve confirmed values and unsaved edits; offer retry and an accurate error. Preserve supported verified offline editing. |
| S7 | Detect concurrent baseline changes. Offer an authorized comparison/reload decision instead of silently overwriting another user's save. |
| S8 | Refresh affected consumers and scope-specific caches after confirmed changes. Synchronize shared settings through the existing coordinator and declared ownership; do not start another engine. |
| S9 | Settings changes preserve earlier bills, tenders, stock movements, accepted bookings and original shift closings. Historical business facts are not recalculated automatically. |
| S10 | Mask secrets; use the existing OS vault/Keystore and canonical configuration resolver. Exclude secrets from logs, exports, receipts and published artifacts. |
| S11 | Page opening performs no destructive maintenance. Resets, restores, registration replacement and migrations have their own authorized workflows and approval boundaries. |
| S12 | Apply destination permissions to every tab, dialog, legacy URL and query-string selection. Redirects and embedded panels do not bypass checks. |
| S13 | Keep permission meanings consistent across platforms. Expose hardware/storage/update controls only on platforms that support them. |
| S14 | Membership remains ON HOLD. These rules do not enable, redesign or modify it. |

### Settings page and subpage responsibilities

| Page and route | Required workflow |
| --- | --- |
| Settings home `/settings` | Show/search permitted destinations with their prerequisites. Specific authorized pages must remain reachable without unrelated privilege grants. |
| Appearance `/settings/display` | Keep personal preferences private. Theme/brightness/scale/density change presentation only; preserve any separately scoped display profiles. |
| Software updates `/settings/updates` | Native-only page shows true installed/available versions. Update availability and safe downloads remain accessible to signed-out/cashier users under the global update rules. |
| Hardware and drawer `/settings/hardware` | Save hardware for the selected terminal scope. Drawer opening/testing uses its applicable operational authorization. |
| Windows activation `/settings/terminals` | Terminal managers issue/revoke codes and manage devices under T1–T11; verify native persistence and safe branch assignment. |
| Mobile terminals `/settings/mobile-terminals` | Apply equivalent device proof, registration and scope checks on supported phones/tablets; device admission is separate from staff rights. |
| Active sessions `/settings/sessions` | Show only authorized session details. Verify and audit remote sign-out without erasing device setup or pending work. |
| Receipt printer `/settings/printer` | Save terminal printer/device/encoding/margin/drawer configuration. Test printing creates no sale, payment or stock movement. |
| Receipt elements `/settings/elements` | Preserve required identity, transaction, tax and payment information while configuring permitted sections. |
| Receipt typography `/settings/type` | Fonts/sizes/spacing must not alter amounts, identifiers or business facts. Preview supported paper widths. |
| Extra lines `/settings/lines` | Save scoped policy/promotional text; preview it and preserve required receipt content. |
| Sales receipt designer `/settings/receipt-designer` | Preview realistic layouts. Preserve readable references/totals/tax/tenders, scoped branding and supported custom sections. |
| Receipt QR `/settings/qr` | Validate payload and destination. Include no credentials or unrelated private data. |
| Locations and warehouses `/stores` | Require location-management authority. Preserve ownership/hierarchy/history; reassignment follows its separate controlled process. |
| Identity and logo `/settings/identity` | Save scoped company identity and branding without rewriting accepted transaction facts. |
| Groups and clusters `/settings/groups` | Require location-management authority. Preserve catalogue, branch and private-data boundaries; a grouping edit grants no data access. |
| Tax and pricing `/settings/tax` | Validate rates and inclusive/exclusive behavior. Preserve approved exact monetary rules and historical values. |
| Operational policies `/staff?tab=policies` and `/settings/rules` | Enforce saved shift/cash/discount/refund/stock/security limits in authoritative online/native/offline paths. Explain missing prerequisites; never enable a staged feature merely by displaying its switch. |
| SKU numbering `/settings/sku` | Preserve global uniqueness/allocation and manual-entry policy. Preview new formats; never renumber existing products automatically. |
| Bill numbering `/settings/numbering` | Preserve branch/terminal scopes, concurrent/offline uniqueness and stable confirmed bill identities. |
| Document numbering `/settings/stock-numbering` | Preserve unique stock/receiving references and configurable sponsorship numbering. Never renumber saved documents. |
| Categories and units `/settings/catalog` | Validate references and preserve existing product/quantity meanings. Do not silently remove in-use categories/units. |
| Region and time `/settings/region` | Saved business timezone/currency govern business dates, filters, receipts and reports. Viewer computer timezone must not silently change business results. |
| Payment methods/vouchers `/settings/payment-methods` | Validate available tenders/conditions. Keep disabled-method history and exact card/split-tender accounting; Membership changes remain on hold. |
| Bank transfer details `/settings/payment` | Validate recipient account/QR details and keep the authorized customer display and print instructions consistent. |
| Payment accounts `/settings/accounts` | Keep stable account identities, provider details and branch availability. Deactivation/removal preserves saved settlement/payment references. |
| WhatsApp/integrations `/settings/whatsapp` | Protect credentials, restrict recipients and report real delivery. Sending/retrying a receipt does not repeat checkout or payment. |
| Booking policies `/settings/booking-rules` | Apply saved deposit/cancellation/turnaround/collection rules consistently; preserve accepted contractual/payment evidence. |
| Services/fees `/settings/services` | Validate service defaults and fees. New defaults do not silently reprice accepted jobs. |
| Booking receipts/tags `/settings/booking-slip` | Preserve reference, deposit/balance, terms, signatures and handover information. Separate customer slips/racket tags are intentional; printing is not payment or collection. |
| Database connection `/settings/database` | Use existing fields and the canonical resolver. Test the exact target, protect credentials and preserve working values if a replacement fails. Database-management permission is separate from general Settings. |
| Local SQL wizard/operations inside Database connection | Automatically start the saved enabled connection. Distinguish socket connection, schema/bootstrap readiness, trading readiness and recovery holds. Protect pending work before maintenance; no implicit schema approval. |
| Sync status/recovery inside supported database/status surfaces | Show upload/download progress, pending/failed work, source freshness and holds truthfully. Use the existing coordinator; never clear queues/reset identity or falsely acknowledge work to make status green. |
| Notifications including shift alerts `/settings/notifications` | Validate event/condition/recipient/user/role/branch/channel rules and delivery history. Preserve current administrator-only rule management unless separately approved for delegation. |
| Branch telemetry `/settings/branch-telemetry` | Show authorized terminal health and freshness. Remote data-sync requests grant no arbitrary-command execution, identity reset or schema changes. |
| System status `/settings/system?tab=system` | Show actual connection/storage/readiness, domains and diagnostic outcomes. Viewing status does not grant credential editing, repair authority or Membership changes. |
| Troubleshooting/recovery within System status | Explain the exact operation and protect recoverable data. Every mutation uses its own authorization; metadata inspection is not proof a business operation works. |
| Logic health `/settings/system?tab=logic-health` | Distinguish findings from verified defects. Acknowledge/hide does not certify repair. Do not test business mutations by running dummy production operations. |
| Security alerts `/settings/system?tab=security-alerts` | Protect sensitive details, retain finding/audit history and separate acknowledgement from verified resolution. Viewing grants no repair authority. |
| Inheritance `/settings/system?tab=inheritance` | Show effective value, source, lock and override accurately. Removing an override restores the verified inherited value. |
| Staff `/staff` | Follow the staff tab/dialog responsibilities and T10–T21, including explicit grants, credential-purpose separation and delegation. |

Compatibility routes retain destination checks and are not extra settings homes:
`/settings/access`, `/settings/visibility`, `/settings/admin-terminals`,
`/settings/workspace`, `/settings/database-explorer`, `/settings/data-sync`,
`/settings/sync`, `/settings/diagnostics`, `/settings/inheritance`,
`/settings/logic-health`, `/settings/security-alerts`, `/settings/shift-alerts`.
Retain the supported `/settings/rules` policies-only route rather than forcing
operators to receive staff-management rights. Audit actual redirect targets and
tab permission checks when changing them; route existence alone proves no match.

## Cluster and branch rules

A cluster groups catalogue/settings context. A branch/location owns its business
transactions and stock quantities. Device registration, account-authorized scope,
action permissions, catalogue visibility, physical replica contents and selected
report filters are separate. Showing one cluster or downloading its eligible
products never grants every user access to every branch's records.

These rules apply while loading initial data, working online or locally, retrying,
synchronizing and recovering history. They extend the existing owner decisions;
they do not authorize a catalogue merge, data repair, new warehouse ACL, broader
Management assignment or automatic rewrite of existing records.

### Cluster rules

| ID | Required behavior |
| --- | --- |
| C1 | Resolve cluster membership from the verified location directory and stable cluster IDs, not labels or a renderer-supplied group name. Missing/ambiguous membership does not mean every cluster; preserve the explicitly supported legacy unclustered behavior. |
| C2 | Branches in the same configured cluster share eligible catalogue products. Different known clusters remain separate even if Private catalogue is off. Private catalogue does not create separate catalogues between branches of the same cluster. |
| C3 | Preserve global SKU allocation/uniqueness and stable product IDs across clusters. A global identifier is not permission to display every product, merge catalogues, combine quantities or change established ownership. |
| C4 | Cross-cluster catalogue availability needs approved membership/provenance or a verified posted purchase receipt/completed incoming-transfer receipt for a positive received quantity. Persist the resulting destination membership under C17/C18. A request, draft, unposted document or pre-created zero stock bucket is not receipt evidence. Expose only eligible product facts, not the source cluster's unrelated data. |
| C5 | Same-cluster product sharing does not pool stock. Preserve quantities and movement history per branch/location. Catalogue/detail views do not mutate stock or create implicit opening balances. |
| C6 | A normal terminal may use the approved read-only Other Sources workflow for positive stock at active, authorized locations in its own cluster. Exclude zero/negative quantities and other clusters, including when a transferred product is visible locally. This grants no operating-branch switch or remote stock edit. |
| C7 | Preserve ordinary authorized intra-cluster transfer rules; do not invent blanket additional approval. Inter-cluster moves use configured selected-approver rules, eligible endpoints and the existing dispatch/receipt/verification workflow. Neither cluster membership nor approval alone posts stock. |
| C8 | Shared settings inherit only through approved section ownership: Global → Cluster → Branch or Global → Cluster → Terminal. Show effective source, locks and overrides. Personal/private preferences retain their separate path. A cluster override must not silently edit unrelated clusters or global defaults. |
| C9 | Apply catalogue scope consistently to search, scan, product detail, import/export, pricing/cost views, checkout, booking and stock workflows. Keep each action's grant and protected-column rights independent. Do not guess ownership of ambiguous legacy products to make them appear. |
| C10 | Keep Dashboard on the selected registered/authorized branch. All Shops cards/charts follow the explicit selected cluster; All clusters includes every authorized shop, including zero-data shops. Business Board uses its authorized company directory. A filter narrows existing authority and never creates more. |
| C11 | Cluster/report totals include only authorized contributing branches and the requested period. Preserve existing financial definitions, currency/time semantics and receipt identities; never double-count transfers, deposits or the same sale. Protect costs and expose incomplete coverage. Consolidation does not merge underlying histories. |
| C12 | Catalogue/settings inheritance does not make branch sales, payments, shifts, staff credentials or private data cluster-wide. Each sync relation keeps its declared direction, field ownership and branch/cluster/global/private projection. Replica contents confer no person-session access. |
| C13 | Changing a branch's cluster requires authorized location management, validation, save/read-back and an audit. Re-evaluate catalogue, settings, caches and eligible sync scope without relabeling historical transactions or pending work. Any ownership migration or catalogue merge is separate reviewed work. |
| C14 | Treat Private stock as its current saved preference, not proof of an independent enforced privacy boundary. Preserve terminal/account stock guards and the approved availability exception. Explain current switch effects accurately; additional privacy behavior needs explicit policy and runtime verification. |
| C15 | Every distinct new product uses one shared running SKU allocation across all branches/clusters of the same POS database. Reserve numbers atomically through the existing global allocator, never independent branch/cluster/PC counters. Distinct products must not receive the same SKU through forms, imports, manual entry, bulk actions, sync or retry. Preserve canonical product identity and use only valid reserved offline numbers. |
| C16 | For optional manual sharing of products not yet adopted in a destination catalogue, keep reference viewing separate from explicitly selected sellability. Authorized Management selects permitted product/target scopes; viewing alone grants no sale, stock mutation or source cost/financial access. Receipt-based adoption under C17/C18 establishes a normal catalogue product, not a reference-only item requiring another manual sharing grant. Ordinary product/branch/action/stock rules still apply. |
| C17 | A verified posted purchase receipt or completed incoming-transfer receipt adopts the existing canonical product/SKU into the receiving cluster's normal catalogue, retaining origin and separate branch quantities. Apply membership, receipt and stock effects through the authorized transaction/sync group. Reuse the verified product identity; do not create a second SKU merely because another cluster receives it. |
| C18 | Keep origin and adopted destination catalogue membership durably, independent of current quantity, stock-value filters or recent receipt/transfer history windows. At zero stock retain the normal product with Out of stock status; never automatically hide/unshare it, demote it to reference-only or change a global archive flag. Preserve explicit authorized product restrictions and show verified origin, catalogue membership and the current branch's quantity separately. |

The global SKU rule means:

- Allocation continues across locations: the next three individual global
  reservations could assign `1001` to a product created by branch A in cluster X,
  `1002` to branch B in X, and `1003` to branch C in Y. A branch, cluster, PC,
  reinstall or prefix/padding change never starts another independent sequence.
- Concurrent product creation reserves non-overlapping numbers atomically. Do
  not calculate a new SKU from the maximum visible in a filtered/local catalogue.
  Keep reservation/cache state bound to the correct database/project identity.
- All product-creation paths, including manual codes and spreadsheet imports,
  preserve global uniqueness for distinct products. A collision must be rejected
  or resolved through the authorized allocator before success, without disclosing
  hidden other-cluster product details or silently changing the operator's input.
- The same canonical product copied through synchronization or an authorized
  transfer keeps its product ID/SKU; it is not a different new product. Retries
  reuse the saved identity rather than creating another product or reassignment.
- Offline product creation consumes only a valid non-overlapping range already
  reserved by the authoritative service. When none is available, preserve the
  input and explain that reservation/connectivity is needed. Never guess the
  next number or issue a branch-local substitute that could collide later.
- Reserved blocks, failed/cancelled creations and offline PCs can cause gaps or
  creation-time reordering. The global sequence follows reservation order; do not
  promise gapless creation-time order across disconnected devices. Never recycle
  consumed/reserved numbers or renumber saved products merely to fill a gap.
- Preserve existing product history, numbering mode and format settings. This
  documentation authorizes no duplicate-data cleanup, counter reset, schema
  change or change to offline allocation. Catalogue visibility stays scoped.

### Purchase and transfer catalogue adoption

The owner's controlling correction is receipt-based, lasting catalogue adoption:

1. A product created in cluster X belongs to its eligible home catalogue even
   when its initial quantity is zero. Unrelated clusters gain no automatic view.
2. An authorized purchasing/receiving workflow in cluster Y identifies the same
   existing product, or a completed transfer from X delivers it to Y. A posted
   receipt of a positive quantity establishes Y's catalogue membership. A draft
   purchase order or transfer alone does not establish receipt.
3. Keep the same product ID and global SKU. Preserve verified origin/home cluster
   and record the additional receiving catalogue; do not move ownership from X
   to Y or copy source quantities, costs or financial records into Y's access.
4. Show it as a normal eligible product throughout the receiving cluster under
   the same-cluster catalogue rules. Each branch/warehouse retains its own actual
   quantity; a newly eligible branch does not inherit the receiving branch's stock.
5. When Y's quantity falls to zero, keep its catalogue record and configured
   normal selling status. Mark it Out of stock; sale availability follows the
   saved branch stock policy. Receiving more stock updates this existing record
   without another product, SKU or reference-to-selling conversion.
6. Record the lasting membership/provenance independently of a positive current
   stock map or a short read window of past receipts/transfers. Preserve it on
   sync, restart, update and snapshot recovery, including zero-stock rows. History
   cleanup, selling/returning all units or moving stock onward must not unshare it.

The receipt supplies catalogue adoption, not staff privileges or permission to
spend another branch's stock. Ordinary sale, purchase/receive, stock, approval,
branch and explicit product-status restrictions stay in force. An explicit
authorized archive/discontinue/restrict decision remains distinct and audited;
zero quantity is not that decision. A receipt found invalid by an authorized
correction requires its reviewed reconciliation, not silent deletion of records.
Do not invent missing origin/provenance for legacy rows: show unknown/review
where necessary. Any required persistence/schema work remains a separately
reviewed implementation; this documentation does not apply a migration.

| Stage for the same SKU `1001` | Branch A in cluster X | Branch B in cluster Y | Catalogue result |
| --- | --- | --- | --- |
| Created in X | 10 units | No receipt/adoption | Normal in X; no automatic Y visibility. |
| B posts an independent purchase receipt for 3 | Still 10 units | 3 units | Normal in both catalogues, same product/SKU, separate quantities. |
| Alternatively, A dispatches 3 to B | 7 units, 3 in transit | Awaiting receipt | Dispatch alone is not completed receiving. |
| B completes that transfer receipt | 7 units | 3 units | B/Y adopts the normal product with retained receipt evidence. |
| B sells/returns/transfers its last units | A remains unchanged by B's local sale | 0 units | Y keeps its normal catalogue record, Out of stock, not reference-only. |
| B later receives more | Separate A balance | New local balance | Reuse the retained product/SKU; no re-registration or manual re-sharing. |

The purchase and transfer rows illustrate alternative receiving paths, not two
receipts for the same goods. Show product details such as Origin/home cluster:
X, Catalogue membership: X and Y, Current branch quantity: 0, Stock status: Out
of stock. Quantity is never combined into the origin label. Active/Archive stock
filters may narrow a view, but they do not remove membership; authorized catalogue
and purchasing searches must support finding these zero-stock records explicitly.

### Optional manual reference and selling controls

These controls apply to additional unadopted cross-cluster browsing/publication.
They are not prerequisites for products already received into the normal
destination catalogue under C17/C18:

| Reference visibility at the selected destination | Selected product sellable there | Required result |
| --- | --- | --- |
| Off | Off | Hide other-cluster items without home/adopted membership or another approved publication. This does not hide a legitimate adopted destination product, actual local stock or historical/pending records. |
| On | Off | Permit an unadopted item's approved detail projection for reference, without a new sale right. An independently authorized posted purchase/transfer receipt can subsequently adopt it as a normal catalogue product. |
| On | On | Permit the selected product in the destination selling catalogue, subject to the signed-in person's normal sale rights, branch binding, product status and saved destination stock/negative-stock policy. |
| Off | On | Invalid configuration. Explain that sellability requires permitted visibility and require a deliberate correction; do not silently grant broader cross-cluster access. |

For additional manual publication, select the product and explicit eligible
destination clusters/branches through one authorized management home. A
reference-view grant does not grant editing,
global product administration, source quantities, costs, margins, staff, tenders
or sales history. The sellability selection does not grant the staff member a
sale permission or allow them to use another branch's stock. Moving goods still
uses the authorized transfer/receiving workflow. The same canonical product
keeps its global SKU across all selected destinations; do not copy it into a
different product merely to expose it in another cluster.

Validate saves and conflicts and refresh the appropriate catalogue/selling
projections, caches and sync scope. Removing a manual target does not revoke
receipt-established normal catalogue membership. Explicitly restricting future
selling preserves actual stock, accepted transactions, receipts and pending
operation evidence; resolve affected in-progress work through existing policies.
Apply the effective selection on search, item detail, scan, cart, server/native
writers and downloads. Never implement this solely as a list filter. Retain the
approved offline freshness and supported trading rules; do not claim immediate
revocation on disconnected devices.

These define required behavior, not a completed feature or an existing manual
screen. The inspected model exposes catalogue membership and posted transfers;
complete purchase-based persistence, retention at zero and manual-control
enforcement have not been verified. Implementation must preserve existing valid
received products and trading, using lasting provenance rather than a transient
stock test. This documentation changes no stored setting, permission or schema.

### Branch rules

| ID | Required behavior |
| --- | --- |
| B1 | Derive an Operations terminal's branch from verified saved registration/session context. Every signed-in role, including administrator, remains bound to that branch. Missing/forged request fields must not remove the binding. |
| B2 | An authorized Management device or web account may select/consolidate only its verified authorized branches. Device admission, account assignment, role, action and selected view remain separate. NULL assignment or Management type alone never establishes all-branch access. |
| B3 | Read/write branch facts within their declared scope on server APIs/RPCs, Electron IPC, SQL/offline readers/writers and synchronization. Resolve location/parent relationships before access; a same-cluster label, shared SQL database or hidden selector is insufficient authorization. |
| B4 | Synchronize the eligible branch records needed by authorized tills, including records from other tills in that branch, not only records created by the current user/PC. Preserve table-specific terminal/private restrictions, receipt access and shift-sharing policy; this is not permission for every person to view every downloaded row. |
| B5 | Sales, items, payments, refunds, bookings, stock movements and shifts preserve original branch, location, terminal, user, operation and business-time attribution. Bind parent/child scopes and commit protected groups atomically. Never change ownership merely to pass a retry or recovery check. |
| B6 | Stock is held and valued at the correct location using its actual quantity and applicable cost/price definitions. Warehouse hierarchy does not create an independent ACL or grant another branch's warehouse access. Shared physical storage grants no shared business access. |
| B7 | A branch/location change to stock uses receiving, transfer or authorized count/adjustment writers. Preserve saved negative-stock policy, movement reasons and stable operation IDs. Price/product edits and report controls must not overwrite quantities. |
| B8 | Scope caches and pending UI work by connection/database, registration/session, user/permissions, branch/cluster and requested period as applicable. On an authorized view change, discard late old-context responses and hide protected old data; preserve unsaved work and load the new baseline before editing. |
| B9 | Branch reports, receipts, shift snapshots and history use the saved business timezone/date cutoffs and the requested branch. Preserve distinct sale/payment/shift periods and original accepted closings. A selected branch's incomplete replica must not appear as verified complete totals. |
| B10 | Automatically synchronize eligible branch/PIN authorization projections as in T10, including users who have never signed in on that PC. Include eligible selected approvers only within approved scope. Downloaded accounts grant no automatic session, all-branch access or extra action rights. |
| B11 | Effective branch settings follow the section's allowed inheritance/locks and scope-specific save/read-back. Authorized local changes upload and canonical changes download through declared ownership. Failed reads do not replace rules with defaults; supported pending offline changes retain their verified baseline. |
| B12 | Use verified branch/cluster/registration/database scope on initial bootstrap, push, pull, ordinary reconnect and expired-cursor recovery. Keep progress/checkpoints for the actual scope; one branch/PC's completion does not certify another. Apply complete dependency groups and their checkpoint together. |
| B13 | Existing branch sync switches hold their mapped outbound changes durably when paused. They do not delete pending work, report cloud acceptance, reset checkpoints or silently stop independent eligible download/control work. Verify actual table/direction mapping when changing the switches; labels alone prove no coverage. |
| B14 | Receive and dispatch transfers only through the existing authorized source/destination workflow. Validate both endpoints, current document state, configured allow-transfer/approval rules and quantities at the authoritative transition. Preserve in-transit, partial, variance, cancellation and receipt evidence without duplicate movements. |
| B15 | Replicate branch operational policies and enforce action/approval/financial limits at the authoritative writer, including native/offline paths. A person acts directly within their saved authority without another approval PIN; approval scope never overrides a fixed Operations branch binding. |
| B16 | Deactivating, reassigning or regrouping a branch/terminal preserves historical identity and pending/failed/conflicted transactions. Reassignment requires its separate authorized audit/recovery process. A report filter, session adoption or renderer activation copy is not reassignment. |
| B17 | Online fallback preserves the old local branch/database binding, retained work and any explicit recovery hold. Return to local operation only through verified readiness and identity. Never upload old work under a replacement registration or infer an empty queue from unavailable SQL. |
| B18 | Keep branch identity/numbering, settings, recovery state and durable work across restart/update. Show branch-specific pending/error/last-verified status accurately. Restrict repair/reset/backup/export actions to their own rights and scope; no destructive cleanup or live schema change follows from reading these rules. |

### Scope examples and acceptance requirements

For this matrix, A and B share cluster X; C belongs to cluster Y. Management's
allowed branch set is assumed to be verified separately. These are required
results, not current test passes or a promise that every arbitrary subset is
already represented by the account model.

| Context | Required catalogue/data behavior | Boundary to preserve |
| --- | --- | --- |
| Operations till A, cashier or administrator | Eligible cluster-X catalogue; branch-A transactions/stock and permitted active positive availability from B. | No branch switch, C catalogue by default, other-branch financial history or B stock edits. |
| Another till registered to A | Eligible shared branch records and its own applicable terminal settings/work. | Preserve action grants, receipt access and configured shift sharing; do not filter all branch records down to the previous PC's user. |
| Operations till A sees a product received from C | Same product/SKU becomes a normal destination catalogue member through posted receipt provenance and remains at zero stock. | Do not expose C's other catalogue/financial records or C quantities in Other Sources. |
| Authorized Management view of A and B | Select either permitted branch or the permitted consolidated view; show data coverage. | Exclude C unless independently authorized. Physical replica contents or role names cannot establish this subset. |
| Management selects cluster X in All Shops | Cards/charts/totals reflect authorized X locations; All clusters can show all authorized locations, including zero-data ones. | No access expansion and no change to Dashboard's selected branch or Business Board's independently authorized directory. |
| Cluster-X setting with a branch-A override | Display the effective source and locks; branch B retains its own effective inherited/override values. | Saving A does not overwrite X, B, Y or private owner preferences. |
| Till A disconnects/restarts with pending sale/stock work | Retain operation IDs, original ownership, dependencies and truthful sync status; retry/recover within A. | No duplicate posting, pending-data loss or reuse of B's checkpoint/snapshot. |
| A is reassigned or moved from X to Y | Follow the separately authorized assignment/recovery workflow and re-evaluate new eligible views. | Do not relabel old business history, silently release held storage or merge old/new catalogues. |

### Source observations and remaining verification

The current source inspected for this documentation has separate helpers for
[catalogue/branch switches](../src/lib/branch-policy.ts),
[All Shops selection](../src/lib/all-shops-scope.ts),
[company context](../src/lib/company-store-scope.ts),
[Dashboard scope](../src/lib/dashboard-scope.ts),
[branch Inventory classification](../src/lib/inventory-branch-view.ts) and
[settings inheritance](../src/lib/branch-settings.ts). The existing
[SKU allocator](../src/lib/sku.ts) obtains protected number ranges through the
[authorized reservation handler](../src/lib/sku.functions.ts). Source reading shows:

- Catalogue visibility uses stable group/location IDs and posted positive
  transfer evidence; zero stock-map membership alone is not transfer evidence.
  This observation does not establish durable purchase/receipt membership or its
  retention at zero across every server/native/snapshot path; C17/C18 are the
  controlling requirements to verify and implement where missing.
- Private stock is explicitly a saved preference, not an access guard. Its
  explanatory text must not be treated as implementation of a new privacy rule.
- All Shops filters an already-authorized directory; a missing company group
  narrows company context to the selected branch rather than all companies.
- Inventory Active/Archive classification is branch-relative (quantity above
  zero versus zero/below), with negative warnings. It does not rewrite a global
  product archive flag or other branches' status.
- SKU creation consumes globally reserved ranges and refuses to invent numbers
  when no usable range is available offline. Range reservation is not evidence
  of gapless ordering by the time products are created on different PCs.

These helper observations do not verify server/native enforcement, actual
replica coverage or installed-device behavior. The existing
[Management replication reference](management-terminal-replication.md) records
unresolved arbitrary-subset and native-report authority integration; do not call
them fixed or narrow the owner's required authorized scope to match a limitation.
The current branch/PIN/download path, all direct endpoints, reassignment and
short/long-offline recovery still require their own focused runtime acceptance.
Keep their status in the existing tracker; documentation does not close them.

## Common operational workflow

1. Establish verified connection/storage mode, registration where required,
   person session, terminal/account branch scope and effective action rights.
   View permission and a loaded page do not authorize a business write.
2. Load the requested authorized scope and required dependencies. Label incomplete,
   stale, offline and unavailable results. Empty/error data must not appear as a
   verified zero or remove unsaved work. Hide protected old-scope data on a scope
   or authority change; reject late responses from the previous context.
3. Validate the actual inputs, configured policy, limits and applicable direct
   authority. Ask for separate approval only when that workflow requires it.
   Preserve existing specific exceptions; a generic permission does not create one.
4. Save through the existing domain writer. Electron business effects and durable
   pending evidence commit together in SQL Server. Web/mobile use their existing
   authorized online adapters; they gain no offline billing from this rulebook.
5. Keep a stable operation identity across retries/restarts/lost responses. Verify
   the authoritative commit before reporting success. Uncertain results re-read or
   retry that operation, never create a second charge, sale or stock movement.
6. Publish scoped results and refresh affected views after commit. Receipt,
   customer display, notifications and sync failure cannot falsely undo or repeat
   an already committed transaction. Reprint/recovery uses its saved identity.
7. Retain original actors, locations, business times, monetary facts, approval and
   audit evidence through edits, synchronization and authorized corrections.
   Concurrency conflicts require the existing verified resolution process.
8. Keep dialogs, shortcuts, scans, bulk operations, imports, exports and direct
   endpoints under the same workflow. Import previews validate original values,
   identifiers, precision and ambiguous cells before approved writes.
9. Filtering/chart/sort/presentation changes use bounded scoped readers and loaded
   data where possible. They do not restart sync, reset cursors, reload the app or
   alter registration. Keep pending checkout/work safe during navigation.
10. Preserve the existing UI and supported workflows when enforcing these rules.
    Show useful loading/empty/error/denied states with keyboard/touch access and
    responsive layouts. Add no new business rule merely to make a failing check pass.

## Home selling inventory and related pages

### Home and navigation hubs

| Page and route | Required workflow |
| --- | --- |
| Dashboard `/dashboard` | Read the authorized branch/consolidated period using saved business timezone. Show true freshness/coverage. Preserve normal totals and protect cost/margin fields. |
| Live Business Board `/analytics` | Consolidate only authorized shops/clusters; deduplicate business facts and preserve chosen period. Graph/group changes reuse confirmed data and do not restart recovery. |
| All Shops `/all-shops` | Show each authorized shop separately with explicit scope/period. Operations stays branch-bound except approved stock availability. A Management view never implies write access to every displayed shop. |
| Sales hub `/sales`; Inventory hub `/inventory-hub`; Marketing hub `/marketing`; Reports hub `/reports` | Link only permitted destinations. A hub or search result grants no underlying action, protected column or export access. Keep shared entries consistent. |

Preserve the owner's presentation decision: no added sales-breakdown panels on
Home, Selling, All Shops or Reports. Explain existing totals through compact,
accessible information controls where approved; cost details still require their
own permission. Do not add extra financial/history reads for presentation alone.

### Selling checkout receipts and shifts

| Workflow and route | Required workflow |
| --- | --- |
| Selling/register `/` | Verify branch/session/shift and sale permission. Scan/search only the permitted catalogue; validate quantities, price, tax, discounts and stock under saved policies. Preserve cart and stable checkout identity through retry. |
| Line/cart actions within Selling | Enforce distinct price override, quantity reduction, removal, discount and void rights. Use applicable reasons, limits and approval rules. A direct grant within authority requires no redundant approval PIN. |
| Cash/card/transfer/wallet/split tenders within checkout | Validate exact amounts, change, selected payment account and tender conditions. Commit linked sale/items/payments/stock/shift evidence together. An uncertain provider/commit response must not trigger a second charge. |
| Refund/exchange actions reached from Selling/history | Verify original permitted sale, remaining refundable quantities/value, configured time/receipt rules and direct/approval authority. Link the refund/exchange, tenders and stock effects once; preserve original sale evidence and prevent duplicate/concurrent refunds. |
| Hold tickets `/holds` | Persist authorized holds and revisions; distinguish hold/reopen/discard rights. Preserve ownership and cart lineage across devices/restart. Complete only the verified matching hold after accepted checkout, without a second sale. |
| Bill search/history `/receipts` | Apply branch/date/user permissions to search, details, reprint and supported refund links. Render valid numeric/text decimal tenders safely while preserving amounts; unreadable values show an honest unavailable state. Printing never repeats business effects. |
| Shift management `/shifts` | Keep open/close/manage-other-shift/cash-view/count/variance rights separate. Respect saved same-branch shift-sharing policy and terminal identity. Capture original closing and later authorized correction as separate auditable actions. |
| Cash drawer/pay-in/pay-out/no-sale dialogs | Verify shift, amount/reason, balance visibility and action rights. Save cash movements once; a drawer pulse/test is not a payment. Per-bill print-off must not suppress a required legitimate drawer pulse. |
| Shift closing/count/recount/history | Enforce saved held-bill/count/blind-count/variance policies. Validate the financial inputs known to the terminal at that action's saved point. Preserve approved exact-decimal/versioned rounding and immutable original closings; later uploads do not rewrite them. Show incomplete coverage honestly. |
| Customer display `/display` | Display only the intended current ticket, payment instructions and confirmed result. Never expose staff credentials/costs/admin data or permit business writes through the display. Reconnect must not show another branch's stale cart. |

### Inventory purchasing requests and transfers

| Workflow and route | Required workflow |
| --- | --- |
| Inventory catalogue `/inventory` | Respect cluster catalogue and branch stock scope. Separate view/add/edit-price/edit-details/barcode/archive/restore/publish/bulk/merge/cost rights. Stock quantities in catalogue/detail remain view-only. |
| Product dialogs/import/bulk edits within Inventory | Validate identifiers, units, references, price/cost precision and permitted ownership before save. Preserve text leading zeros and original import row/column errors. Ambiguous numeric cells require correction; no silent coercion, renumbering or implicit starting stock. Preserve management-owned e-commerce fields. |
| Other-location availability within Inventory | Show positive available stock only from eligible active same-cluster locations under the approved exception. No operating-branch switch, other-branch stock edit or cross-cluster catalogue exposure follows. |
| Stock operations `/stock-operations` | Authorized physical counts/adjustments record scope, quantities, reasons, actor and stable movement references. Preview import/variance before posting. Follow saved negative-stock policy; commit each protected adjustment group and evidence once. |
| Purchasing `/purchasing` | Keep purchase order/invoice, supplier, line quantity/cost and receiving identities linked. Drafts do not change stock. Accepted receiving owns stock effects; later price/detail edits must not repeat or replace quantities. |
| Goods receiving `/receiving`, `/receiving/$id` | Verify authorized destination/document state and configured blind-count rules. Preserve counted/expected differences and existing approval requirements. Post linked receipt/movements once, with retry-safe differences for supported corrections. |
| Suppliers `/suppliers` | Maintain authorized supplier identities/contacts while preserving document references. Viewing/editing a supplier grants no receiving/posting authority or unrelated private-data access. |
| Stock requests `/requests`, `/requests/new`, `/requests/$id` | Verify requester/source/destination scope, valid lines and current request state. Keep request/approval/fulfilment history. A request alone does not dispatch or receive stock. |
| Transfers `/transfers`, `/transfers/new`, `/transfers/$id` | Validate endpoints and permitted source stock; preserve draft → configured approval → dispatch → receipt/verification transitions. Dispatch/receipt post their respective effects once. Reject repeated/invalid transitions; retain partial/variance/cancellation evidence under existing rules. |
| Transfer approval/receipt/verification dialogs | Recheck actor, current document revision/state, destination/source authority and configured limits. Preserve normal intra-cluster authority; apply configured inter-cluster approver rules without inventing blanket extra approvals. Never silently delete in-transit quantities. |
| Sponsorship `/sponsorship` | Record recipient/purpose/reference/time/items/value, required approval and handover. Preserve configured administrator/direct-issuer exceptions; other issuers need selected eligible approval at any amount. Handover deducts stock once and prints a linked receipt. Sponsorship stock value is not customer cash; daily-sales treatment follows its explicit policy. |

### Bookings and services

| Page/action and route | Required workflow |
| --- | --- |
| Bookings/pay later `/bookings` | Scope list/details and distinguish create/manage/cancel/collect authority. Preserve booking status, lines, customer/service details, deposits, balances and audit evidence. |
| General booking `/pos/general-booking` | Validate service/items, promised dates, fees and deposit requirements before atomic save. A failed/uncertain save must not collect a duplicate deposit. |
| Racket service `/pos/racket-service` | Preserve job-specific details, service fees, dates/status and customer receipt versus racket tag. Apply the same payment, approval and handover integrity rules. |
| Deposit/payment/cancel/handover dialogs | Attribute deposit money to the shift/tender that actually receives it. Fully paid collection requests no new payment. Collect outstanding balances through ordinary tenders and link final sale/stock/receipt once. Count the full merchandise sale once, not the earlier deposit as new cash. Refund/cancellation follows saved policy and authority. |
| Legacy collected booking recovery | If accepted sale/payment linkage cannot be proved, show Needs review. Never automatically charge again, create another sale or deduct stock to conceal missing evidence. |

### Approvals marketing people and administration

| Page and route | Required workflow |
| --- | --- |
| Pending approvals `/approvals` | Show only authorized requests/recipients, including eligible PIN sessions. Opening the queue grants no approval authority. Refresh promptly through authorized signals/reads and fallback polling. Revalidate action, requester, approver, branch, revision, limits, expiry and one-time use at decision/execution. |
| Promotions `/promotions`, including Point Rules anchor | Respect saved management rights, campaign dates, branches and configured stacking/limits. Preview/validate effects on new transactions; preserve saved sale evidence. Point/Membership redesign remains on hold. |
| Coupon campaigns `/coupons` | Validate authorized campaign/claim/redemption conditions and usage limits. Prevent duplicate redemption through authoritative operation identity. Keep issuance/claim distinct from sale/payment. Preserve held Membership dependencies. |
| People/Membership hub `/customers`, directory `/members`, verification log `/verifications` | Membership remains ON HOLD: preserve existing privacy, access and behavior. Do not redesign/activate/fix this module under a general workflow request. Confirmed critical shared-dependency changes need the existing explicit exception approval. |
| Staff `/staff`; locations `/stores` | Use the detailed Settings/staff rules above. Their placement in another hub does not widen management rights. |
| Administration `/admin` | Each privileged tool enforces its own current authority and scope. A menu title or general Settings/staff grant does not unlock unrelated administrator-only tools or production/schema actions. |

### Reports audit and notifications

All report reads/exports use the authorized branch/cluster/view and saved business
timezone, with explicit date boundaries. Distinguish sale-period, payment-receipt
period and shift-period totals. Show missing history/sync coverage; never infer
historical stock/cost from today's quantities. Read, cost/margin and export rights
remain independent. Export respects the same filters and hidden columns as the
permitted data, with safe formatting and no extra hidden sensitive fields.

| Page and route | Required workflow |
| --- | --- |
| Sales report `/reports/sales` | Keep bills/item/payment views scoped and reconciled without counting one sale multiple times. Preserve filters and drill-down authorization. |
| Item history `/reports/items` | Compatibility entry to the Sales report's item view. Keep its date/scope/cost checks; redirect grants no extra access. |
| Cashier payments `/reports/payments` | Compatibility entry to the Sales report's payments view. Preserve tender/account/cashier attribution and split/deposit/refund semantics. |
| Stock adjustments `/reports/stock` | Read actual count/adjustment/movement evidence and variance reasons. Report incomplete coverage; do not mutate stock from a report. |
| Voids/refunds `/reports/voids` | Preserve original/linked correction evidence, actor, reason, approval and monetary signs. Viewing does not authorize a new refund. |
| Edit history `/reports/history` | Retain chronological immutable change/authorization evidence with authorized detail access. No deletion/rewrite through a report control. |
| Register activity `/reports/activity` | Display saved hold/resume/void/split/drawer events without manufacturing business state from notification ordering. |
| Retail performance `/reports/business` | Use approved revenue/cost/margin/velocity definitions and disclose scope/coverage/estimate limitations. Protect cost data. |
| Catalogue changes `/reports/catalog` | Show permitted saved product/price/movement history and ownership. A catalogue metadata change is not itself a stock movement. |
| Business analytics `/reports/analytics` | Preserve authorized aggregation, exact business definitions and date semantics; chart choices change presentation only. |
| Activity/notifications `/reports/notifications` | Distinguish business event, intended recipient, seen state and delivery outcome. Viewing a request notification grants no right to approve it. |
| Coupon usage `/reports/coupons` | Link actual redemption/discount evidence to permitted bills/items without duplicate totals. Preserve Membership hold boundaries. |
| Activity trails `/audit` | Require audit access and enforce branch/actor scope on reads/export. Preserve immutable business/security audit evidence. |
| Alerts history `/alerts` and in-app panel | Protect recipients and details. Clear hides for the current user only, retaining events/delivery audit. New subscriptions must not replay old toasts; keep unseen items queued. Opening a linked page rechecks its authorization. |

### Startup recovery and public entry points

- `/database-startup` and `/recovery` use T1–T11 and the native recovery allowlist.
  Startup starts enabled saved SQL automatically, reports verified readiness and
  preserves the approved online fallback and any old-data recovery hold. A repair
  screen must remain usable when the connection it repairs is unavailable.
- `/join`, `/membership` and `/verifications` are held Membership surfaces;
  preserve their current access/privacy and do not expand this batch into them.
- `/claim/$campaignSlug` and `/c/$tokenSlug` retain their existing public-token
  contracts: validate the intended campaign/token, scope, expiry, replay and
  allowed response. No public token grants staff session, administration or
  unrelated customer-data access. Preserve any Membership dependency on hold.
- The root application layout and every underlying API/RPC/relay/IPC operation
  enforce the same session, device, scope, action and business-state checks as the
  calling page. A public route, redirect or renderer field establishes no broader
  authority. Do not alter generated routing files to document these rules.

## Implementation and verification discipline

Use the existing tracker for each confirmed rule mismatch: baseline/revision,
affected workflow/platform, required outcome, implementation, focused checks,
installed/hosted acceptance and remaining limitations. Keep suspected issues and
untested behavior separate from confirmed defects. Documenting or merging these
rules does not complete the previously reported permission malfunction or prove
any offline/native financial workflow.

For later authorized runtime fixes, test meaningful allowed and denied cases at
the actual changed boundary, including page/action dependencies, synced PIN user
with no previous PC login, known revocation, user/scope switch, lost response,
restart and offline recovery where applicable. Reuse relevant existing tests;
do not run an unrelated regression campaign for a documentation-only change.
Use isolated data for financial/security/stock tests. Track source, database
application, deployment, installed acceptance and release separately. Publication
and production promotion retain their explicit owner-approval requirements.
