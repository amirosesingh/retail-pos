# Management registration and Windows replica

Management devices register without a fixed branch. Branch operations devices retain their assigned branch. A management device is not a staff identity: signing in, viewing pages and making changes still require the user's permissions.

Management phones/tablets also accept active users explicitly granted `can_use_management_mobile`. This grants device sign-in only, not supervisor powers, device settings access or other branches. Existing supervisor defaults remain; an explicit denial is honored. Windows management sign-in retains its administrator/supervisor requirement.

The existing cloud protocol remains: uploads process unacknowledged local changes; downloads request changes after the committed branch checkpoint. Checkpoint numbers are internal bookkeeping, not new document numbers. Successful initial snapshots are not repeated on ordinary sync runs. Windows SQL is the persistent business store; no second browser-storage database is added.

Windows management replication requires an explicitly enabled, claimed PC registration, matching device binding and a separate replica secret. The server stores only the secret's SHA-256 hash. A pairing QR contains that hash, never the secret. A manually issued activation code carries the secret, which must also match the original device binding after claim. The native registration seals the credentials and they are not distributed in sync downloads. A token ID, a QR fingerprint or a null branch alone does not grant all-branch access. Revoked registrations are rejected on every cloud request. Device authority permits downloads only, never staff operations or uploads.

When local SQL is enabled and configured, the native service downloads each server-authorized branch sequentially, even while staff are signed out. Bootstrap jobs and delta checkpoints are durable per branch. Membership remains a separate authorized service. Android/iOS business data remain online-only. Management replication does not enable offline management screens or relax existing local IPC restrictions.

PC QR approval is available from the mobile-terminal management screen too. A scanned PC always creates a PC token. The details distinguish branch operations from all-branch management. Temporary polling failures remain retryable; invalid or revoked claims remain definitive.

Windows without configured/enabled SQL keeps online routing. A configured but disconnected local database is not silently replaced for writes. Reconnection and the existing SQL startup checks remain; repeated local-disconnection notifications share one status notification.

## Deployment

This PR includes `20261020134403_management_terminal_read_replica.sql` and the corresponding standalone schema update. It adds an explicit capability flag and extends only the read validators. Existing tokens default to false; administrators must issue a new management PC registration to enable replication. Existing branch registrations are unchanged.

Apply the migration before deploying code that issues management registrations. It was exercised in a transaction with rollback on the POS project; it has **not been permanently applied** by this task. No local SQL schema migration is introduced.

## Device acceptance

- Phone scans PC QR; administrator chooses Management; PC activates without choosing a branch. Verify displayed backend/device details.
- Register Operations for branch A; attempt branch B sync and confirm refusal.
- Management PC, SQL connected, staff signed out: verify all branches download and subsequent runs use checkpoints.
- Interrupt a bootstrap and restart; verify resume, no duplicate rows and no pending local transactions lost.
- Revoke the management token; confirm downloads stop. Explicit repair/re-registration can retry after a corrected configuration.
- Disable SQL configuration: cloud pages still work. Disconnect configured SQL: local operations pause, one notification, no cloud write fallback. Restore SQL and retry.
- Verify an unauthorized signed-in user cannot view another branch despite the local replica.

Physical phone/Windows SQL acceptance remains necessary; automated mocks are not a substitute for those checks.
