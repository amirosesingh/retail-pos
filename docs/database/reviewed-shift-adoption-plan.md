# Prepared retained closing recovery — not activated

The application upload batch records an Administrator's review of an old local
closing and obtains a verified cloud receipt. That acknowledgement alone cannot
clear expired Change Tracking: the local six-table projection may still differ
from the accepted cloud graph, especially at SQL Server's seventh timestamp digit.

The current draft wires that local convergence step through the existing Main,
IPC, startup review and sync coordinator. Its prepared metadata is not installed
automatically. No operator SQL or cloud data was changed by this preparation.

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
re-prove every retained graph. Its `finish()` may advance only the
captured V0 after complete committed coverage. A later local edit still blocks it.

## Exact reviewed Change Tracking coverage

Only a retained graph in the existing exact gap-recovery path can request this
optional Main capability. Ordinary uploads/downloads retain their existing
pending-change rules. A bounded read-only hint avoids replaying accepted events
for graphs without an uncovered local edit. Network proof preparation occurs
before the local download transaction; a second SQL connection verifies that
the caller released its locks during receipt replay.

The capability comes from either the real current POS Administrator's explicit
review/reason in the normal review UI, or a fresh private server receipt for the
same original signed recovery event. Persisted JSON and immutable adoption rows
alone grant no authority. Administrator capability is process/session-bound;
after restart an exact matching graph requires a new explicit review and a new
immutable decision. The prepared identity index therefore ends in decision_id;
the primary key still enforces exact replay of one decision.

Within the existing SERIALIZABLE download transaction, recovery verifies the
actual database GUID, live backend/profile/terminal/branch/session, exact metadata
schema, immutable before/target/after hashes, original event/ACK when applicable,
all six locked tables, pending journals/intents and protected FIN62 histories.
Every registered value must exactly match the fresh lossless cloud graph.
Coverage applies only to attributed, nondeleted keys whose raw SQL bigint CT
version is at or before that decision's captured position. Later, deleted,
unknown, divergent or unverified work remains held. No business row, baseline,
journal acknowledgement or checkpoint is written by this coverage check.
Repeated explicit matching reviews preserve an already identical baseline's
generation and every business value.

Actual SQL verification completes all six captured-V0 recovery passes and
exercises stale authority, wrong scope/transaction, schema/pending/FIN62 holds,
later identical edits and concurrent locking.

Restart after receipt normalization followed by a later accepted web correction
uses one narrow causal continuation. A fresh private receipt must independently
prove that the locked local graph equals its original accepted_graph_text across
all six tables. The original signed event/ACK, immutable prior source/after-image,
exact scope and CT bounds are rechecked; later non-CLOUD, deleted, unknown or
expired history holds. Existing normalization then archives that accepted local
before-image and the current verified web graph in a new immutable decision.
An unsigned row or stored receipt cannot certify an arbitrary historical target.
A broader intermediate web after-image without independent server evidence stays
held for a new explicit Administrator comparison/reason; this protocol does not
invent a historical signature or use a newer timestamp as authority.

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

Still required: final combined-beta verification, exact-file/database
approval, beta integration and actual device acceptance. Replay of an existing
decision is historical no-write evidence, not proof of current convergence; fresh
unchanged gap recovery must still prove every retained graph. No production-ready
or recovered-device claim follows from this prototype.

## Current draft verification, 5 November

- `node scripts/test-legacy-shift-recovery-outbox-sqlserver.cjs --run`: 59 actual
  disposable LocalDB groups pass, including six-table V0 completion, accepted
  original to later web evolution, forged-history/later-edit denial and real
  serializable lock exclusion. The owned database/instance is cleaned afterward.
- Seven focused Vitest suites pass 135 tests. TypeScript, scoped ESLint and
  `git diff --check` pass. The final combined-current-beta full suite is pending.
- `CODEX_SHIFT36_LOCALDB=1` with `shift-protocol-cross-boundary.test.ts`: three
  closing/recount/restart compositions pass through actual Main role/session
  helpers, owned LocalDB, the in-process guarded API and isolated PostgreSQL.
  Device/Auth identity, vault sealing and protected-feed selection/privacy remain
  synthetic adapters. These tests do not claim installed IPC/OS-vault/device
  acceptance, real credentials, live Supabase or a production data repair.

The earlier 47-group result followed by the final CT failure and the subsequent
expected-hold web-evolution reproduction are superseded only for these exact
tested source paths. Unprovable intermediate histories still require explicit
Administrator review; none are silently acknowledged or discarded.
