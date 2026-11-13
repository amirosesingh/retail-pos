# Retail POS Beta fresh local setup and existing database upgrade

This package prepares the existing-database storage required by beta source
`71022a12d677ae3cba61427ea93819e1697e2479` (application source version 1.4.83).
Installer display versions are assigned separately by the release workflow.
It includes the event/outbox, grouped stock, refund, settings and recovery storage
used by the current two-way sync code, alongside legacy Change Tracking mirrors.
An additional fresh local entry file composes the reviewed full core installer
and the current metadata upgrade. This package is not a beta app installer or
a production upgrade. The Supabase entry file remains an existing-project update.

## Choose the right SQL file

| File | Exact target | Behavior |
| --- | --- | --- |
| `retail-pos-supabase-beta-upgrade.sql` | Retail POS Beta `irjkmhgrjgcaoixcixut`, database `postgres`, system identifier `7703759698107299042`, owner role `postgres` | Verify/no-op on the captured current schema; upgrade only the recognized prior beta through the reviewed tender/transfer/booking payload; refuse unknown targets or baselines. |
| `retail-pos-local-beta-upgrade.sql` | An existing isolated `POS_Local_Beta` database with the recognized Retail core schema 24 | Add or recognize the complete reviewed metadata set, preserve existing rows and reject partial/unknown shapes. It creates no database and switches no connection. |
| `retail-pos-local-beta-current-fresh.sql` | A newly created, empty isolated `POS_Local_Beta` database | Install the full reviewed core and all13 current sync metadata modules. Refuse populated/wrong databases. Creates no database and switches no connection. |

The single ZIP also contains this README and the exact SHA-256 package manifest.
The local module identities are packaging identities, not new core-migration
ledger versions. The required core remains 24. The older 1.4.82 metadata file
alone covers025–030; this file additionally includes:

- immutable sale-event outbox and acceptance records;
- grouped per-branch stock revision proof;
- refund evidence/acceptance columns, constraint and index;
- scoped snapshot/recovery page staging;
- durable store-settings commands, receipts and review decisions.

No sync enrollment, rollout activation, terminal registration, credentials,
business imports, backfill, stock adjustment or checkpoint reset is included.
Newly documented permanent catalogue membership rules C17/C18 are not reported
as implemented by this package; their complete runtime/persistence work remains
separate. Metadata readiness is not proof of a complete live cutover.

## If you need to create the local database first

Msg51031 at the target guard means the SSMS query window is connected to a
different database. The existing-upgrade file cannot create a missing database.
It stops before changing anything; do not delete or edit its safety guard.

1. Connect SSMS to the intended isolated local SQL Server instance. On that
   instance, create a new database named `POS_Local_Beta` using Databases → New
   Database, or run the following single statement in a new `master` query window:

   ```sql
   CREATE DATABASE [POS_Local_Beta];
   ```

   If that name already exists, stop and determine whether it is empty or holds
   saved data. Do not drop, rename or overwrite an existing database.
2. Open a query window with `POS_Local_Beta` selected. You can verify it using
   `SELECT DB_NAME() AS selected_database;`.
3. Run the whole `retail-pos-local-beta-current-fresh.sql` file. It includes the
   full core and the newer event/stock/refund/settings/recovery metadata, including
   retained recovery modules. Do not run the existing-upgrade file on an empty
   database. After this fresh file succeeds, no second upgrade file is needed.
4. Configure the beta app's existing local connection fields for this database.
   Database creation does not configure a terminal, grant a staff login or copy
   cloud records. Initial authorized bootstrap remains separate.

Fresh core setup and the metadata update commit separately. If a step fails,
the file throws and does not continue to a later successful result. Preserve the
new database and the error for review; do not assume the entire fresh setup was
rolled back, rerun it over populated objects, or delete pending work. The
existing-data upgrade remains atomic across its own13 metadata modules.

## Current Supabase Beta state

Read-only inspection on 13 November 2026 found all nine beta migrations through
`20261110031005`, the current tender/transfer/booking routines, 79 public tables
with RLS and 18 feed tables with RLS. Twelve critical routine bodies, owners,
security/grant settings, receipt constraints and the migration ledger are pinned
in the reviewed cloud baseline. The current matching beta therefore needs no
replay of its already-installed upgrade. No hosted DDL/data change was made while
preparing this package.

