# Shift financial validation plan

Status: design and isolated-test preparation only, 4 November 2026 (Asia/Brunei). Baseline: beta `68470185e574ec06a3a0ce1573e7bb47c70de32e`. No application implementation, migration, live SQL, enrollment, checkpoint change or release is authorized by this document. Exact final database objects, file hashes, target and effects must be presented before application.

## Confirmed decisions and scope

Each ORIGINAL closing and each later RECOUNT validates the financial state at that action's saved point. A later administrator correction may become the single effective closing through existing causal admission; prior original/correction evidence remains immutable. Never validate an older closing against today's mutable sales totals. VARIANCE approval must refer to its accepted reconciliation and cannot silently choose new financial inputs.

Preserve the existing sales-based formula, rounding, recognized tenders, opening float, nullable counted card/digital amounts, permissions and terminal/branch locks. Booking deposits and payment-at-receipt attribution remain a separate task. This plan does not change the refund-paying-shift business rule, reconstruct missing history, rewrite existing amounts or certify every financial workflow.

## Observed source limitations

- `public.shift_expected_totals` in `supabase/schema.sql` and `OperationsRepository.shiftExpectedTotals` in `electron/db/repositories/operations.cjs` sum current, non-refunded sales in the selected shift/branch. Cash split payments deduct change; card and recognized digital tenders remain separate; opening float contributes only to cash.
- `electron/main.cjs` reads expected totals before saving the protected closing graph in a different transaction. A concurrent sale/refund can change inputs between those steps.
- `sync_change_journal` records identity, operation and version rather than immutable financial row images. `electron/sync/push-worker.cjs` ordinarily uploads the current row returned by `reader.rows`. Change Tracking cannot supply expired before-images.
- Current protected shift graphs/signatures prove consistency, causality and authorship. They do not establish the complete authoritative financial input set. Reusing a transport credential or merely signing caller-provided expected totals does not solve this gap.

Isolated reproduction reported by the coordinating agent: an internally consistent forged expected total of 999 was accepted where actual inputs totaled 100; a historical closing of 100 also encounters a current refunded state of 10. These are isolated defect evidence, not live-record repairs or proof that this design has passed acceptance.

Example: an offline sale is followed by an ORIGINAL closing, then refund and RECOUNT. Current-row upload can deliver the refunded sale before the older closing. The original closing and recount need different retained input states. A current-cloud-total check would reject correct historical work.

## Proposed additive metadata (names provisional)

No SQL is supplied or applied by this design. Final schemas require isolated SQL Server/PostgreSQL compatibility, sizing and independent review.

| Location/object | Role and key integrity |
| --- | --- |
| Local `dbo.pos_sync_financial_events` | Append-only exact financial versions captured in the same transaction as the authorized sale/refund/tender correction/delete. Stable event/operation IDs, branch/shift, original terminal/writer stream, per-stream sequence, previous-event hash, affected entity/version and exact canonical financial input or tombstone. A local stream may not claim another terminal's identity. |
| Local `dbo.pos_sync_shift_financial_witnesses` | One immutable companion per existing shift intent ID. Stores formula version, trusted baseline identifier, complete causal frontier, input-set digest, exact expected totals and exact witness bytes/hash. Saved in the SAME SQL transaction as the count/reconciliation/intent. No rewrite of already signed v1 payloads. |
| Cloud `pos_sync_private.financial_event_receipts` | Immutable accepted financial event/version evidence, generated or verified by guarded server writes before mutable current rows are replaced. Contains actual canonical input/hash and verified original context; not merely an unchecked client total. Unique stream sequence and event/operation identity prevent replacement and replay ambiguity. |
| Cloud `pos_sync_private.financial_frontiers` | Server-owned accepted per-writer sequence/head hash plus baseline/scope identity. Tracks contiguous accepted evidence; a gap never advances the frontier. Scope is derived from trusted terminal/session admission. |
| Cloud `pos_sync_private.shift_financial_receipts` | Immutable accepted witness and computed totals bound to intent ID, formula, complete financial frontier and shift graph payload hash. Supports exact no-write replay even after later transactions/corrections. |

A server-generated, complete initial financial baseline is required for a shift with pre-protocol sales. The baseline must enumerate its full authorized input set under a consistent snapshot, persist server-owned identity/hash/frontier and preserve historical versions thereafter. Client-provided counts or a zero queue are not baseline proof. Existing unverifiable historical closings retain their established legacy classification; do not manufacture proof retroactively.

## Trusted causal boundary and completeness

A witness is meaningful only if the server can reconstruct its COMPLETE declared financial state. Proposed boundary: an immutable server-issued shift/branch baseline plus an explicit vector of contiguous, server-accepted writer-stream frontiers, including this terminal's locally committed financial sequence through the action's transaction. The server derives the input set from baseline plus all events through that frontier; it never trusts a caller-selected list of sale IDs to establish completeness. The caller may send a bounded manifest/digest as a consistency check, not as the authority for which sales exist.

