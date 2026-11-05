# Production upgrade bundle — preparation only

Status: not finalized or approved for application. No SQL in this plan has been executed.

## Controlling boundary

The owner requires all new cloud and local database upgrades collected for final exact review before application. ROSEGILL → rosegill0011@gmail.com's Org (bjxgimekljzlnwejuawj) → pos (qhrufhtbeguxydenzfey), postgres, https://qhrufhtbeguxydenzfey.supabase.co is PRODUCTION. A beta application connection does not change that fact. Identify each actual local server/database and current schema version separately; never infer the target from a machine nickname or replace its operator configuration.

## Required final manifest

For each proposed file record: exact bytes/SHA256, target, recognized prerequisite schema/routines/grants, objects added/replaced, any existing rows affected, execution order, transaction/locking boundaries, preflight, isolated upgrade/downgrade compatibility tests, postflight and targeted recovery limits. Already-applied approved migrations/repairs are evidence only and must not be replayed because local filename timestamps differ from the migration ledger.

Prepare additive existing-data SQL Server upgrades if FIN62 requires metadata. Never rerun an entire installer against a live till as a shortcut, drop/recreate business tables, reset Change Tracking/checkpoints, clear pending intents or overwrite data with a backup. Existing sales, refunds, stock, prices, SKU, closing history, operator settings, vault identity and permission grants are preserved unless a separately identified exact correction is approved.

The initial FIN62 transaction guard required no schema change. The expanded offline financial-history protocol now has deterministic candidate upgrades described below. Preparation source files are not independent application instructions; use the reviewed generated artifacts and exact manifest only after separate target-specific approval.

## Application at the end

A single reviewed release window does not imply one atomic transaction across Supabase PostgreSQL and multiple local SQL Server databases. The final plan must state the compatible deployment/migration sequence, which individual steps are atomic, when to stop, and which accepted records make a blind rollback unsafe. No publication, enforcement switch, privileged enrollment or production promotion is implied by preparation.

Membership stays on hold. Credential-entry checks remain explicitly unverified rather than bypassed. No production test sale, refund, stock adjustment, rule delivery or destructive failure test is authorized.
## Historical candidate notes — superseded, not application instructions

4 November current preparation supersedes the earlier candidate description/hash below. `scripts/preparation/025_shift_financial_bases.sql` now proposes two immutable metadata tables: the complete saved basis/required marker with its frozen graph hash, and its companion proof. SHA256: `9DEB7C3EB7A9393C8F722E3CEA1FCA45837ACCB7C95A2EED7394F85BBEA4653C`. Sixteen disposable LocalDB persistence groups, eleven upgrade groups and twenty-one capture groups passed. The raw capture query now lives at `electron/db/shift-financial-basis.sql`; it is a runtime read, not a migration. Runtime activation, final cloud migration consolidation and final target preflight remain pending. No operator database application is authorized by this preparation.

Cloud preparation currently contains isolated baseline, stored-version lineage, exact-decimal calculation and guarded admission routines under `scripts/preparation/shift-financial-*.sql`. These are not final production migrations. The final manifest must enumerate their consolidated objects, grants, hashes and compatibility sequence after offline opening-origin integration and review; do not apply these prototype files directly.

scripts/preparation/025_shift_financial_bases.sql currently proposes ONLY dbo.pos_sync_shift_financial_bases, its primary/scope indexes, JSON/version/hash-format constraints and an immutable update/delete trigger. No business rows, backfill, configuration, queue/checkpoint, permission grant or migration-ledger receipt changes. It rejects caller transactions and unexpected existing metadata shapes. Candidate SHA256 DD33A85803A1822306134063BAB47D67061FC7DE9DB8E9EFE1DE06E3F9E27331; seven actual disposable LocalDB groups passed. The file is outside automatic migration discovery and has NOT been applied to an operator database. This hash is evidence of the tested proposal, not approval or a final application instruction; changes require a new exact review. Final local target/schema identity and runtime protocol compatibility remain prerequisites.

## 5 November consolidated candidate — NOT approved or applied

The historical hashes above are superseded by the UTF-8/LF artifacts in
`shift-financial-upgrade-manifest.json`. Generate/check with
`scripts/generate-shift-financial-upgrade.cjs --write` / `--check`.
The explicit approval target is documentation input in
`shift-financial-upgrade-target.json`; the generator validates it and never uses
it for a connection. Application configuration remains operator/hosting supplied.

| Artifact | Exact SHA256 |
| --- | --- |
| `supabase/migrations/20261105090000_shift_financial_known_history.sql` | `75DCFA47F4898FBAAF8E356BE499601DA4DA39B92050B510299061137DF21F20` |
| `database/sqlserver/prepared/025_shift_financial_bases.sql` | `2C6E250D04855B86447603763C1A9304241D99D77814040756AB9AA67CB77897` |
| `database/sqlserver/prepared/026_shift_financial_operations.sql` | `26A55BC6FD352083AA388283F093212E9C74081E9C96FE87A79E71288AE235FA` |

Cloud target remains the production project identified above. Local targets must
each be identified and approved separately. Local025 adds two immutable saved
basis/proof tables. Local026 adds eight financial-history/stream metadata tables,
with guarded stream heads and immutable history. Neither file backfills business
records or changes amounts, stock, PINs, settings, queues or checkpoints.

The cloud artifact adds private financial provenance, version/publication and
receipt metadata; exact-decimal validation; guarded service adapters; and
readiness/rollout controls. Future ordinary business writes capture financial
version metadata through the reviewed triggers. Existing writer definitions and
grants are checked and preserved; this is not a historical repair. The migration
must recognize the captured live promotion-validation variant of the sale writer.
Unknown definitions abort. No rollout approvals or protected shift rows are
inserted on application. Installed metadata alone never activates enforcement.

Execution is individually transactional: cloud preflight/DDL/postflight and
schema-cache notification form one transaction; each local file forms its own
transaction. No cross-database atomicity is promised. Before activation, every
participating claimed Operations PC in the branch must have the reviewed code,
local025/026 and separate SHIFT63 local027, validated registration/database scope,
and reviewed/drained legacy pending work. The separate sharing-rule migration
must follow FIN62; it defaults ON and does not authorize arbitrary branch access.

Recovery must retain local work until verified cloud acknowledgement. A changed
or later administrator correction is a conflict to review, never permission to
overwrite history. Blind schema rollback becomes unsafe after new protected
history is accepted; stop new activation, preserve records and use a separately
reviewed forward correction. Keep a recoverable pre-upgrade baseline and use
targeted code reverts only when their protocol compatibility is proven.

Verified on isolated databases: exact artifact canonical/live-source preservation,
late-failure atomic rollback, unknown-namespace rejection, and eleven actual
Main/LocalDB/HTTP/PostgreSQL runtime scenarios. Nested-payment transport passes72
actual-handler/auth checks, and the full local suite passes5578tests/7skipped.
Exact-head CI, beta deployment and hosted CPU acceptance remain gates.
This document does not approve application, enrollment, activation or release.