## Application procedure after exact-file and target review

1. Verify the selected beta project/database and SQL hashes against the manifest.
   Take and verify the appropriate database backup. Close Retail safely on the
   target PC and finish accepted local writes. Keep pending work and old recovery
   evidence; it must not be cleared to make an upgrade pass.
2. For cloud, use the exact Retail POS Beta project SQL Editor as the owner and
   run the complete cloud SQL as a standalone transaction. Do not wrap it in a
   second transaction or submit it as another migration through a tool that owns
   its transaction/ledger. A current schema reports a verified no-op. An exact
   recognized older beta upgrades and records the existing beta migration version
   in the same transaction. Any error stops the operation and must be resolved;
   a later result line does not override an earlier failure.
3. For local SQL Server, connect SSMS to the existing isolated `POS_Local_Beta`,
   with database CONTROL, and run the complete local file outside a caller
   transaction. The core, metadata, indexes, constraints, triggers and ownership
   must match the reviewed shapes. A known partial set of complete modules can
   gain its missing modules; a partial object or unknown schema is refused.
4. Each database's operation is independently transactional. A local late error
   rolls back the whole composed local upgrade. No cross-database transaction is
   promised. Confirm the final result, preserve the audit/backup and record actual
   application separately from file preparation and fixture tests.
5. Reopen the beta app against the verified same project/branch/local profile.
   Verify actual schema readiness, scoped reads, pending work and authorized sync.
   Installed-device and two-till acceptance remain separate from SQL generation.

For an empty local database, use the current-fresh entry file above; the existing-
database file intentionally refuses that workflow. Retail POS Beta Supabase
already exists and is current: do not replay a cloud fresh schema into it.
For a core below24, above24 or an unrecognized shape, stop and prepare the exact
missing incremental path; never replay a fresh schema or fake a migration ledger.

## Offline operation and recovery

Electron offline trading requires configured/ready local SQL, a verified scoped
baseline and valid offline authority. With no internet, finish local saves and
verify readable durable pending storage, then close without cloud sync or a
cloud-sync-required dialog. Reconnect/restart resumes eligible work. Online close
attempts the existing authorized final sync. Real local save/storage failures
remain blockers; no local SQL plus no internet provides no new write destination.
Provider-dependent payments, WhatsApp and explicit online-only actions retain
their own service requirements. SQL files cannot change Electron dialogs or
network routing; focused shutdown tests are recorded separately.

Expired Change Tracking/feed history recovers through the existing scoped
snapshot/journal protocol. Dates help locate candidate changes; verified versions,
ownership, operation IDs and acceptance evidence govern safe reconciliation.
Retain real conflicts and pending work for review instead of hiding errors or
choosing a winner solely by a PC clock. Do not delete unsent business events
because a temporary snapshot page or cursor has expired.

## Later production rollout

Do not run these beta-pinned files in production or edit their guards to bypass
the target checks. Production's existing migration history and writer variants
must first be compared with the release source, then its exact incremental delta
and each PC's recognized local baseline prepared and approved. This package is
review material for that process, not production execution approval. Never use
the complete Supabase fresh schema or reset script as the production updater.

Stop application writes if an upgrade fails. Preserve backups and any accepted
new history; do not drop the new metadata or overwrite databases to reverse a
partially deployed release. Prefer a reviewed forward correction after new
protected records have been accepted. Membership remains ON HOLD.

## Maintainer reproduction

`node scripts/package-beta-database-upgrade.cjs --check` verifies the distributed
SQL and manifest without a connection; `--write` reproduces them from the frozen
inputs. Original and adapted source hashes record the deliberate transaction
adapter. Only the new cloud wrapper owns its outer transaction; only its reviewed
source BEGIN/COMMIT are removed inside the payload. The original protected file
is unchanged. Local module transactions stay balanced inside one owned wrapper;
system-generated constraint names are recognized by semantic shape/key mapping,
while definitions, types, keys, trust, grants and pending data remain protected.

Schema capture and SQL Server tests accept no operator connection arguments and
use uniquely owned disposable LocalDB instances only. PostgreSQL wrapper tests
use disposable PGlite fixtures. The real beta catalogue inspection is read-only;
synthetic wrapper success is not a live application of the beta payload.
