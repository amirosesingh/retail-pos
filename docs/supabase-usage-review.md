# POS traffic review — 20 October 2026

Scope: the beta code and the POS project `qhrufhtbeguxydenzfey`. No logging settings, production deployments, installer releases or retained audit records were changed.

## Evidence and likely contributors

| Finding | Evidence | Interpretation |
|---|---|---|
| Report history was scanned from newest bills on every reconciliation | `use-report-sales.ts` repeatedly calls `loadSalesPage`; date filtering previously occurred after download | Likely a large payload contributor for older/long date ranges. Now cloud reads include the date bounds. |
| Identical Postgres subscriptions created distinct channels | `owned-postgres-subscription.ts` created a UUID channel per consumer | Confirmed duplication when multiple consumers use the same client/topic/filter. Now reference-counted with independent cleanup. |
| Background health/settings timers ran while hidden | Connectivity timer every 20 seconds; settings every minute | Confirmed unnecessary background probes. Hidden timers now skip these reads; foreground recovery and actual settings events remain. |
| Replica bootstrap is large | Windows snapshots page through registered tables; management requests all branches | Expected initial cost, not an error. Durable completed jobs and branch-specific delta checkpoints prevent repeated successful bootstraps. Interrupted jobs resume. |
| Session/revocation checks are frequent | Authentication code and query counters | Security-sensitive; deliberately unchanged. |
| Five-second sync-summary timer | `sync-summary.ts` reads memory/local state | Not a Supabase request; changing it would not reduce egress. |

One read-only `pg_stat_statements` aggregate returned these cumulative call counts: health/flags 53,255; sessions 44,276; delta sync 20,629; sales/reporting 5,228; approvals 4,087; counts 574; bootstrap 482. Other statements accounted for 2,041,032 calls. Categories use query-text matching, not a complete attribution model. The counters' reset period was not established; these are **not daily counts**. JSON RPC responses can count as one returned SQL row regardless of payload size, so row counts cannot establish bytes or rank egress reliably.

## Changes and freshness

- Reports pass their existing timezone-derived date bounds to cloud queries. Local SQL paging and client-side date/branch validation remain. Full report reconciliation falls back every five minutes instead of every minute; sales events still trigger it promptly, with existing burst batching.
- Shared Realtime subscriptions retain exact topic, client and branch/person filter isolation. Last-consumer cleanup removes the channel. No public/private access changes.
- Foreground focus/visibility/native-resume bursts coalesce into one refresh after 150 ms. Table-tagged queries and stock-count records retain change-triggered updates, with five-minute fallback reconciliation. Stock-count refresh requests serialize; existing row reconciliation retains unchanged references.
- Hidden connectivity/settings polling pauses. Foreground network checks resume automatically. Sales uploads and authentication/revocation intervals are unchanged.
- Read retries retain the two-retry cap and permanent-error exclusions, with jitter to avoid synchronized retry bursts.
- Management replica failures use capped backoff. Invalid/revoked identity failures stop cloud requests until registration or explicit SQL repair resets the retry state. No failed checkpoint is advanced.
- Management POS replication skips the separate membership request, which has no signed-in authority in this path.
- Realtime diagnostics settle once and handle rejected cleanup; they cannot record repeated completion errors for one probe.
- Windows disconnected-local-SQL notifications use one stable notification ID. This does not suppress unrelated cloud, permission or business validation failures.

Existing query caching, in-flight routed-read sharing, paginated lists, settings cache and delta cursors remain. No new business-data cache or offline database was added on phones. No image/download privacy or bucket policy was changed; no repeated Supabase Storage download loop was found in the inspected application paths. Asset size and cache-hit rates remain measurement follow-ups, not claimed savings.

This is not a claim that every page now fetches individual changed columns. Some legacy pages still re-read their scoped list on changes, and security/session checks intentionally remain periodic. Removing those reads requires complete insert/update/delete invalidation coverage; stale account authority must never be cached to reduce traffic. Native cloud sync retains its existing pending-upload/checkpoint-download protocol.

## Logs

Read-only settings inspection: `log_statement=ddl`, `log_min_error_statement=error`, `log_min_duration_statement=-1`, connection/disconnection logging off, duration logging off, `pgaudit.log=none`, parameter logging off.

These settings do not log every ordinary SELECT. Keep DDL/error/security visibility; no database logging reduction is proposed on this evidence. Application audit tables are business records, distinct from platform log ingestion.

Repository searches of `src`, `scripts`, and `.github` found no scheduled Supabase Logs Query API/Logflare scanner. External dashboards, account integrations and log drains were not exhaustively inventoried. Do not attribute their usage to POS reads without evidence.

## Before/after comparison

1. In Supabase Usage select **this project**, record daily Database, Auth, Realtime and Storage egress separately for seven comparable days before and after beta rollout.
2. Record Logs Ingest and Logs Query separately. Ordinary SQL/REST traffic is not the Logs Query metric.
3. Record active terminal-hours, sales volume, new registrations/bootstrap downloads, releases and manual log investigations. Initial management full-branch downloads can temporarily increase egress.
4. Compare bytes per active terminal-hour and per sale alongside absolute totals. Check report completeness and foreground recovery latency.
5. For investigating an error, query only the relevant service and a short incident window (for example 15 minutes), with a bounded result count. Avoid broad recurring scans; a LIMIT alone is not a time filter.
6. Do not reset production statistics or claim percentage savings until comparable measurements exist.

