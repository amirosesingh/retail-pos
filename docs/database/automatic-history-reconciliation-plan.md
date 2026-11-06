# Automatic retained-history reconciliation

Plan recorded from beta `c77beecccac465b48cd7f14c790585374a7e2b7b`.
COUNT80/PR426 is an explicit prerequisite and remains frozen separately. No
runtime code, cloud/local schema, history facts or operator settings have changed.

Root has reviewed and authorized implementation/testing within this plan after
refreshing beta c79893c3. That authorization does not apply the proposed database
changes. Keep the first protocol/RPC checkpoint independently reviewable, then
integrate durable runtime jobs with the remaining checklist visible.

## Controlling owner decision

Every PC must recover automatically after reconnecting. Operators must not run
manual SQL, export UUIDs or execute per-PC seed/repair scripts. A separately
approved central migration can be applied once. Continue using the existing
coordinated sync lane, transactional SQL Server pending work, acknowledged writes,
incremental feed and bounded recovery jobs. Transfer missing/changed facts;
existing matching data must not be repeatedly downloaded or rewritten.

The previous private SELECT-only UUID evidence query is diagnostic preparation,
not the deployment design. It passed13 groups in an owned disposable LocalDB:
target/shape/UUID-PK guards, SNAPSHOT/RCSI, caller isolation preservation, exact
metadata framing and real50,000/10,000 detection caps. Original SQL SHA256 remains
`5EFC5E33D9FC28E951A57009924F65D01A9A532A7FECEB4500F7BEAF57AD809F`.
Those checks did not read POS_Local, prove payload equality or authorize a repair.

## Existing code to reuse, and its limits

- `electron/jobs/lifecycle.cjs` serializes lifecycle work through
  `syncCoordinator.withExclusive`. `reconcileAndRecover()` first tries ordinary
  catch-up, then only small tables whose entire cloud count is at most100. Keep
  that generic safety boundary; the21,019-row history table needs a domain job.
- `electron/sync/history-recovery.cjs` already records scoped recovery in
  `pos_jobs`, saves each committed page, checks a retained CT baseline and resumes
  a failed snapshot. Its current implementation downloads whole history pages and
  advances a push baseline after snapshot completion. Do not relabel that as a
  missing-only index protocol or advance its baseline from a new ID-only proof.
- `electron/jobs/bootstrap.cjs` already wraps local apply and page progress in one
  transaction. `ChangeReader.unacknowledged()` protects durable pending keys;
  ordinary cloud writes carry the existing CLOUD Change Tracking context.
- `JobManager.run()` currently completes a job when its handler returns, so a
  fair resumable quantum needs an explicit pending-step result. A partial quantum
  must never be marked completed. Existing callers must retain their behavior.
- Main already performs periodic automatic reconciliation after a successful
  normal cycle. Resume a history step through that existing coordinator, without
  a second sync timer, overlapping transport or a per-module database pool.
- Live pull and protected feed dispatch already support history. Its AFTER
  history-feed trigger is absent. Current cloud bootstrap/history read scope is
  unchanged; the broader audit-privacy decision remains on hold.

## Proposed read protocol

Add one strictly validated `sqlServerHistoryReconcile` read operation at the
existing sync endpoint. It accepts only this table and reviewed actions, never a
renderer-supplied SQL identifier, privacy flag or authority. Reuse current native
device/session proof, branch admission, Management read scope and trusted
keepCommerce/projection selection. Recheck current authority for each request;
stored progress is not a permission grant.

Two service-only database functions are proposed:

1. `pos_sync_history_index_v1`: begin/continue/finish a bounded UUID enumeration.
   Begin supplies the current maximum UUID as an upper bound; each index page
   returns at most1,000 unique canonical UUIDs in PostgreSQL UUID order, the same
   upper bound, strict next cursor and a scope/projection contract envelope.
   Use the existing UUID index. Return one scalar JSON envelope to avoid the
   PostgREST1,000-result-row cap. Reject unknown/extraneous fields, duplicate IDs,
   nonadvancing cursors, unsafe lengths, scope changes or malformed completeness.
2. `pos_sync_history_rows_v1`: retrieve only the requested absent UUIDs, at most10
   per request, from that admitted history scope. Apply the existing protected
   privacy helper in PostgreSQL and enforce the established2MiB page/5MiB hard
   single-row budget before returning a prefix and continuation. The endpoint
   forwards protected bytes; it must not load large audit JSON into the UI router
   or relax privacy to meet CPU limits.

