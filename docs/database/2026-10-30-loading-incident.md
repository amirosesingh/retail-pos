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

## Measured health-probe delay
Local Inventory HTTP returned200in81ms and local configuration-presence endpoint returned200in146ms. The exact configured public_flags REST probe returned200after11,416ms without consulting staffAuth. This exceeds the old eight-second warm web deadline. The shared probe now uses the configured public key independently of staff Auth and permits15seconds onweb/mobile, preservingdesktopfive-second failover. This addresses false timeout diagnosis; it is not proof cloud query latency is repaired. Generic warnings no longer promise every action will continue offline or be automatically retried.

## Loading recovery follow-up — 30 October 2026
Owner clarified the stuck screen alternates between central-service delay, loading data and restoring connection, including after failure. Independent agents traced each boundary. Implemented IndexedDB Auth open/read/write deadlines (2.5 seconds per operation), late-result fencing and explicit-removal tombstones; no credential rewriting. Initial POS bootstrap has a 60-second deadline, visible stalled/failed recovery and synchronous retry invalidation. A location directory or healthy SQL pool no longer counts as a complete business snapshot. Read identity includes person, backend mode and branch; branch changes retire old reads before publishing the new view. Existing matching confirmed data may remain usable with a warning. Membership reads, grants and checkout mutations are unchanged.
Verification: 563 suites / 3,521 tests passed outside the sandbox, TypeScript, scoped ESLint and diff checks passed. The first sandbox run could not read generated Vitest temporary modules (ENOENT); it is not a passing run. Browser confirmed the current local timeout screen and usable Try again control. No real credential submission, sale, stock adjustment or installed-device acceptance was performed. Preserve the unrelated empty booking migration, restored after the test discovery hold.
Live infrastructure remains degraded: dashboard showed CPU approximately 91–95%, severe memory commitment warning, and an about-to-deplete Disk IO Budget warning (5 MB/s baseline after depletion). These are pressure indicators, not proof of one exclusive cause. Quota restriction banner is dated 21 November and must not be described as a current imposed restriction.
The connector continued to time out. The exact already-approved catalogue policy transaction was submitted once through the ROSEGILL pos SQL editor as a fallback; it remained Running when last observed. A subsequent catalog read timed out. Application/rollback state is UNCONFIRMED, not successfully applied. Query reference: 36802140-949a-47b1-bb5a-cccd02f34360. Do not resubmit until catalog state and any pending execution are checked. Manual SQL editor execution does not establish a migration-history entry. No compute upgrade, project restart, session termination, billing change or extra database repair is authorized.
Recovery: revert only this code batch to the prior commit if needed; do not roll back business records or blindly remove the approved catalogue function/policy. Beta PR update is separate from merge, production and installer publication.

## CPU and production/API incident follow-up — 30 October 2026
At18:26:35 Asia/Brunei the approved readable_catalogue_product_ids helper and products SELECT policy were verified active; anon EXECUTE=false/authenticated=true checked18:27:04. Earlier SQL-editor attempt therefore did commit, despite no final UI result. Migration-history entry is not established by that confirmation. New branch sync helper remains absent at18:42:02; prepared migration is not applied.
Database size268,643,475bytes. Top cumulative query costs are bootstrap7,100,659ms/2303calls, Realtime2,280,665.7ms/155453calls, product reads and delta pull. These counters did not increase between18:27 and18:29 and cannot attribute the current host CPU. No stats reset or diagnostic load test was performed live. Two cron schedules are daily/hourly; no evidence justifies disabling them or dropping unused indexes. Performance advisory reports98 informational unused indexes and two permissive settings write-policy warnings, not a confirmed cause of the outage.
Direct API failure:10:25–10:32UTC logs include873 PGRST002 entries (log entries, not unique user operations), failed schema-cache loads due57014 statement timeout and pool-acquisition failures. Both configured schemas public/graphql_public exist;536public functions observed. Active PostgREST14.5 metadata query SELECT name FROM pg_timezone_names was observed at47 and54seconds in separate snapshots. This is not POS sales computation. Upstream has documented the expensive timezone-cache behavior and removed that dependency in v16; no hosted-service version upgrade has been performed or approved. See https://github.com/PostgREST/postgrest/issues/5100 and https://github.com/PostgREST/postgrest/blob/main/CHANGELOG.md . No single exclusive CPU root cause is proven.
Latest-ten-minute CPU chart had no data; do not interpret an older91–95% dashboard/summary as a reliable instantaneous CPU measurement or claim a new3.21% reading proves recovery. Memory sample18:27 showed1.46GB commitment with severe warning on Nano/up-to0.5GB RAM. IO warning banner persists; Infrastructure's displayed IO balance98% uses another summary window and does not establish current throttling. Avoid claims disk budget is exhausted. Current cloud/API slowness is distinct from local preview speed.
Owner approved preparation/tests ONLY for20261030102943_optimize_branch_catalogue_sync_reads.sql after automatic review rejected its first preparation attempt. It adds a service-only explicit-branch catalogue-ID helper and changes only product/barcode bootstrap/count predicates. Eight isolated PostgreSQL equivalence/denial/idempotence/plan scenarios passed independently twice. Terminal validator fixture is a stub; tests preserve call/guard placement but do not certify actual deployed terminal authorization. Complete branch-ID set is computed per page, with no production-scale CPU reduction claim. This migration needs separate exact live-project application approval.
Client amplification correction: resolve an unknown branch before full initial data read; foreground and sparse reconciliation wait for matching initial snapshot; simultaneous full refreshes share exact person/mode/branch/generation work only, with no persistent result cache. Pending broad invalidations survive bootstrap for one catch-up. Late branch results remain fenced. Checkout, Membership dependencies and grants unchanged. Regression563suites/3526tests passed with2workers, TypeScript/scopedlint passed; an earlier full run had only private-key-scan timeout, its isolated rerun passed before the full passing rerun. Unrelated empty booking draft restored. Rollback client batch with its own Git revert; do not rewrite business records.
Owner approved ONE controlled restart of ROSEGILL pos and subsequently renewed request after app update. Browser control disappeared before the restart submission; no restart was triggered by the agent. Connector exposes no restart action. Do not substitute pause/restore, OS shutdown or session killing. Database postmaster18:42:02 still reports started26October09:04:12UTC. Owner handoff required if browser remains unavailable; approval persists but must not trigger a second restart if owner already performs it.
Latest local server restarted from exact beta feature checkout with .env.local and HMR; Inventory HTTP200 confirmed. Direct public Data API health read atapproximately18:42 returned503 in9642ms; Auth health200 in430ms. Management status ACTIVE_HEALTHY is not Data API recovery or proof password/PIN sign-in works. Production and preview share this failing Data API. No live business rows, credentials, permissions, billing or project sizing changed in this follow-up.