Reference: [Supabase egress measurement and optimization](https://supabase.com/docs/guides/platform/manage-your-usage/egress).

## Follow-up audit and fixes

Report caches for analytics, stock adjustments and receiving history now include the session generation, user, permission matrix, runtime database URL and database mode, in addition to their branch/date filters. Cached values are kept in memory for five minutes. An invalidated report refreshes on reopening; existing table-change invalidation remains. No persistent business cache was added to browsers or phones.

Shift-session history, terminal lists and telemetry use the shared change feed with serialized, burst-batched refreshes and hidden-page suppression. Telemetry and terminal availability keep their one-minute fallback; verification logs retain their 30-second fallback because membership uses a separate backend. Initial loads and explicit actions still read immediately. Local clocks, pairing-claim polling, pending sales uploads and authorization/revocation checks are not treated as wasteful data refreshes.

Fixed a reconciliation bug where an optional field removed from a new snapshot could remain in the old cached object. Unchanged rows/fields still retain references.

### Measured usage baseline

On 20 October 2026, the Studio Usage page filtered to `qhrufhtbeguxydenzfey` showed the billing period 30 September–31 October:

| Metric | POS project total so far |
|---|---:|
| Egress | 8.337 GB |
| Log ingestion | 2.556 GB |
| Log query scanning | 458.072 GB |
| Realtime messages | 26,966 |
| Realtime peak connections | 7 |
| Storage size / cached egress | 0 GB / 0 GB |

The organization page showed 8.337 GB egress against 5 GB included. The page marks the log metrics as upcoming, with enforcement/billing changes after their grace period. Do not confuse a displayed log allowance with an already charged overage. Code changes do not reverse accumulated usage; review capacity separately if the existing allowance cannot support normal operation.

Zero Supabase cached egress does not mean the app has no React memory cache. These are different measurements. Storage is not an evidenced major contributor here. The service-specific egress split and individual endpoint bytes remain unmeasured.

A narrow, read-only statement-statistics aggregate identified settings-related statements as a contributor worth profiling: 67,685 cumulative calls, 2,991,426.50 ms total execution. Sync: 24,471 calls; terminal-related: 114,004; session-related: 106,055. These are heuristic query-text categories with an unknown reset period, not daily HTTP requests or bytes. They cannot prove which endpoint caused the measured egress.

### Database recommendations, not applied changes

The performance advisor returned:

- Four foreign keys without covering indexes: three in the legacy `admin_portal` activation tables and `pos_private.approval_tokens.terminal_id`. Check query plans and actual join/delete workload before adding indexes. [Advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).
- Two multiple-permissive-policy warnings on `settings_scoped`, for INSERT and UPDATE. Personal settings and POS-field policies have separate purposes; any consolidation must preserve their OR semantics and authorization tests. This warning does not establish a data leak. [Advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies).
- 84 indexes unused in the current statistics. Keep them until representative workload and statistics reset dates are established; rare reports and foreign-key maintenance may need them. [Advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

Logging settings were rechecked read-only and are unchanged. No indexes, RLS policies, quotas, billing settings, audit records or live schema were modified during this follow-up. No automated Logs Query scanner was found in the inspected repository; Studio investigations and external integrations remain attribution candidates, not proven culprits.

### Settings and remaining timer audit

Settings home renders navigation only. Payment methods, verification gateway, hardware and terminal panels mount through their own routes; System settings conditionally mounts only the selected system/logic/security/inheritance tab. These details are already demand-loaded, not fetched for every settings tile. Public flags reuse their existing shared in-flight request and cache. Current-terminal's 15-second timer reads local configuration/status only; dashboard/day, session-age and token countdown timers are not database downloads.

The audit found an additional hidden-page reader in the global branch-settings provider. Both branch settings and shared operational settings now batch change bursts (100 ms), serialize reads, pause background polling and hints while hidden, and coalesce focus/visibility/native-resume catch-up. Their one-minute foreground fallback remains: tax, pricing and other operational settings must stay current even outside Settings. Initial scope confirmation remains immediate and preserves edits/revision guards; a change arriving during that read queues another pass. SQL-backed settings still refresh without internet.

Coverage and intentional exceptions:

| Area | Policy |
|---|---|
| Report query caches | Scoped memory cache, table invalidation, five-minute stale fallback; retain branch/date/user identity |
| Page refresh subscriptions | Shared lifecycle, hidden suppression and serialized/batched changes |
| Settings detail panels | Open-page/open-tab loads and explicit actions; no eager mounting of all panels |
| Operational settings | Needed across the app; immediate initial scope, change hints, one-minute visible fallback |
| Activity/security status | Hidden-page suppression retained; visible alert polling is intentional |
| Session authority, approval expiry, terminal pairing | Security/interaction timers retained; never treat a cached role as current authorization |
| Native pending uploads and checkpoint downloads | Existing durable sync protocol retained; independent of whether a page is visible |

This is shared infrastructure coverage, not a claim that every legacy list is a per-column delta API. Scoped list refreshes remain where complete record-level invalidation is unavailable. Tests cover hidden settings, offline SQL, sign-out suppression, burst serialization, initial-read races and cleanup. No settings values, database routing, permissions or persistence formats changed in this final pass.

### Remaining acceptance limits

Automated tests exercise query isolation, burst coalescing, hidden/resume behavior, row deletion and sync safeguards. They cannot establish physical QR scanning, real Windows SQL recovery or every native device's network behavior. No signed-in POS browser session was available during this follow-up. These device checks and before/after daily byte measurements remain deployment acceptance work, not claimed complete.