The new history wire adapter must preserve revision as exact decimal text,
timestamp as an exact offset/UTC string and permitted old/new JSON as lossless
JSON text. Ordinary `JSON.parse`/`JSON.stringify` can round bigint or large JSON
numbers and is insufficient. Use a narrow versioned mapping for the actual15
columns, existing UUID normalization and the existing permitted null semantics.
Validate bounded JSON without converting exact values to JavaScript Number/Date.
No raw audit payload, proof or credential goes to diagnostics.

### Enumeration completion is not count equality

The PC records N actual, unique, strictly increasing IDs read in the fixed upper
UUID range. Every page's admitted IDs must be present locally or explicitly
pending/review-held before that page can be marked resolved. At finish the server
counts the same upper range under unchanged immutable-history guards. Only when
that count equals N does it certify complete enumeration of that range: the N
enumerated immutable members remain a subset of that set. This is different from
comparing two whole-table counts and declaring their contents equal.

An insert behind a previously passed UUID cursor increases that range count.
Repeat the inexpensive index pass automatically, retaining all already inserted
facts; do not redownload their payloads. A smaller count or changed immutability/
scope contract is an actual invariant failure and must not be accepted. New IDs
above the fixed bound belong to the next comparison/live feed. Do not grow a
single pass's bound indefinitely on a busy installation.

Never treat `MAX(sync_change_feed.cursor)` as a commit-order snapshot fence.
Identity allocation can precede another transaction's commit. This recovery does
not advance or reset the ordinary feed cursor. Periodic index verification also
detects missing facts independently of a feed hint/cursor; no claim is made that
this scoped job redesigns ordering for every other table.

## Per-PC durable execution

1. After normal pending uploads and feed catch-up, schedule a history index job
   on a history difference, expired-history recovery or the first protocol
   upgrade check. Also retain a low-frequency jittered integrity check, because
   equal whole-table counts do not prove equal UUID sets. Do not rescan on every
   page render or startup when a current scoped proof remains valid.
2. Bind job metadata to organization, registered/authorized branch, terminal,
   configured project/backend, SQL database GUID/profile and projection version.
   Reuse `pos_jobs` fields, storing a compact versioned cursor within512
   characters and a hash of the trusted scope. No new local table is proposed.
   Recheck the live pool/profile/proof before fetch, apply, progress save and
   after commit. Old v1 snapshot cursors are not interpreted as v2 index cursors.
3. Read one UUID page, then query existing local IDs using parameterized
   OPENJSON against the UUID PK. Fetch only absent IDs. For each bounded row
   response, start a local transaction and recheck absence, current identity and
   pending evidence under appropriate locks. Insert absent facts using the CLOUD
   CT context; never UPDATE/DELETE an existing history row. Save committed job
   progress with the insert. If a row appeared meanwhile, keep it; do not call
   matching UUIDs a payload-equality proof.
4. Advance the index-page cursor only after all IDs in that page are resolved.
   If a network failure happens after some insert commits, re-read that small
   UUID page after restart and skip rows now present; their facts are not fetched
   again. Use existing job row locks/CAS so two local callers cannot independently
   commit the same progress. Lost responses and retries remain idempotent.
5. Each coordinator quantum performs at most one index-page request and one
   bounded row request, with existing request deadlines. Return a truthful
   pending job result and release the lane, allowing ordinary uploads/final shift
   work before another quantum. A SQL transaction never spans a network wait.
   Persist controlled exponential retry timing with per-terminal jitter in the
   existing next_retry_at field; do not change global retry/pool settings.
6. A previously completed, validated same-scope operational cache may stay Ready
   while this history-only job runs. Preserve first-time/incomplete setup,
   restore, different-scope and operational-table gates. Show checking/downloading,
   retrying/offline/paused/review states through existing job/activity status;
   suppress neither a genuine failure nor a pending job as “up to date.”

On short disconnects, normal durable uploads and incremental feed are sufficient.
After long offline periods or feed retention expiry, each PC automatically runs
the bounded comparison from its own durable position. If a comparison proof is
too old/invalid, start a new comparison pass; preserve data, pending uploads and
all business/feed checkpoints. There is no operator SQL step or shared PC cursor.

## Pending local work and authority boundary

