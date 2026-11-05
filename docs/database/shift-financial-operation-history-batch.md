# FIN62 offline history batch — implementation and isolated tests approved

Owner approved this bounded implementation and isolated testing on 4 November. Live database application, deployment and publication remain separate. The scope below is the approved plan, not a claim that every step has been implemented or verified.

## Confirmed problem

The ordinary native upload reader reloads current sales rows. A sale saved offline, then included in an original closing, then refunded before any upload can first reach the cloud as already refunded. The original pre-refund financial state is not present in that cloud row. An opening baseline, a consistent total or a signature over a selected list cannot reconstruct the missing state. Do not invent it, reprice the old closing against the refund, or bypass the existing pending guard.

The proposed correction records the real financial before/after projection when each authorized local action commits. A closing records its position in that immutable sequence. Upload retries use those saved bytes, rather than today's sales row. The cloud validates the sequence and the closing's position while preserving the existing business-write authorization. This proposal does not authorize treating a registered author key as hardware attestation or asserting knowledge of transactions never received by the server.

## Proposed independently reviewable steps

1. Add an immutable, branch/terminal/shift-scoped local financial operation store and additive existing-data SQL upgrade. No backfill of unknown intermediate history. Use per-shift sequence/predecessor hashes and existing real author keys. Only financial projections and proof metadata are stored; stock and sales are not replayed to manufacture evidence.
2. Capture before/after facts in the actual aggregate and separate refund transactions. Record the closing boundary in the protected closing transaction. Keep one lock order, atomic rollback and stable operation receipts. Missing historical evidence remains reviewable and pending.
3. Extend protected upload/read handling to transmit the immutable sequence without changing bytes, skipping entries or clearing pending work before exact acknowledgement. Preserve old accepted receipts and retries.
4. Add service-only cloud admission/version metadata and explicit capability negotiation. Every applicable new financial-write route for an activated terminal must enforce the same rule; merely guarding one RPC leaves a bypass. Do not activate until compatibility and existing pending work are checked. Keep web/Android and legacy behavior explicit rather than silently applying an Electron-only assumption.

## Necessary source scope

- New `electron/db/shift-financial-operations.cjs` and prepared local metadata upgrade.
- Existing `electron/db/repositories/aggregates.cjs`, `electron/db/repositories/receipts.cjs`, `electron/db/shift-sync-journal.cjs` and `electron/main.cjs`: actual transaction/author capture.
- Existing `electron/shift-authority.cjs` and financial proof definitions: only actual action permission checks and binding.
- Existing `electron/sync/change-reader.cjs`, `electron/sync/push-worker.cjs`, `electron/sync/cloud-client.cjs`: frozen sequence transport and acknowledgement.
- Existing `src/lib/sync-endpoint.server.ts`, verification/contract helpers and relevant actual cloud financial-write routines: admission and compatibility.
- Focused unit, actual SQL Server/PostgreSQL, concurrency, API and release-compatibility tests; final migration manifest and task tracker.

Exact final files/objects may only be narrowed or separately reviewed, not expanded silently. This is a larger shared-writer/protocol change than the currently tested optional saved-basis integration.

## Acceptance and recovery

Test offline sale → original closing → refund → recount before first upload, lost acknowledgements, restart, stale/revoked authors, omitted/reordered events, shared-shift branches, concurrent writers, and the actual aggregate/refund entry points. Verify checkout/stock effects occur once, original and correction totals retain their saved state, all branches remain isolated, and legacy accepted history is unchanged. Include cold/warm hosted CPU and bounded response tests.

No live database application, metadata backfill, key enrollment/rotation, operator configuration change, main promotion or installer publication is included in preparation approval. Present the exact final cloud/local objects, hashes, prerequisites, execution sequence and rollback limits before any application. Missing proof cannot be resolved by resetting a checkpoint or rebuilding the local database.
