# Retained shift recovery — application integration under verification

Owner approved implementation and isolated tests on 5 November 2026. The
current branch starts beta `5e7327d5`. No production/local database changes,
registration resets, pending-work clearing or publication are authorized by
this document. Membership remains on hold.

## Current implementation checkpoint — 5 November

The missing-cloud-closing path is now wired through the existing Main coordinator:
current Administrator review, exact immutable SQL Server evidence, a separately
signed recovery action using an already enrolled key, SQL Server pending metadata,
and a service-only atomic cloud routine with a complete OPEN graph compare-and-swap.
It never retroactively signs as the original cashier or certifies an unavailable
historical financial snapshot. Ordinary ORIGINAL/RECOUNT/FIN62 guards remain intact.
The review screen sends no branch, reviewer or device-proof authority from UI.

The prepared local schema is outside the automatic installer. If both new pending
metadata tables are absent, old devices keep ordinary sync behavior without new
protocol configuration. Management/non-PC paths skip this initial Operations
recovery flow. Partial schema/failed reads are errors, never false zero. A unique
shift-scope guard prevents repeated reviews from creating two uploads. The existing
safe-close barrier covers evidence and approval saves.

Uploads require the exact private transport receipt, actual accepted typed graph,
full row coverage and unchanged Main source. SQL Server100ns timestamps may undergo
only the reviewed PostgreSQL microsecond conversion; raw evidence stays immutable.
Total HTTP request bytes are bounded to256KiB before pending-event persistence and
again before transport; the server bounds that marked stream before parsing.
Oversize work is held, never truncated. Lost replies retry the same recovery ID;
later authorized corrections preserve the accepted original and effective graph.
ACK writes metadata only, not later local business work or recovery checkpoints.

The runtime adapter tries approved recovery uploads before the expired CT reader,
lets eligible ordinary uploads continue during a held historical review, preserves
source-change denials, and shows unknown counts instead of an old false zero.
The preview's job_id is a capture correlation UUID, not a second JobManager job.
SQL Server is the durable pending store; no browser/file business outbox is added.

Verification so far includes21 actual PostgreSQL cases with existing shift/FIN62
guards and concurrent retries/web closing,20 disposable SQL Server groups,102
focused native status/IPC/service/receipt tests and13 actual React browser groups
at1440/390. These separate runs overlap; they are not a summed total. Full final
integration/CI and installed-device checks remain pending. No live SQL was applied.

Still unfinished: reviewed local adoption of accepted cloud corrections,
receipt-equivalent normalization, all-retained graph coverage through unchanged
ShiftGapRecovery.finish and its captured V0, long-offline full workflow acceptance,
exact live-schema preflight and separate cloud/local application approval. This
draft cannot yet be claimed to clear the affected PC's recovery warning.

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
Main scope checks before and after awaited SQL calls. The Main service is now
wired; the prepared table is not installed on an operator database.

Validation: 12 evidence tests pass with the opt-in uniquely owned LocalDB fixture,
including actual DDL, immutability, concurrent retries, rollback and restart
readback. The fixture never connects to POS_Local. Existing retained-graph
recovery also passes all 16 real isolated SQL Server groups. The regular Vitest
suite invokes portable classifier/evidence safety tests; the actual LocalDB
test remains explicitly opt-in.

The evidence store alone does not persist the captured CT position or authorize
decisions, acceptance, upload or final checkpoint advancement. The dedicated
outbox/service now provides source locks, review and receipt admission; final
adoption/completion is unfinished. Saved evidence alone never proves an upload
occurred or that a retained local change may be discarded.

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
