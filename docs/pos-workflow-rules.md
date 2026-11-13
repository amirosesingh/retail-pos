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
