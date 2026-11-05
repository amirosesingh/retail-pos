# What each shell can do

One codebase has web, mobile and Windows shells (Android and iOS mobile targets).
This table is the reference to check before
shipping anything that touches hardware, storage or updates, so a change does
not silently land on one platform only.

Reconciled 2026-10-27, source `1af373f5`. Read [project memory](PROJECT_MEMORY.md)
and [current tasks](TASK_TRACKER.md). Entries describe source capabilities, not
certification of every phone, OS, printer or installed build. Membership is on hold.

| Capability | Browser | Android | iOS | Windows till |
| --- | --- | --- | --- | --- |
| Sells offline against a local database | no | no | no | yes, with ready configured SQL Server |
| Direct attached thermal printing / drawer bridge | no | no | no | yes; physical acceptance required |
| Camera barcode scanning | yes | yes | mobile capability; device acceptance required | yes, with a webcam |
| Staff PIN sign-in | no | yes | mobile capability; device acceptance required | yes |
| Native terminal activation / recovery | no | yes | mobile capability; device acceptance required | yes |
| Native sealed secrets | no native vault | Keystore | native secure storage | DPAPI |
| New app code without reinstalling | page reload | compatible signed bundle update | compatible signed OTA; see iOS runbook | no, installer required |
| Native window chrome | no | no | no | yes |

Source of truth in code: `src/platform-config/features.ts`.
Platform build aliases select native versus empty web implementations; a stub
in the web platform folder is not proof the native capability is absent.
See [iOS OTA](ios-ota.md) for signing/build compatibility and physical limits.

Operations terminals on either native platform remain branch-locked for all roles.
Management admission never grants all branches. Windows management replication
exists, but its offline report IPC integration is currently blocked (REP-02).
Do not equate a complete replica, a SQL-ready state and authorized user access.

## POS operating parity audit

The rows below preserve historical automated/source evidence. Their original
"Verified" labels do not certify source `1af373f5` against the new eight-case
terminal matrix or the current AUTH/FIN/SET findings. Use TASK_TRACKER.md for
current status and record revision/environment/commands before a new pass claim.

This is the implementation checklist for workflows that must survive a Windows
till losing its connection. “Offline” means Electron with its configured local
SQL Server; a plain browser deliberately remains cloud-only.

| Feature | Online support | Electron offline support | Sync required | Status |
| --- | --- | --- | --- | --- |
| Login / session | Central staff and cashier verification | Cached, enrolled staff can sign in; session survives app restart | Staff/role refresh when connected | Verified in automated local-login and session tests |
| Terminal identity | Activation registry and server proof | DPAPI-sealed activation and stable terminal id | Heartbeat / revocation check | Verified; heartbeat identity now matches the registry row |
| Branch identity | Central store relationship | Activation-bound branch and cached store row | Store catalogue pull | Verified; user-facing monitoring/session screens resolve names |
| Shift open | Central commit | Atomic local shift write | Bidirectional `shifts` sync | Verified |
| Shift close / variance | Server reconciliation closes on every valid count | Atomic local count, reconciliation, close events and alert | Counts/events/reconciliation/alert sync as one operation | Verified; variance never blocks closure |
| Sales and sale lines | Transactional central RPC | Atomic local operation journal | Idempotent push, dependency ordered | Verified by checkout and retry tests |
| Payments | Central payment transaction | Stored with local sale | Idempotent transaction ids | Verified; posted tender correction is permission-gated and audited |
| Cash movement / drawer | Central drawer event | Local append-only event | Branch-scoped push | Verified for no-sale drawer events; cash movement amounts are derived from recorded tenders |
| Receipt data / reprint | Central sales history | Local sale, lines, shift and store cache | Bidirectional operational sync | Verified in repository tests; printer hardware still needs field acceptance |
| Variance alerts | Existing activity/variance alert feeds | Local variance alert and activity event are committed with close | Queued with the close operation | Verified; alert includes branch, terminal, staff and financial context |
| Telemetry heartbeat | Upsert by registered terminal | Electron main-process heartbeat is independent of login | Network required to publish | Verified; stale health is heartbeat-based, login shown separately |
| Telemetry history | Central `offline_sync_audit_log` | Local sync audit ledger | Sync audit rows upload | Verified; admin cleanup deletes history only |
| Pending work / retry | Immediate central acknowledgement | Durable SQL Change Tracking and operation journal | Automatic retry with stable ids | Verified by retry/failure-injection tests |
| Conflict handling | Version/idempotency policies | Conflicts retained in `sync_conflicts` | Admin resolves held conflicts | Verified structurally; multi-device destructive field testing remains |
| Restart / interruption recovery | Server remains authoritative | Checkpoints, journal and pending rows survive Electron restart | Resume push/pull from checkpoints | Verified in automated recovery tests |

The generated per-table detail remains in `docs/audit/sync-coverage.md`; rerun
`npm run audit:sync` whenever the registry or ownership rules change.

## Rules that follow from this

- The revocation check (`src/lib/use-revocation-check.ts`) runs in the single
  shared `AppShell`, so all three shells inherit it. Do not add a
  platform-specific copy.
- A revoked or deleted terminal must erase its saved activation. On Windows
  this goes through the `terminal:clear` channel, which is deliberately open to
  any signed-in level — a cashier, or nobody, must be able to trigger it.
- The till only gets new code inside an installer. Anything that must reach the
  field needs a release build; verifying it in the browser preview is not
  evidence that a till has it.
