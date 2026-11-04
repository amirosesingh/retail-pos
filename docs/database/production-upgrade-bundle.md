# Production upgrade bundle — preparation only

Status: not finalized or approved for application. No SQL in this plan has been executed.

## Controlling boundary

The owner requires all new cloud and local database upgrades collected for final exact review before application. ROSEGILL → rosegill0011@gmail.com's Org (bjxgimekljzlnwejuawj) → pos (qhrufhtbeguxydenzfey), postgres, https://qhrufhtbeguxydenzfey.supabase.co is PRODUCTION. A beta application connection does not change that fact. Identify each actual local server/database and current schema version separately; never infer the target from a machine nickname or replace its operator configuration.

## Required final manifest

For each proposed file record: exact bytes/SHA256, target, recognized prerequisite schema/routines/grants, objects added/replaced, any existing rows affected, execution order, transaction/locking boundaries, preflight, isolated upgrade/downgrade compatibility tests, postflight and targeted recovery limits. Already-applied approved migrations/repairs are evidence only and must not be replayed because local filename timestamps differ from the migration ledger.

Prepare additive existing-data SQL Server upgrades if FIN62 requires metadata. Never rerun an entire installer against a live till as a shortcut, drop/recreate business tables, reset Change Tracking/checkpoints, clear pending intents or overwrite data with a backup. Existing sales, refunds, stock, prices, SKU, closing history, operator settings, vault identity and permission grants are preserved unless a separately identified exact correction is approved.

The current FIN62 first local transaction guard needs no schema change. Historical financial evidence/protocol work is not complete; no final cloud or local metadata migration exists yet. Prototype SQL under scripts/preparation is isolated test material, not an apply-ready migration or an upgrade instruction.

## Application at the end

A single reviewed release window does not imply one atomic transaction across Supabase PostgreSQL and multiple local SQL Server databases. The final plan must state the compatible deployment/migration sequence, which individual steps are atomic, when to stop, and which accepted records make a blind rollback unsafe. No publication, enforcement switch, privileged enrollment or production promotion is implied by preparation.

Membership stays on hold. Credential-entry checks remain explicitly unverified rather than bypassed. No production test sale, refund, stock adjustment, rule delivery or destructive failure test is authorized.
## Candidate local metadata file — not final, not applied

scripts/preparation/025_shift_financial_bases.sql currently proposes ONLY dbo.pos_sync_shift_financial_bases, its primary/scope indexes, JSON/version/hash-format constraints and an immutable update/delete trigger. No business rows, backfill, configuration, queue/checkpoint, permission grant or migration-ledger receipt changes. It rejects caller transactions and unexpected existing metadata shapes. Candidate SHA256 DD33A85803A1822306134063BAB47D67061FC7DE9DB8E9EFE1DE06E3F9E27331; seven actual disposable LocalDB groups passed. The file is outside automatic migration discovery and has NOT been applied to an operator database. This hash is evidence of the tested proposal, not approval or a final application instruction; changes require a new exact review. Final local target/schema identity and runtime protocol compatibility remain prerequisites.