New local events must have actual financial write authorization and durable capture. An author signature proves who attested; it does not prove that omitted sale events do not exist. Consequently, all applicable financial writes must atomically participate in the stream/frontier and the same per-shift serialization boundary. Server-originated web corrections need their own server-owned stream. Downloads must preserve original writer/version context and must not reissue downloaded rows as new locally authored events.

Unresolved security/architecture risk: a terminal-controlled sequence cannot prove an event was never omitted before journaling; a renderer-supplied witness cannot create authoritative history. Main-only capture plus signatures narrows this boundary but is not protection against arbitrary privileged SQL/OS tampering. The supported trust model and enforcement point must be explicit and independently reviewed. Unexpected raw writes must produce an unverified state, not an apparently complete frontier.

### Other terminals and offline work

A server cannot know unuploaded changes on an offline second terminal. Wall clocks, SQL row versions, maximum timestamps and a single device's empty queue do not prove global completeness. The causal frontier can establish the state known to that action, not all unobserved real-world activity.

Implementation must distinguish:

1. A causally complete declared snapshot (baseline plus admitted writer frontiers), which can be validated without pretending it includes later or unseen events.
2. A globally complete shift cutoff across all eligible writers, which requires verified writer membership and a cutoff acknowledgement from each writer, or an approved exclusive-writer lease. An unavailable writer prevents that stronger certification.

Do not silently adopt an exclusive terminal rule: the app supports multiple terminals/shift settings. Do not let a terminal choose away an eligible stream. If production requires the stronger global assertion, keep cloud acceptance pending until all required evidence arrives; local checkout and an honestly pending saved local close must continue under existing rules. The owner selected the saved known-data case; global completeness is excluded. Completeness of that declared known snapshot still requires implementation and tests.

## Save and admission sequence

1. Keep existing authentication, current permission, terminal branch and action guards. Do not widen Management or legacy access.
2. In a consistent local transaction, take the shift/financial serialization boundary, resolve complete trusted baseline/frontier, read formula inputs, calculate expected totals and save count/reconciliation/graph plus immutable intent/witness. Every participating financial writer takes the compatible boundary before mutation. Lock ordering and scope must be tested for deadlocks and throughput.
3. Sign a NEW witness protocol/domain binding project, terminal, stable author, branch, shift, intent, graph hash, formula and witness hash. Preserve existing immutable signed payloads and exact accepted replay. Companion metadata may be used, but an unbound sidecar is insufficient.
4. Upload financial events in causal order with durable acknowledgements. Do not substitute the latest mutable sale row for an older event. Missing prerequisites retain pending work and retry normally.
5. On cloud admission, validate trusted scope/author/current permissions and exact replay first; validate event histories/frontiers, derive the complete historical input set and recompute the versioned formula using exact decimal arithmetic. Check expected and variance values before graph writes. Mismatch returns a classified review conflict, not forced recalculation of the signed closing.
6. Commit witness receipt and graph atomically under existing stale-correction protection. Later valid administrator RECOUNT uses its own saved financial frontier and predecessor; it can become effective without deleting the original evidence. A later refund cannot invalidate an already accepted original receipt.
7. Return readback proof bound to exact intent, graph and financial receipt. Keep local pending metadata until that proof is verified. Lost replies replay idempotently without duplicate financial or graph writes.

## Required writer/alias inventory before coding enforcement

This is a minimum inventory, not a claim all aliases are covered. Generate/capture the live and canonical call graph, roles, triggers and grants before final migration preparation.

| Boundary | Paths to trace and cover |
| --- | --- |
| Native POS | `electron/db/repositories/aggregates.cjs`, `operations.cjs`, financial write/stock policy, receipts refund repository, exchange/replacement sales and atomic operation receipts. |
| Native closing | Main original/recount, shift journal/intents, immutable author/start proofs, worker prerequisites, old aggregate/CT uploads and replay. |
| Hosted checkout | `pos_sale_commit`, checkout/relay operations and direct financial insert/upsert paths. Preserve idempotency and stock semantics. |
| Refund/return/exchange | `sale_refund` overloads, native refund and exchange aliases, refund flags/quantity updates and related tender changes. Partial refund behavior needs formula-specific evidence. |
| Administrator corrections | `pos_admin_correct_tender`, bill corrections/missed historical bill, original/replacement bill links and historical shift attribution. |
| Sync | `sync_apply_sales`, `sync_delete_sales`, aggregate, batch, receipt replay, service-only raw write aliases and stale-version short-circuits. Old-client data must not silently manufacture historical versions. |
| Other mutation channels | Authorized direct REST/RLS writes, triggers, maintenance, import, backfill, deletes/tombstones and privileged manual SQL. Unsupported paths must be explicitly unverified or guarded; never assumed absent. |

Only inputs affecting the preserved formula need mathematical derivation, but related transactional rows must remain consistent and retain their existing stock/refund protections. Deposit/payment-ledger accounting is out of this batch.

