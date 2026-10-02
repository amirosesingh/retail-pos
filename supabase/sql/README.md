# Central PostgreSQL / Supabase SQL

## Existing production database

`../migrations/` is the authoritative incremental change set. Do not run an
individual timestamped file by hand and do not use `../schema.sql` against an
existing database.

Before deploying, compare the linked project's migration history with the
repository. This project has previously applied migrations under version
numbers that differ from some local filenames, so `supabase db push` must not
be used until that history mismatch has been reviewed and repaired. Never
"fix" the mismatch by replaying an already-applied migration.

Once the histories agree:

1. Take and verify a database backup.
2. Run `supabase db push --dry-run` and review the ordered SQL.
3. Preview the rows affected by any data-changing migration.
4. Run the normal migration deployment once, then verify the recorded version.

There is no consolidated `production_upgrade_current.sql` in this repository.

## Fresh installation

Use the repository's single full canonical schema process with `../schema.sql`.
It is a fresh-install reference, not an incremental production upgrade.

## Windows and Electron

Windows SQL Server uses the controlled schema manager in `electron/db/migrations.cjs` with generated files in `database/sqlserver/`. These files must never be run in Supabase.

## Destructive maintenance

`../reset.sql` deliberately empties business data and is unrelated to upgrades.
Never run it for deployment or against production.