Local-only or divergent audit facts are never deleted or overwritten. A pending
journal key holds its affected download; malformed/unverified evidence is retained
for review. An ID-only check does not prove a full authorized payload match, a
real author, an accepted upload or permission to advance the history push CT
checkpoint. The proposed job does not manufacture an ACK or globally rebaseline
expired CT. Continue the existing causal recovery path only with its required
proof; actual unresolved legacy work must remain an explicit in-app review item.

Live native history dispatch references missing apply/delete helpers. This plan
does not add generic mutable writers. If local-only authored facts need uploading,
prepare a separate append-only/current-authority/idempotency adapter using durable
operation evidence. Do not infer an author from a device timestamp or accept a
caller-supplied actor. Most importantly, a missing cloud fact must not be fixed by
silently marking it uploaded.

## Central future-insert correction

Prepare one tightly guarded AFTER INSERT trigger/function using the existing
canonical history event shape: original organization, global read-scope feed,
UUID entity key, ordinary identity cursor, insert/row_version1/non-tombstone.
Preserve the existing BEFORE immutable guard and current service exposure. Do not
modify old history rows, seed all history events, regenerate the whole schema,
change grants/privacy, or add UPDATE/DELETE helpers. Existing missing rows recover
through each PC's index job; no manual per-PC/global exact-ID seed is the final
design. The new RPC/trigger migration is applied centrally only after exact review.

Apply any approved three-product repair before this future trigger: its reviewed
normal effect counts were captured without history feed events. Do not silently
alter that repair or its trigger fingerprints to accommodate a new trigger.

## Proposed implementation files for parent review

| Files | Narrow purpose |
| --- | --- |
| `electron/sync/history-index-recovery.cjs` (new) | Scoped durable quantum, local membership checks and append-only insert/progress transaction |
| `electron/sync/history-index-protocol.cjs` (new) | Strict envelopes, compact progress and exact15-column wire mapping |
| `electron/sync/cloud-client.cjs` | Existing authenticated transport methods for the new history read only |
| `electron/jobs/lifecycle.cjs` and `electron/sync/history-recovery.cjs` | Schedule/resume the domain job without weakening generic small-table or CT guards |
| `electron/jobs/manager.cjs` and `electron/jobs/repository.cjs` | Explicit pending-step result and scoped job/checkpoint/readiness queries; no local DDL |
| `electron/main.cjs` | Existing automatic-cycle integration and truthful recovering-versus-actionable status |
| `src/lib/sync-endpoint.server.ts` | Strict new read operation through the existing proof/branch/projection resolution |
| `src/lib/management-replica.server.ts` | Admit only the new read under existing verified Management scope |
| `src/lib/protected-history-reconciliation.server.ts` (new) | Bounded RPC response validation/forwarding, current authority and privacy checks |
| CLI-created new cloud migration; `supabase/schema.sql`; `scripts/generate-supabase-sync-contract.cjs` | Service-only index/row reads, future-insert trigger and matching preserved canonical source |
| Focused protocol/SQL/PostgREST/native/job/scope/CPU tests plus tracker/memory | Allowed/denied, failure, restart and regression evidence |

If actual transport/status type declarations need another file, report that
concrete dependency before extending implementation. No new renderer IPC write,
auth flow, financial formula, checkout change or local SQL upgrade is proposed.

## Required verification and rollout gates

Test actual captured PostgreSQL and PostgREST definitions, exact privacy parity,
70-table counts, UUID ordering/completeness including over1,000 IDs, concurrent
inserts before/after cursors, bigint/100ns/JSON precision, row/byte bounds and
denied/revoked branch/Management proofs. Test actual native classes plus owned
LocalDB for many independent PCs, empty/already-present/missing/local-only data,
pending/legacy CT uncertainty, restart/lost-ack/network/paused/auth failures,
fair lane yielding and no duplicate update, return upload, checkpoint reset or
loading-loop regression. Measure hosted CPU; do not promise every Free request
will stay below10ms from warm local benchmarks.

No code implementation starts before the parent reviews the concrete contracts
and limits above. No live database change is authorized by this plan. Present the
exact migration(s), SHA256, exact project, metadata effects and compatibility
order separately before application. Merge/deployment/installed acceptance remain
distinct from passing isolated tests. Unknown conflicts require truthful review,
not a claim that hundreds of PCs can never encounter an error.
