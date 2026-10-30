# POS loading incident — 30 October 2026

Project: ROSEGILL / pos (`qhrufhtbeguxydenzfey`), organization `bjxgimekljzlnwejuawj`.
API: https://qhrufhtbeguxydenzfey.supabase.co

## Verified observations

Log window: 29 October 2026 17:10 to 30 October 2026 17:10 Asia/Brunei (09:10 UTC).

- 388 PostgreSQL statement timeout entries in that window.
- Auth errors include /user, /token and /logout context deadlines and inability of supabase_auth_admin to connect to its local PostgreSQL service.
- Realtime reported database connection queue exhaustion and replication metadata timeouts.
- API Gateway errors include sync-bootstrap 500, REST 503 and Auth 504 responses.
- Read-only database checks are intermittent. One activity snapshot had no table-lock blockers; another showed pg_cron launcher waiting on WALWrite. Transaction age is not proof of continuous wait duration.
- Earlier cumulative query statistics showed sync bootstrap averaging about 3.1 seconds; these statistics are not limited to this log window.

These observations establish real service failures. They do not prove a single CPU, disk, network or project-sizing root cause. Historical errors remain in logs; remediation must be assessed using new requests.

## Corrected application behavior

- Missing offline terminal PIN hash does not consume wrong-PIN attempts.
- Online typed verifier distinguishes invalid, locked and unavailable credentials; the approved additive routine is applied.
- PIN HTTP budget is 30 seconds with no automatic credential replay.
- Transient Auth resume failure preserves only previously verified operator proof; definitive rejection or mismatched identity still clears it.
- Server Auth verification bounds headers/body to eight seconds and classifies malformed responses as unavailable.
- Realtime join catch-up is coalesced while retaining late-join and scope-change recovery.
- Administrator password submission must release busy state on failure and prevent duplicate submissions; profile-query infrastructure errors must not masquerade as permission denial.

## Database rollout

- Product/barcode UUID keyset optimization: applied and readback verified.
- Set-based catalogue SELECT policy: approved, but last successful readback showed helper absent and old policy active. Migration retries failed initializing history because of database connection timeouts. Do not report it applied without catalog verification.
- No stock, prices, ownership, credentials, user grants or financial records were rewritten by these read optimizations.

## Remaining acceptance

Verify new administrator and cashier sign-ins, supervisor data loading, reconnect and Realtime catch-up against a responsive database. Installed Electron/mobile checks remain separate from automated tests. Preserve Membership ON HOLD.

If database-internal connection failures persist, inspect project CPU/memory/disk/WAL metrics or escalate through Supabase support. No project restart, resizing, session termination or infrastructure settings change is approved by this document.

## Follow-up at 17:31 Asia/Brunei
The 17:26:12–17:31:12 window still contained seven PostgreSQL statement timeouts and five Realtime errors, including connection requests dropped after roughly11seconds. Therefore service recovery is not established. A fresh catalog read still showed the old product policy and no new helper. Owner explicitly declined changes to Membership bootstrap dependencies; preserve that boundary.
Both PIN and username server downstream requests now propagate optional login-only deadlines through throttle checks and Auth/database work. Body parsing precedes these budgets. A cancelled request does not prove a remote session write was rolled back, and credential submissions are not automatically repeated.

