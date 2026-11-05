# Production upgrade bundle and application record

Status: the exact approved files were applied to the named cloud project and one local database on 5 November. See [the application record](shift-financial-application-20261105.md). Other targets, rollout activation and publication remain unapproved. Historical candidate notes below are retained as evidence, not replay instructions.

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
| `supabase/migrations/20261105090000_shift_financial_known_history.sql` | `A37FD005A688C1E2AC4815E0455E9B97B842531C3ACE0BC3F0A105287498EC2E` |
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

### Guarded application result and replacement candidate

The owner-approved earlier cloud90000 artifact (SHA256 `75DCFA47F4898FBAAF8E356BE499601DA4DA39B92050B510299061137DF21F20`)
was attempted once and rejected by its source guard. Read-only postflight showed
zero new namespaces, public protocol routines or migration receipts: full rollback.
No cloud90100 or local025/026/027 was applied. The private approved original is
retained as evidence; do not rerun it or infer approval for different bytes.

The replacement candidate above adds only two explicitly reviewed live-source
fingerprints: a close-start denial-wording variant and a reconciliation
comments/formatting variant. It also normalizes CRLF before LF-sensitive alias
patches. Unknown definitions, altered permissions and wrong owners still abort;
existing authority metadata and the target's denial wording remain preserved.
Captured raw web definitions and unchanged native delegates are tested in owned
fixtures. This is compatibility preparation, not a business-rule change or repair.

The new cloud90000 hash requires renewed owner approval before another live
attempt. Cloud90100 and local025/026/027 hashes remain unchanged, with their prior
exact approvals and maintenance conditions retained. No protected rollout,
sharing-OFF cutover or production publication is authorized by these approvals.

The owner subsequently renewed approval for the exact revised hash. Application
and independent postflight succeeded for both cloud files and all three local
files on the single approved local database. The section above records the
earlier preparation boundary; the dated application record is authoritative for
what ran. Do not rerun installed metadata or bulk-push timestamped migrations
without reviewing the recorded repository-file/live-ledger correspondence.

## Next legacy-recovery preparation — NOT approved for application

The owner approved the narrow exact-witness download correction and Management
pagination code/isolated tests on5 November. Neither approval applies these
schema candidates, activates local adoption, enrolls real keys or publishes a
release. The already-applied financial/sharing files above are not replay steps
for this new preparation. Current recovery preparation checkpoint:5c5ce06b.

Proposed cloud target remains ROSEGILL / rosegill0011@gmail.com's Org
(`bjxgimekljzlnwejuawj`) / pos (`qhrufhtbeguxydenzfey`), database `postgres`,
https://qhrufhtbeguxydenzfey.supabase.co. No fresh live-definition preflight or
application has been performed for this candidate. Exact local server/database/
GUID/schema identity must be verified separately for every existing PC; historical
machine names or a beta application label are not proof of the current target.

| Candidate artifact / order within its database | Exact current SHA256 | Change on schema application |
| --- | --- | --- |
| Cloud: `supabase/migrations/20261105063613_admin_attested_legacy_shift_recovery.sql` | `145FDD86BBF6E2D7B4CB6CB9B9E0D72639329ED24979357AEAE2C724BA43EC2E` | New private append-only receipt table, index/trigger and service-only `pos_sync_recover_legacy_closing(text,text,text,text,jsonb,jsonb)`; deny direct table access. No business rows rewritten. |
| Local1: `docs/database/retained-shift-recovery-evidence.sql` | `E3727FE62A276C1EAF200F8783B289D5BE745F2E95D563CDA850EEE9F8CAADCD` | New immutable `dbo.pos_shift_recovery_evidence`, bounded raw before-images, scope index/checks/trigger. Empty on application. |
| Local2: `docs/database/legacy-shift-recovery-outbox.sql` | `08917EE9041033A68A81751D6409B0BB60E7E0D1D3878DCF577EA64D0B6C5307` | New immutable `dbo.pos_sync_shift_legacy_recoveries` and `dbo.pos_sync_shift_legacy_recovery_receipts`, identity/scope indexes and evidence/receipt relationships. Empty on application. |
| Local3: `docs/database/reviewed-shift-adoption.sql` | `5EE385C20BE5C3A79C0F0CBB91D0D4294EF17D0CB8B350201C23B4B65BF4CE92` | New immutable `dbo.pos_shift_recovery_adoptions` decision archive, evidence relationship, uniqueness and exact constraints. The unapplied identity index includes decision_id so distinct explicit reviews can remain append-only. Empty on application. |

These are reviewed-source hashes for preparation, not final apply instructions.
The existing files each own a transaction and abort on unexpected existing
objects. A final single local existing-database upgrade file must be generated,
reviewed and tested for atomicity and recognized already-installed shapes before
being offered to an operator. Do not naively concatenate/replay these separate
transactions or run a full installer. Their final consolidated bytes/hash and
per-PC target preflight still require owner review before application.

Schema application alone creates no closing, sale, stock adjustment, signature,
recovery approval, receipt, adoption decision or checkpoint advance. Later actual
application use is distinct: an authenticated Administrator may explicitly review
a missing historical closing under the approved provenance rule; the cloud routine
rechecks current authority and complete OPEN compare-and-swap. Reviewed local
adoption archives the exact before-image before changing its effective projection.
Those operations must preserve accepted web corrections and pending work, and
must not invent an original financial snapshot or cashier signature.

The later recovery wiring/CT-proof preparation now passes59 actual disposable
SQL groups and135 focused tests. Current real Administrator review or a fresh
private accepted receipt is required for reviewed no-write recovery coverage;
persisted decision rows alone grant no authority. The captured-V0 six-table
completion case passes. A fresh accepted-original snapshot can prove the narrow
restart/later-web-correction chain; unprovable intermediate histories stay for
explicit review. The Local3 index change above permits permanent distinct review
decisions and requires exact file review before application. Full integrated
regression on current beta remains pending; none of this applies or approves
these candidates or activates a production recovery.

Final gates: full integrated exact-writer regression, complete runtime
adoption integration, independent allowed/denied/retry/rollback tests, compatible
cloud/local sequence and fresh schema/grant checks, isolated upgrade tests, actual
device acceptance, and separate exact-target application approval. Installer and
production publication remain separately unapproved. Never delete immutable
evidence/pending history as a rollback after accepted operations exist; preserve
records and prepare a targeted forward correction.