## Legacy compatibility and rollout

Prepare capability negotiation and schema additions first; no auto enrollment or account/permission changes. Keep checkout, local financial commits and legacy transport available under their current explicit rules. New capable clients must never downgrade a failed witness to legacy acceptance. Missing required metadata is fail-closed for the new validation claim and cloud acceptance of that new protected intent, not silent data loss or a global checkout outage.

Already accepted historical intents remain exact no-write replayable. Existing unsigned/unwitnessed versions cannot be called financially verified. Their compatibility mode and eventual retirement require a separate rollout decision; immediately requiring new witnesses from every older installed client would break pending shift uploads. A baseline does not retrospectively certify earlier closings.

Any operational hold must show the specific missing/changed evidence and retain queue/checkpoints. Do not hide it as success, erase local data, reset Change Tracking or automatically overwrite newer administrator corrections. No business-row repair is included.

## Verification and release criteria

- Exact-decimal formula parity across PostgreSQL, SQL Server and existing JS presentation for single/split cash, change, card, each recognized digital method, zero/null/negative-invalid inputs, rounding and opening float. Preserve existing refund semantics; deposit tests remain separate.
- Actual SQL Server transactions and captured PostgreSQL definitions: sale -> ORIGINAL -> refund -> RECOUNT, all offline before sync; older closing accepted against its own evidence despite newer current rows. Original history retained; newer valid web/terminal correction becomes effective once.
- Missing/duplicated/reordered/cross-branch events, forged frontiers, omitted baseline sales, changed hashes/formula, wrong terminal/author, revoked grant, direct alias bypass, stale graph and accepted-receipt replay.
- Two terminals writing the same shift, one offline; prove declared causal versus global certification distinction. No false global completion or unapproved lease.
- Concurrent checkout/refund/count/correction, deletes, late historical imports, stale-version no-ops, statement failure rollback, deadlock/retry, reconnect and lost acknowledgement. Stock/checkout effects occur once.
- Local metadata migration on existing schema variants; old clients and queued v1 intents preserved; new clients never downgrade. Crash between every save/upload/ack stage retains recoverable evidence.
- Large shifts use bounded streaming/pages and durable manifests without unbounded Worker CPU/body size or omitted records. Server must derive completeness without trusting a truncated client manifest.
- Installed Electron IPC/vault and Android/web applicable paths, isolated upgrade preserving registration/config/pending work, checkout/receipt/offline/reconnect acceptance. Unit mocks and CI alone are insufficient.
- Independent final diff/security review and exact-head CI; then exact migration hashes/objects/privileges/preflight/rollback proposal for the named ROSEGILL project and separate local SQL approval before application. Beta first; production/release approval remains separate.

## Risks and stop conditions

This design is not implementation-ready until authoritative writer membership, complete baseline establishment, event authorization, local/cloud transaction boundaries and legacy transition are demonstrated. A hash chain alone does not establish completeness or financial truth. A current-total comparison, client-selected sale list, unsigned sidecar or one terminal's queue status is not an acceptable shortcut.

No proof can reconstruct missing pre-protocol offline intermediate sale/refund states from current rows alone. Retain those cases for explicit review instead of inventing history. Historical repair, deposit attribution, refund-paying-shift policy, pool settings, Membership, installer publication and production promotion are excluded.

## First local safeguard and isolated prototype

Prepared local transaction guard re-reads unchanged tender totals using the protected save's SERIALIZABLE transaction before writes/signing, rejecting a stale ORIGINAL/RECOUNT draft. Existing accepted replay does not re-read current totals. It requires no schema change and does not establish cloud historical authority. The separate scripts/preparation SQL prototype derives one consistent financial basis and has 17 isolated parity/precision groups. It is not a migration or admission path. The larger historical/capability rollout above remains unresolved and must not be represented as deployed or complete.

## Resolved multi-terminal rule

The owner chose complete SAVED KNOWN-DATA snapshots. FIN62 must not wait for all offline terminals or claim global completeness. At the action, capture the saving terminal's complete trusted known baseline and authorized committed local financial changes. Later other-terminal uploads cannot retroactively change that action. Each later administrator correction captures its own known state. Server-derived baselines plus immutable authorized financial-operation receipts remain necessary to reject unexplained changes or omitted known rows; client hashes alone are not authority. Missing pre-protocol history stays explicitly legacy/unverified, never fabricated.

Native preparation status: scripts/preparation/shift-financial-basis-sqlserver.sql requires SERIALIZABLE input and canonical lowerUUID text order, preserves raw payment JSON, and names its 12-decimal aggregate expectedNativeRaw. Twenty actual isolated SQLServer groups passed. It is NOT the PostgreSQL two-decimal wire total. Shared final monetary canonicalization, evidence binding and admission are still pending. Seven isolated metadata-upgrade groups also passed; candidate025 remains outside automatic migration discovery.
