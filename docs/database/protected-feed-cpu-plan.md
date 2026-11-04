# FEED55: byte-bounded ordinary sync feed

Prepared 4 November 2026. Owner authorization covers preparation and isolated
tests only. No live migration, deployment or publication is authorized here.

## Evidence and cause

The beta Worker logged `exceededCpu`, CPU 418 ms, HTTP 503 on the shared sync
endpoint at 11:54:44 Brunei. Native errors did not identify the individual RPC.
Read-only inspection after local feed cursor 131613 found twenty references to
a current 1,238,098-byte settings row in the next hundred candidate records,
about 24.76 MB before the remaining settings and audit rows. This is evidence
of an oversized ordinary feed workload, not evidence of lost SQL connectivity.
The six local shift Change Tracking checkpoints had independently recovered.

## Proposed behavior

The additive service-only `pos_sync_feed_page_v1` invokes the unchanged
`pos_sync_pull` selector with ten records, preserving its branch, terminal,
catalogue and management admission. It reuses the existing reviewed privacy
projection, validates every source cursor, and returns a contiguous prefix.
The soft bound is 2 MiB; one record may exceed it up to a 5 MiB hard bound.
An oversized singleton fails explicitly without advancing any cursor. Records,
tombstones and null payloads are never skipped or deduplicated.

The Worker validates projection, byte count, row count, conservative continuation,
encoding and complete EOF, then forwards the bounded bytes without parsing or
rebuilding the JSON. It does not trust caller-provided projection settings.
The existing verified device scope determines whether commerce fields are kept.

Native Main attaches continuation evidence privately to the actual response.
Both continuing and final attested pages require safe, strictly increasing
cursors. Partial pages continue until exhausted; checkpoint writes stay in the
existing per-page local transaction. Failed downloads retain their checkpoint.
Headerless old-server behavior is unchanged. Old clients may consume a short
page and safely resume at their next scheduled run.

Only an explicit missing-RPC 404/PGRST202 or exact 400/P0001
`POS_FEED_STREAM_UNSUPPORTED_SOURCE` permits a bounded, project-cached fallback
to the existing guarded path. Authentication failures, timeouts, malformed
responses, protocol failures and 503s never enable fallback. The legacy path
retains its CPU risk; unsupported source definitions need a reviewed pin update.

## Verification and limits

Preparation includes SQL fixtures, actual isolated PostgreSQL/PostgREST wire
checks, native retry/pagination tests, existing privacy and authorization tests,
and an actual workerd harness invoking the guarded endpoint. Synthetic data
is used; no real sale, stock change, key enrollment or permission edit is tested.

Local workerd process CPU: protected 1.97 MB page warm mean 3.906 ms; legacy
equivalent one-record mean 35.156 ms; ten-record mean 416.667 ms. The first
protected request measured 31.25 ms. These are process deltas, not hosted billed
CPU or true cold-start certification. Do not promise that every request is below
the Cloudflare Free 10 ms limit; hosted acceptance is still required.

## Rollout boundary

Exact target for a later approval: ROSEGILL, rosegill0011@gmail.com's Org
(`bjxgimekljzlnwejuawj`), pos (`qhrufhtbeguxydenzfey`), database `postgres`,
https://qhrufhtbeguxydenzfey.supabase.co. Migration:
`20261104040251_protected_byte_bounded_feed_download.sql`.
SHA256: `83495D696622241ECA2A8D396234E2FD65EE7C7A3050E93E4280638D6530D59B`.

Application adds one function/grants only and rewrites no records. Apply only
after exact-project approval, source-definition preflight and final checks.
Deploy separately approved beta code, verify the real feed drains and measure
hosted CPU before production promotion. Never clear queues or reset checkpoints.
Rollback is a scoped code revert restoring the old guarded path; do not restore
the whole database or discard already committed cursor progress. Membership and
its shared dependencies remain unchanged.
