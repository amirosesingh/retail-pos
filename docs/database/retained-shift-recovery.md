# Retained shift recovery — preparation, not runtime activation

Owner approved implementation and isolated tests on 5 November 2026. The
current branch starts beta `5e7327d5`. No production/local database changes,
registration resets, pending-work clearing or publication are authorized by
this document. Membership remains on hold.

## Confirmed failure

Legacy closings can outlive SQL Server Change Tracking before an immutable
intent/journal/baseline was saved. The upload reader can no longer enumerate
those changes. Download recovery correctly rejects replacing differing retained
graphs, producing a recovery deadlock. An empty queue does not prove that work
was accepted. Restarting and resetting checkpoints cannot reconstruct that proof.

## Implemented foundation

`electron/sync/shift-recovery-classification.cjs` classifies all six complete
registered tables. It preserves decimal tokens, 100 ns timestamp evidence,
NULL tender fields, child identities and branch scope. No financial data from
the affected PC is committed as a test fixture. Real retained legacy NULL
patterns are represented by synthetic regression cases.

The result is a plan only. Every result has `autoApply:false`. Candidate labels
are not database-write authority, an accepted cloud receipt, an original author
signature or a recovery checkpoint. Only `exact` has `needsReview:false` and
the existing runtime must still obtain its own fresh complete equality proof.
Unsupported or mismatched scope fails closed.

Validation: 60 isolated Node 22 classifier tests pass, including precision,
missing/duplicate facts, legacy NULL versus zero, malformed scope, same-child
derived-summary candidates and competing ORIGINAL histories. Long-offline and
lost-ack context tests prove the classifier does not invent authority; they do
NOT verify a complete outbox/reconnect lifecycle.

## Prepared immutable evidence storage

`electron/db/shift-recovery-evidence.cjs` and the prepared SQL file alongside
this document provide append-only, scope-bound capture/list/load. They preserve
the exact raw local/cloud JSON bytes and independent hashes, reject unknown
schema/trigger definitions, bound storage and keep captures distinct from
accepted operations. Capture requires a caller-owned transaction and trusted
Main scope checks before and after awaited SQL calls. Neither the store nor its
prepared table is installed or wired into synchronization.

Validation: 12 evidence tests pass with the opt-in uniquely owned LocalDB fixture,
including actual DDL, immutability, concurrent retries, rollback and restart
readback. The fixture never connects to POS_Local. Existing retained-graph
recovery also passes all 16 real isolated SQL Server groups. The regular Vitest
suite invokes portable classifier/evidence safety tests; the actual LocalDB
test remains explicitly opt-in.

The store does not yet persist the captured CT position or implement decisions,
acceptance, upload, source-graph locks or final checkpoint advancement. Integration
must provide and verify those requirements; saved evidence alone is not proof
that an upload occurred or that a retained local change may be discarded.

## Remaining implementation and acceptance

1. Preserve complete local/cloud exact before-images in dedicated append-only
   recovery evidence, scoped to database GUID, terminal, branch and backend.
   Reuse existing job progress and outbox scheduling, not a second sync engine.
2. Use saved signed intents/accepted receipts where they actually exist. Legacy
   evidence without those proofs needs a current authorized administrator's
   explicit recovery attestation; preserve original actor fields as historical
   claims rather than retroactively signing as the cashier.
3. Recheck cloud state under an atomic compare-and-swap before a missing closing
   is accepted. A concurrent administrator correction must hold the old upload,
   never be replaced because a device timestamp or version is larger.
4. Preserve both histories of competing ORIGINAL counts, with a single effective
   authorized closing. Do not union competing ORIGINAL rows or silently relabel
   them as RECOUNT. Archive/recovery evidence must survive retries and outages.
5. Resume committed progress, refresh proofs after scope/data changes, and advance
   the final recovery checkpoint only when every retained graph is covered.
   Retry transient transport failures; distinguish review-required states from
   actual transfer progress and genuine faults.
6. Verify real isolated SQL rollback, capture races, wrong branch/profile,
   revoked permissions, 90/365-day offline pending survival, lost acknowledgements,
   concurrent correction, resumed downloads and existing checkout regressions.

Any prepared schema file must be reviewed separately and presented with exact
target and change before application. This PR is draft until the complete
runtime flow, tests and beta acceptance are finished. It cannot by itself clear
the affected PC's recovery warning.
