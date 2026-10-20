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
