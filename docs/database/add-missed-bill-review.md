# Add missed bill: implementation and database review

Owner approved implementation on 2026-10-29 (DEC-57). Branch:
`codex/add-missed-bill`, starting from current beta `bce925a2`.
**No live migration or financial record has been created by development.**

## Scope

Receipts -> Add missed bill, administrator only on client and verified server.
Use selected authorized branch; normal terminal registration still restricts the
operating branch. Capture original business-zone date/time, an active original
cashier assigned to that branch/all branches, optional original paper reference
and original shift reference, items, actual historical unit prices/costs and line
discount/tax totals, already-received split tenders, required reason and explicit
stock choice with explanation. Prices are tax-exclusive when tax is entered
separately. No reliance on today's catalogue prices for historical values.

Stock choices: deduct current branch quantities exactly once, honoring saved
negative-stock prevention; or already corrected, with no stock movement. Product
catalogue ownership/cluster checks remain authoritative. New product creation,
membership payments, fractional sale quantities and arbitrary free-text items
are not included in this first historical-entry implementation.

## Persistence and integrity

Migration `20261029073121_add_missed_bill_historical_entry.sql` adds:

- `public.missed_bill_entries`: append-only provenance/idempotency metadata with
  RLS enabled, no anon/authenticated access, SELECT/INSERT only for service_role.
  This audit metadata is server-only, excluded from terminal replication.
- `public.pos_admin_add_missed_bill(jsonb,text,text)`: service-only invoker routine,
  also verifies active administrator, account/terminal branch, cashier, catalogue
  and original-shift attribution. Deterministic IDs, advisory locks, exact request
  replay and duplicate original-reference checks protect retries.

The routine atomically adds a sales header, sale items, historical completed
payment ledger entries, provenance and record-edit audit. For deduct mode only,
it uses existing stock_apply_delta plus item activity logs. Any validation or
write failure rolls back the complete operation. Current operational sale/payment
shift IDs remain NULL; original shift is validated audit metadata. Original sale
time and payment paid_at/created_at are historical; entered_at is current.

Receipt number uses a distinct deterministic MB-UUID namespace, so historical
paper references cannot complete a held ticket. The original reference remains
in metadata/audit. Explicit reprints show an entered-later/payment-already-received
label; original tax is printed from stored amounts, not today's tax rate.

No existing rows, normal checkout routines, receipt numbering settings, permission
grants, issued shift reports or payment providers are rewritten. Existing shifts
closing guards are preserved. Reports gain the historical sale/payment in its
original date context after cloud refresh; current shift excludes it.

## Platforms and retry limits

Online required on web, Electron and mobile. The hosted action is explicitly
registered. No normal local commitSale/outbox path is used; offline historical
entry needs a separate reviewed local atomic contract. The UI retains its stable
payload/key after uncertain failure and retries unchanged; known transaction
rollback errors permit editing. The authoritative cloud receipt is materialized
in current receipt history even if Electron's local replica has not caught up.
Installed-device transport, local replica propagation and hardware printing are
not established by mocked tests. Native binaries must include this code or a
compatible update; deploying the database alone does not update an old binary.

## Verification and rollout

11 isolated PGlite cases cover both stock choices, exact retry/changed-payload
denial, original payments and no drawer, line discount/tax reconciliation,
failure after stock work rollback, administrator/branch/terminal checks, negative
stock policy, foreign catalogue denial, future dates/original shift validation,
duplicate references and direct authenticated denial. Frontend/schema/receipt
tests cover required fields, business timezone, admin visibility, retry contract,
historical tax labels and unchanged ordinary receipt conditions.

Before live application, identify ROSEGILL organization and POS project/ref/URL,
present this migration and obtain explicit approval. Application creates schema
objects only; it does not enter a missed bill. Test-created records must stay in
isolated fixtures. Never create a real sale to demonstrate the feature.

Rollback before use: revert source and remove the unneeded new routine/table only
under separate reviewed database approval. After use: disable the feature while
preserving the audit table, sales, payments and stock records. Do not DROP data or
delete financial records as rollback. Correct mistakes through reviewed audited
financial corrections, not blind reversal.

Local verification: 554 suites / 3,430 tests passed, plus 11 isolated PGlite cases. TypeScript and scoped ESLint passed. Final registry/dialog checks passed (3 tests). Live browser interaction was unavailable because browser use is disabled in Work settings; no installed-device or physical printer verification is claimed.
