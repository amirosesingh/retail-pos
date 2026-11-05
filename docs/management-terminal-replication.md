# Management registration and Windows replica

Reconciled **2026-10-27**, source `1af373f5`. Current owner decisions are in
[PROJECT_MEMORY.md](PROJECT_MEMORY.md); unfinished integration and authority work
is in [TASK_TRACKER.md](TASK_TRACKER.md). Source implementation is not full device
verification. This update applies no migration and changes no device or database.

Management devices register without a fixed branch. Branch operations devices retain their assigned branch. A management device is not a staff identity: signing in, viewing pages and making changes still require the user's permissions.

Management phone/tablet and Windows admission consult the separate
`can_use_management_mobile` / `can_use_management_pc` flags, intentional admin
behavior and legacy supervisor defaults in `management-device-access.ts`.
These are device sign-in controls, not supervisor powers, device-settings access
or another branch's data. Keep them at the bottom of Edit account. Review all
activation/session paths before claiming their policies agree (AUTH-09).

The existing cloud protocol remains: uploads process unacknowledged local changes; downloads request changes after the committed branch checkpoint. Checkpoint numbers are internal bookkeeping, not new document numbers. Successful initial snapshots are not repeated on ordinary sync runs. Windows SQL is the persistent business store; no second browser-storage database is added.

Windows management replication requires an explicitly enabled, claimed PC registration, matching device binding and a separate replica secret. The server stores only the secret's SHA-256 hash. A pairing QR contains that hash, never the secret. A manually issued activation code carries the secret, which must also match the original device binding after claim. The native registration seals the credentials and they are not distributed in sync downloads. A token ID, a QR fingerprint or a null branch alone does not grant all-branch access. The dedicated management-replication proof path checks revocation on its requests; ordinary business-request proof propagation still has the AUTH-01 gap. Device replica authority permits downloads only, never staff operations or uploads.

When local SQL is enabled and configured, the native service downloads each
server-authorized branch sequentially, even while staff are signed out. Bootstrap
jobs and delta checkpoints are durable per branch. Device download authority does
not grant signed-in users access to every row in that physical SQL database.
Membership improvements are **ON HOLD**; Android/iOS business data remain online-only.

Current scope limitation: management discovery presently enumerates all stores,
and the account model principally distinguishes one assigned branch from NULL/all.
An arbitrary configured A+B subset excluding C has not been established. The
owner's desired authorized-scope rule remains binding, but AUTH-03/REP-03 must
resolve the representation and enforcement before claiming subset support.

The owner's requirement is protected offline management reads over the configured
authorized replica. `business:management-report` and a scoped read repository now
exist, but the installed `ipc-privilege.cjs` management block rejects that channel
before its handler (REP-02). This is an unresolved integration defect, not an
approved online-only business rule. Ordinary management local writes remain a
separate authority question; never remove blanket safeguards without narrow checks.

Every requested report branch must have a complete compatible bootstrap. Current
generator semantics treat `historyDays >= 7300` as no history cutoff, but a job
name alone does not prove an older backend used that contract. Validate replica
completeness and account scope rather than showing incomplete totals as final.

PC QR approval is available from the mobile-terminal management screen too. A scanned PC always creates a PC token. The details distinguish branch operations from all-branch management. Temporary polling failures remain retryable; invalid or revoked claims remain definitive.

Windows without configured/enabled SQL keeps online routing. Try configured SQL
during startup. The owner subsequently approved automatic online fallback when
local SQL is unavailable; canonical startup/readiness routing selects the target
without dropping pending or uncertain local work. A permission/business refusal
must not trigger a cloud retry. Reconnect/acknowledgement and affected-device
behavior remain in DATA-03; the earlier explicit-online-recovery-only wording is
superseded. Repeated local-disconnection notices should share one status event.

## Deployment

The original replica change included
`20261020134403_management_terminal_read_replica.sql` and the corresponding schema
update. It adds an explicit capability flag and extends the read validators.
Existing tokens default to false; eligible management registration enables the
replica capability. Operations branch registration remains branch-restricted.

Apply required migrations before compatible clients. The original task recorded
rollback-only validation, not permanent application. That was a historical report,
not a current migration-history check: inspect the linked target's actual history
before a future approved rollout and never replay it based on this paragraph.
This documentation batch applies no Postgres or local SQL migration.

## Device acceptance

- Phone scans PC QR; administrator chooses Management; PC activates without choosing a branch. Verify displayed backend/device details.
- Register Operations for branch A; attempt branch B sync and confirm refusal.
- Management PC, SQL connected, staff signed out: verify only its authorized
  branches download and subsequent runs use checkpoints.
- Interrupt a bootstrap and restart; verify resume, no duplicate rows and no pending local transactions lost.
- Revoke the management token; confirm downloads stop. Explicit repair/re-registration can retry after a corrected configuration.
- In an isolated configuration, verify disabled/unconfigured SQL uses cloud;
  configured SQL is tried first; unavailability selects the approved online
  fallback without duplicating or relabeling pending local work. Restore SQL and
  verify safe acknowledgement/recovery. Do not toggle a production configuration
  merely to run this acceptance scenario.
- Verify an unauthorized signed-in user cannot view another branch despite the local replica.

Physical phone/Windows SQL acceptance remains necessary; automated mocks are not a substitute for those checks.
