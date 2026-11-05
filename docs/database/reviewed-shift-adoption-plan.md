# Retained closing adoption prototype — not activated

The application upload batch records an Administrator's review of an old local
closing and obtains a verified cloud receipt. That acknowledgement alone cannot
clear expired Change Tracking: the local six-table projection may still differ
from the accepted cloud graph, especially at SQL Server's seventh timestamp digit.

This separate prototype prepares that final local convergence step. No Main,
IPC, scheduler or installer imports it. No operator SQL or cloud data was changed.

## Decisions and evidence

`ReviewedShiftAdoption.prepareAdmin` requires the existing Main-private current
Administrator authority and a reason. It permits choosing the accepted cloud
projection while retaining the complete original local graph in append-only
evidence. A competing local ORIGINAL is never relabelled as a RECOUNT or unioned
with another ORIGINAL. Only changed/absent effective rows and required foreign-key
dependants are replaced; identical records remain untouched.

`prepareReceipt` is narrower: it requires a fresh Main-private server-acceptance
witness, the exact frozen local source, its immutable stored acknowledgement and
the current cloud graph. Accepted immutable count/reconciliation/event history
must remain present. This can normalize the approved SQL Server/PostgreSQL
timestamp representation and adopt proven later cloud evolution. Timestamps and
row versions independently choose no winner.

The prototype adds one prepared-only append-only table,
`dbo.pos_shift_recovery_adoptions`, linked to the existing immutable before-image.
It stores the reviewer/reason, mode, exact target graph, source/target/after hashes,
captured CT position and optional original receipt. It grants no permission and
cannot authorize a later replay without fresh Main authority or a private receipt.

## Transaction and pending-work rules

- Fetch the complete authorized cloud graph before opening SQL locks.
- Use one caller-owned SERIALIZABLE transaction and verified database GUID,
  branch, terminal, backend and current Administrator context.
- Re-read all six local tables and compare every registered field with the raw
  before-image. Changed local work invalidates the decision.
- Keep relevant closing journal entries, unattributed/deleted closing keys,
  pending shift intents and unacknowledged legacy recovery events. Relevant
  financial/sale journal entries also block; a known unrelated sale does not.
- Protected FIN62 histories remain on their existing convergence path. This
  prototype does not replace their origins, signed actions or saved snapshots.
- Preserve exact numeric tokens and timestamps through typed SQL assignment.
  Verify the complete resulting graph before committing its decision record.
- Preserve both histories in immutable evidence. Rollback restores every effective
  row and metadata change if any guard or readback fails.
- Do not clear queues, reset registration or alter checkpoints. An OPEN precision
  decision creates no closing baseline.

After adoption commits, start a new existing `ShiftGapRecovery.begin()` and
re-prove every retained graph. Its unchanged `finish()` may advance only the
captured V0 after complete committed coverage. A later local edit still blocks it.

## Verification and remaining blocker

An owned disposable LocalDB fixture has exercised Administrator selection,
competing ORIGINAL archival, exact decimal(38,12) storage, raw seventh-digit
retention, private-receipt normalization, pending work, unchanged records,
rollback, OPEN handling and all-six-table captured-V0 recovery. None of these
checks used POS_Local or production records.

The earlier ordinary note-update regression exposed parsed-number binding in
`applyShiftGraphs`: it attempted to replace
`1234567890.123456789012` with `1234567890.123456716537`. Its readback rejected that
write with `ESYNC_APPLY_DEFERRED`, and the fixture transaction rolled back.
The owner subsequently approved exact-witness binding/comparison/readback and
baseline serialization in the two existing shared writers. That correction now
passes the ordinary note-update case without rounding; its authorization,
pending-work, immutable-history, no-delete and no-witness legacy guards remain.

Independent review corrected two additional prototype guards: OPEN adoption now
permits only exact timestamps or bounded SQL100ns-to-PostgreSQL-microsecond
conversion, and all three actual SQL CHECK definitions must match. Same-name
CHECK(1=1), six invalid OPEN timestamp cases and relevant pending work are denied
before projection writes. The complete disposable SQL fixture now passes40 groups,
including six-table gap completion and the later ordinary delta. The exact-writer
focused run passes53 tests; the separate prototype authority tests remain part of
their recorded coverage. Independent review reproduced40 SQL groups and29 focused
tests without a blocker. Final full-suite and installed acceptance remain pending.

Still required: final integrated tests, exact-file/database
approval, runtime integration and actual device acceptance. Replay of an existing
decision is historical no-write evidence, not proof of current convergence; fresh
unchanged gap recovery must still prove every retained graph. No production-ready
or recovered-device claim follows from this prototype.
