# Reusable campaign codes

Manage these in **Coupon campaigns → Reusable codes**. These are shared collaboration codes, separate from individually issued vouchers. Promotions & discounts continues to own automatic threshold, birthday, tier, free-gift and points rules; entering a reusable code does not automatically enroll a member or create points rules.

Each code has a percentage or fixed discount, optional collaborator, active dates, **Whole bill / Per item**, and **Global / a specific store cluster**. Per-item fixed amounts apply per eligible unit; returns, credits and free gifts are excluded. Store coverage compares the saved cluster ID, not its display name. A store without a matching cluster cannot redeem a restricted code. Existing discount permission/approval remains required.

The customer display receives the cashier's calculated original total, coupon code and saving, other discounts, tax/rounding and final payable. It does not independently calculate a second total. Quantity changes recalculate the reusable discount.

## Deployment and offline operation

- `supabase/migrations/20261023160000_reusable_campaign_codes.sql` was applied to the shared POS project with owner approval on 23-10-2026. Columns, unique index, sale guard and global feed coverage were verified after application. Fresh installations still require this schema.
- Upgrade Windows local SQL with the generated `database/sqlserver/retail-pos-local-update.sql` through the existing database-upgrade workflow. It adds `partner`, `code_scope`, and `code_cluster_id` to `promotions`.
- Allow a successful sync before disconnecting Windows. Changes made centrally while disconnected become effective after its next sync; they cannot be delivered to an offline till immediately.
- Non-free-gift promotions previously omitted from scoped bootstrap/feed now download. Existing product-owned free-gift branch restrictions remain in place. The migration queues existing non-free-gift rows for already-synced tills.
- Android, iOS and web keep their existing online business-data requirement. No new offline mobile database is introduced.
- No installer publication or main merge is included in this PR.

## Remaining requested policies

This implementation provides **unlimited reusable codes without membership linkage**. Per-member eligibility and daily/global usage caps requested as additional policies are not implemented here. A strict cross-till limit needs atomic online redemption or preallocated offline allowances; local counters alone cannot guarantee a global cap. Do not advertise those limits as enforced.

## Checks

Unit tests cover bill/item calculations, quantity changes, expired/disabled rules, duplicates, unknown/mismatched clusters and legacy voucher preservation. PostgreSQL/PGlite tests execute the migration, sync apply/feed/bootstrap/count/delete paths and the sale-boundary cluster check. Electron's aggregate test checks rollback before sale writes for a mismatched cluster. Physical disconnected Windows/phone checkout remains a device validation step.

## Token approval and history

Registered native terminals can accept an eight-digit soft token without an approver ID. The server or Windows main process resolves exactly one eligible device in the authorized branch, then checks the account, approval permissions, lease and replay protection. Ambiguous codes are rejected; ordinary approval PINs still require an ID. Code lookup is rate limited. Windows must have downloaded its encrypted verifier bundle while online before offline approval is available.

Approvals → Approval history shows the saved ticket reference, approver name and credential method. Both cloud approvals and queued Windows approvals use the existing authorization_log detail fields. No token code or secret is written to history. Older records without names use their saved user identifier. This history addition needs no new database columns.

Issued vouchers & codes, Performance and Audit log include reusable codes. Reusable performance explicitly totals the loaded newest sale records; Load older extends that range. Refunds are excluded and coupon savings are separate from other discounts. The audit also shows successfully saved code creation, edits and deletion. Reports load on demand, without background polling.
