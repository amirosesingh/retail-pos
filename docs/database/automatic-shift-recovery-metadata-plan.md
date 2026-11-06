# Automatic local shift-recovery metadata — preparation plan

Implementation baseline: beta `858f023fe543d2ae37e561eb6a42d647c62f301a`.
Owner approved implementation and isolated tests on 7 November 2026.
This is not a live database or fleet rollout approval.

## Confirmed release gap

Retail 1.4.82's normal managed installer ends at core migration 024. The
optional recovery service is released, but its four metadata tables are not
installed automatically. A valid core schema can therefore pass health checks
without making the old-closing review/recovery capability available. This is a
source-level prerequisite gap; the affected PC's current schema/state remains
unverified until read-only inspection is available.

## Proposed bounded implementation

- Add a Main-only recovery-metadata installer in
  `electron/db/shift-recovery-metadata.cjs`.
- Add a bounded hook in `electron/db/service.cjs` and wiring in
  `electron/main.cjs`, before database readiness, business writers and sync are
  released. Coordinate with the existing exclusive sync lane, identity/generation
  checks and migration state; preserve the operator's prior pause setting.
- Generate one recovery-only SQL artifact under `database/sqlserver` using the
  reviewed existing-upgrade assembler and manifest fingerprints. Keep the
  published 559,560-byte 1.4.82 consolidated file byte-identical.
- Include only existing prepared modules 028–030. Do not include financial
  modules 025/026, activate a financial rollout, change sharing policies, or
  include Stock report module 031.
- Keep automatic DDL behind a Main-owned, artifact-pinned approval policy that
  is disabled in the preparation candidate. Owned fixtures inject an approved
  policy for end-to-end tests. A renderer value or environment variable cannot
  approve a real database update. Final activation needs exact-file/rollout review.

The exact SQL effects are four initially empty tables:

1. `dbo.pos_shift_recovery_evidence`;
2. `dbo.pos_sync_shift_legacy_recoveries`;
3. `dbo.pos_sync_shift_legacy_recovery_receipts`;
4. `dbo.pos_shift_recovery_adoptions`.

Their existing reviewed scope/uniqueness indexes, foreign keys, owner properties
and four append-only triggers accompany them. No business row, closing time,
count, sale, stock, price, permission grant, registration, queue or checkpoint is
rewritten. Creating these tables does not approve or acknowledge a closing.

## Installation safety and recovery

Validate the exact supported core schema, configured profile/database GUID and
existing module shapes before writing. Fully reviewed existing objects are a
no-op; partial or unknown objects stop for review. Require a verified suitable
backup or perform an approved COPY_ONLY/CHECKSUM backup through the existing SQL
connection to a trusted SQL-server backup directory. No guessed client path,
credential changes or newly granted SQL privileges. Backup failure prevents DDL.

Use the existing assembler's one SQL-owned transaction and bounded exclusive
metadata application lock. Execute the whole reviewed artifact on a dedicated
temporary connection; do not nest it inside the normal migration transaction
wrapper. Preserve pending work and fail/retry safely on busy or changed targets.
After exact schema readback, invalidate the cached unavailable capability and
resume the existing authorized recovery pipeline. Only successful scoped data
recovery may advance its existing checkpoint. Legacy closings without original
proof still need the already-approved audited Administrator decision.

Release the bounded upgrade lease after a refused backup, busy target or
unrecognized optional schema. Preserve the existing qualified-cache/checkout
rules; an optional metadata failure must not create a new permanent checkout
outage. Report the unavailable recovery capability honestly and keep operations
requiring it denied. First/incomplete setup and unproved shift recovery remain
gated; do not use this fallback to declare data recovered or uploaded.

## Isolated acceptance before any live application

Test actual core24 installations with all four tables absent, exact pre-existing
metadata and partial/altered metadata; unchanged published manual upgrade followed
by automatic rerun; transaction/late-failure rollback and crash-after-commit replay;
concurrent writer/migration, backup refusal, changed profile/GUID and stale frames.
Test optional-upgrade failure against both previously qualified offline checkout
and an incomplete snapshot, preserving their distinct existing gates.
Run the actual startup/metadata/capability/recovery chain, including allowed and
denied Administrator/cashier/branch paths, offline/reconnect and competing web
corrections. Preserve existing financial modes, checkout and pending work.

The owner must see the final SQL file/hash, target or rollout scope, backup and
quiescence behavior before live execution or deployment that enables automatic DDL.
Production promotion remains a separately approved beta-to-main PR.
