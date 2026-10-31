# History download reliability — SQL-09 / SQL-11

31 October 2026. Recoverable base: beta `f4fc2207`; diagnostics were integrated
at `62abf346`. This is a scoped correction, not a full-system certification.

## Evidence and approved boundary

An automatic failure at 10:35:55 UTC identified `change_history`, download,
gap recovery, HTTP 503 and a non-JSON response. The local Change Tracking
checkpoint had expired. Separate one-page 100-row probes succeeded; they do not
prove a full recovery or identify the provider's 503 cause. No probe applied rows.

The owner requested a narrow history-download fix and beta publication preparation.
Audit-history branch/GLOBAL visibility corrections remain **pending by owner
decision**. Membership remains on hold. Neither policy is changed by this patch.

## Changes

- Bootstrap/refresh pass the registered table name to the page policy. History
  pages never grow beyond 100. Other tables retain their existing policy.
- Only a privately tagged, non-JSON HTTP 503 can receive two smaller history-page
  retries, after 250/500 ms, using the same cursor. Denials and JSON 503 responses
  are not retried. Persistent errors keep the original failure and pending work.
- Download retries precede local application. No failed page is applied, and no
  Change Tracking baseline is advanced before the entire snapshot succeeds.
- Server redaction reuses two private lookup sets. Rows, fields, masking, table
  context, permissions and management behavior remain identical.
- Private diagnostics log only registered table names, fixed phase/origin enums,
  HTTP status and the non-JSON boolean; no response bodies or credentials.

## Database optimization — separately approved and applied

`20261031105517_change_history_bootstrap_uuid_keyset.sql` replaces only the
inspected history CASE's JSON-text range/order with the existing UUID primary-key
range/order in the seven-argument `pos_sync_bootstrap_scoped` function. It retains
the serialized JSON cursor, rows, current predicates, limits and all function
metadata/ACLs. Unknown contracts abort atomically. The generator and canonical
installer receive the same targeted history-tail change; the full generator is
not replayed against any live database.

SHA256: `893885224E5C5CF0297E4AF8A51C39E14F5C978D57CF2408B1D84C7C2DA3C1FE`.
The owner separately approved this exact migration for ROSEGILL →
rosegill0011@gmail.com's Org (`bjxgimekljzlnwejuawj`) → pos
(`qhrufhtbeguxydenzfey`, database `postgres`),
https://qhrufhtbeguxydenzfey.supabase.co. Applied at 11:04:29 UTC / 19:04:29 Brunei;
live history version `20261031110429`. The deployed definition MD5
`b4306345e37e638c610e8484a479c510` exactly matches the captured old definition with
only the reviewed history tail replaced. Function metadata MD5
`eb2fe1be978f2957607466022359f559` is unchanged; owner/security/config/ACLs are
preserved, with anon/authenticated execution denied and service execution allowed.
No business rows or checkpoints were rewritten. The existing audit visibility
predicate is deliberately unchanged. This is not an audit-isolation correction.

UUID ordering allows the existing index to avoid the old expression sort. A
generic plan may retain the cursor as a filter; a custom/literal plan can use an
index range condition. This is not a promise of a particular live latency or CPU
reduction. The installer retains its existing minimum-100 limit; the captured
deployed routine retains its minimum-10 limit.

## Verification and limits

Agent checks: client five suites/94 tests plus independent repeat; redaction five
suites/55 tests; SQL 32 captured-definition and 32 installer scenarios plus 24
canonical-schema tests. Root combined checks and final revision are recorded in
TASK_TRACKER.md and the beta PR. CI executes the portable SQL test independently.

Fixtures cover lossless 253-row paging, same-cursor retries, exhaustion, denials,
local failure rollback, resumable committed cursors, complete-snapshot baseline
ordering, row/masking parity, real captured scope validators, old JSON cursors,
metadata/ACL preservation, idempotence and unknown-contract rejection. Financial
transactions and live inventory are not created by these tests.

Persistent upstream failures or an oversized minimum page can still stop recovery
safely. Full affected-PC recovery and installed-device acceptance remain separate.
Do not skip history, reset checkpoints, clear queues or bypass the close guard.

## Recovery

Revert only the reviewed source commits through a beta PR; retain sealed device
configuration and pending SQL work. If the database optimization is separately
approved/applied, restore its captured pre-change function definition only after
separate approval and metadata checks. No data restoration is needed for this
routine-only change; never replay the entire schema or an older repository.