## Authentication-first verification after owner restart
The owner confirmed restart completion and asked to resolve Authentication first, keeping other work pending. PostgreSQL startup is verified at 2026-10-30 10:48:29.717085 UTC (18:48:29 Asia/Brunei). Early shutdown/hot-standby refusal messages were restart transitions; no second restart was performed.

At 19:01:52 Brunei, `supabase_auth_admin` could log in, had no expiry and no role connection limit, and retained schema usage plus users/refresh-token CRUD privileges. PostgreSQL listens on IPv4 and IPv6 port 5432. The sample contained six client connections against a maximum of 60; no observed password-authentication, insufficient-privilege or connection-cap error justifies credential/grant changes. These checks do not prove the internal connection path is healthy.

The 18:51:41–19:01:41 Brunei log window still contained eight Auth request-timeout entries and four database lookup/connectivity failures, most recently at 19:00:39. The owner's supplied failures explicitly show Auth failing to connect to its own localhost IPv6 PostgreSQL endpoint as supabase_auth_admin. Plugin account authorization is separate from SQL completion; successful connector authentication does not prevent database connection or statement timeouts.

Independent service audit for 18:48:29–18:53:41 Brunei: Realtime recovered, replication resumed and health checks returned 200. Storage had 19 successful health checks and two aborted health requests. Auth refresh requests still timed out. Do not describe all services as currently failed based solely on old counters. A sampled management advisory query was long-running but finished before a later check; no session was cancelled.

PostgreSQL 57014 means statement timeout; 08006 and broken pipes indicate connection loss; 08P01/SSL EOF indicates protocol/connection interruption, not proof of a certificate validation defect. Code 00000 and checkpoints are informational. Supabase's own migration-history and internal credential lookup queries were slow, independently of POS sales/catalogue calculations. JIT is off, auto_explain.log_analyze is off, nested logging is off and auto_explain only logs statements over 10 seconds; no evidence warrants disabling diagnostics or TLS. System catalogue statistics exist and no severe catalogue bloat was demonstrated.

Both website shells responded: local Inventory 200 in 117ms; production homepage 200 in 734ms. Those do not establish signed-in data loading. Windows visual inspection stopped because the tool could not verify the current browser URL; no further UI input followed. Fresh CPU verification is unavailable: Metrics API refused the configured credential, and backend-User-Agent checks were inconclusive/unavailable, so this is not proof the app's server key is invalid. Do not rotate credentials based on that result.

Application corrections: bounded transient-only startup recovery on fresh successful health, at least 30 seconds between failed-read recovery and no more than two automatic attempts per person/mode/branch identity. Permission/account/schema-contract denials remain manual. Reconnect urgency now survives focus debounce. Location-directory error wrapping preserves typed code/status so infrastructure failures and denials stay distinct. Public health never grants authentication or marks an absent business snapshot ready. Membership dependencies remain unchanged.

Verification: 563 suites / 3,534 tests, TypeScript, scoped ESLint and independent review passed. The exact previously failed Node CI group passed 78/78 after its stale immediate-callback assertion was updated to verify the intended 250ms coalescing, branch/logout cancellation and stale-channel rejection. No application behavior was changed by that test correction. An unrelated empty booking migration was restored after test discovery hold.

Live Authentication and Data API recovery remain unverified. The prepared branch-sync SQL migration has not been applied. The confirmed remaining issue requires investigation of the hosted Supabase service/database responsiveness; do not widen RLS, rewrite auth grants, change PINs or disable TLS as a speculative workaround. No additional restart, infrastructure upgrade or billing change is authorized by this checkpoint.
