# Quiet live refresh — 1.4.37

The shared data-read wrappers displayed foreground progress for routine queries. The progress row was inserted above the app header and changed the available content height. Electron additionally announced `desktop:pull-complete` after every successful pull, including empty pulls, waking settings, rules and transfers. The root invalidated every active query for any committed table change, so unrelated report reads also restarted. Electron's healthy pull interval was five seconds; web/Android probed their full configured pull-table set on every renderer sync tick.

## Changes

- Table and paged reads are quiet by default; paged reads can explicitly request foreground progress. Only startup/retry snapshots request catalogue/SQL progress. Saves and exports retain foreground progress.
- Foreground progress is a fixed overlay, so it cannot shift page layout.
- Empty desktop pulls update sync status without announcing a data/settings change. Actual committed changes retain table and entity events.
- Queries declare their input tables. The root coalesces events and refreshes only matching queries. Analytics uses these events rather than its one-minute full-report interval. Security rules retain their own periodic verification.
- Web/Android idle ticks do not call the full synchronization pipeline unless there is queued work or the five-minute safety reconciliation is due. Local writes, live events and reconnects retain their immediate wake-ups.
- Electron's protected PIN-only cloud pull has a one-minute safety interval rather than five seconds. Local writes still wake its single worker after 250 ms. PIN-only credentials cannot subscribe to protected Postgres Changes, so removing this fallback would prevent detection of other terminals' changes.
- Committed local sales reads no longer start another synchronization cycle as a side effect.

## Scope and limits

The renderer changes are shared by web, Windows and Android. This does not remove authentication/security checks, connectivity heartbeats or retry requests. Quiet reads still surface failures through existing error handlers. Live notifications are hints; sparse reconciliation remains necessary for interrupted sockets and tables without direct subscriptions. This change does not claim zero network traffic while idle, or instantaneous remote updates for PIN-only Electron terminals. Installed-device observation is still required to verify the reported visual symptom on the user's terminal.

## Verification

Regression tests exercise quiet pending reads, explicit progress cleanup after failures, table-specific query invalidation, and idle/write/reconciliation scheduling. The full unit suite, TypeScript, lint and platform renderer builds are run before submission.
