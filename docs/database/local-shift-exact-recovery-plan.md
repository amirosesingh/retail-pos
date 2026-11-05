# Retained local shift recovery: exact no-op proof

4 November 2026. Approved source preparation and isolated tests only. No live
local database repair, queue acknowledgement, manual checkpoint reset, deployment
or release is authorized by this document.

Cloud summary repairs made the saved closing graphs valid, but an expired local
Change Tracking checkpoint does not prove that retained local rows were uploaded.
The existing guard correctly refuses that ambiguity. This change permits only a
fresh full-graph no-op comparison; it does not use an empty queue, local baseline
or old receipt as authority to replace retained facts.

## Fresh cloud evidence and privacy

Only small responses from the existing authenticated shift-graph read are
eligible for optional lossless proof. At most 32 KiB uses that path. The
server reads a bounded response, preserves exact JSON numeric lexemes, applies
the existing privacy projection, and serializes numbers as numbers. No new RPC,
schema, request credentials or body protocol fields are introduced. The success
response alone carries `X-POS-Shift-Graph-Exact: 1`; malformed/duplicate-key,
oversized or failed responses carry no capability. Existing non-graph operations
retain their parsing and redaction paths.

Larger graph responses retain the prior complete ordinary JSON parsing/privacy
projection/serialization path, without the exact capability. No rows or fields
are truncated to meet a CPU budget. Such a response remains usable by ordinary
sync where existing guards permit it, but cannot establish this new expired-CT
exception. This avoids the extra full lossless-proof processing on large reads;
it does not establish that large requests meet Cloudflare Free's CPU budget.
Nonfinite numeric values, negative zero and negative underflow also retain
ordinary legacy serialization without a proof header.

Native Main keeps its ordinary parsed response and a private WeakMap witness
bound to the actual successful header-bearing response, branch, shift, token
and unchanged parsed object. A body flag, old server, unknown header, mutation,
another branch or another graph cannot supply that witness. Renderer callers
receive no force/ignore switch. Plain already-rounded numbers or JavaScript
Dates cannot establish exact proof. SQL money, integers and timestamps are
projected as strings; comparison retains decimal and 100 ns timestamp precision,
including JSON values nested in event history. Global ordinary `sameRow` behavior
is unchanged.

## Scoped guard and no-op application

Under the existing apply transaction, the reader locks each complete six-table
local graph in parent-first order and checks branch ownership, pending/orphan
journal keys, unacknowledged protected intents and available CT evidence. Where
local CT is missing/expired, the exception requires identical complete row sets
and every registered fact against the fresh lossless cloud graph. Closed and
active/open graphs are supported; an open graph still requires its fresh witness
and complete valid open envelope. Any missing, extra, divergent or unattributed
history remains held. No local summary is automatically filled.

An exact case does not MERGE any business row, change clocks, install a baseline,
acknowledge an intent or clear a journal entry. Its private proof is scoped to
the transaction and exact graph. It cannot become a generic cached permission
for another graph or a later transaction. Existing valid-CT and genuinely new
empty-graph application paths retain their prior guards.

## Complete retained-branch coverage

Gap recovery captures a valid starting CT version V0 and every retained graph
identity in a serializable transaction, including children whose branch/parent
is missing or inconsistent. Such orphan or unknown-branch rows cause a hold.
Every initial retained shift must receive a committed exact no-op proof. Missing
shifts outside the selected table's snapshot page/window are read through the
same existing full-graph endpoint; they are never silently omitted. Page proofs
count only after commit. A retained shift deleted entirely before its cloud page
cannot fall through to the fresh-empty bootstrap path and be recreated.

Before normal completion, a final serializable transaction rechecks pending
work, V0 retention, retained identity membership and each proved full local graph
fingerprint. CT changes since V0 must be attributable cloud-context changes;
unattributed deletes, source edits or disappeared history hold recovery. Backend,
registered terminal, branch and SQL pool identity must remain unchanged. Only
then does the existing monotonic `advanceRecovery` save V0 atomically. It never
jumps to a later current version; changes after V0 remain eligible for the normal
next pass. This proves retained current graphs only, not the content of already
expired and otherwise unavailable historical CT events.

Limits are explicit: at most 20,000 retained branch graph rows are inventoried;
each graph retains the existing 2,000-row and six-table 6 MiB limits, with a 16 KiB
envelope allowance on raw transport. Depth is bounded at 128. Larger proofs hold
for review rather than truncating data. Resource limits are acceptance boundaries,
not a claim of unlimited twenty-year branch history recovery.

## Verification and remaining limits

Focused tests cover ordinary guard compatibility, exact closed/open no-op cases,
lossless decimals/microseconds, nested JSON, duplicate keys, malformed and bounded
inputs, prototype/accessor/raw-token safety, capability and graph mutation denial,
pending and orphan work, altered immutable/history rows, whole-branch subset and
rollback coverage, complete deletion before a page, post-proof writes/deletes,
V0 expiry and final checkpoint behavior. Actual Electron 44.9.1 / Node 24.22.0
and pinned Node 22.22.2 both loaded the shared ESM implementation through the
native CJS wrapper; the Electron test used RUN_AS_NODE and no operator profile.
Actual disposable SQL Server acceptance passed 16 groups, including real Change
Tracking, serializable transaction/second-writer locking, exact OPEN/CLOSED
no-op behavior, lost-history and precision holds, rollback and monotonic V0-only
checkpoint/cursor preservation. Its uniquely owned LocalDB instance/database
were cleaned; no POS_Local or operator profile was used. Hosted workerd privacy/
CPU and final full-suite evidence are tracked separately before runtime release.

Root's final full suite passed 4,961 tests across 639 suites (one suite and three
tests skipped); TypeScript, scoped ESLint and 83 native startup/sync/shutdown
tests passed. Web/Cloudflare and Windows production builds passed. A separate
Electron Main fixture loaded the helper from ASAR with exact numeric round-trip,
using its own test profile without POS or database access. These are preparation
checks, not installed checkout, live recovery or hosted CPU acceptance.

The real development database has three known divergent saved closed graphs:
`d252a275-ebf7-4a09-8cd7-a45706c594a3`,
`2e735bd8-0db2-44fb-a6f7-e28edc64f7e0`, and
`85902cc1-9804-4d6f-af4f-f73a1e7799b8`. Their missing summaries will still hold
under this conservative proof. A separately reviewed exact local repair would
be required; preparation does not authorize it. The original cashier PC's
pending closing remains a separate adoption concern. The owner-selected saved
WEB closing is authoritative; reconnecting that PC must not revive an obsolete
original-authority selection or overwrite the selected WEB graph.

Cloudflare Free has a 10 ms CPU limit. Typical small-graph tests and maximum-size
tests must be reported separately; passing local tests does not establish every
allowed graph can meet that hosting budget. No cap reduction, history omission,
privacy shortcut or billing change is justified by a failed benchmark.

Checkout, permission checks, branch locks, author signatures, operator connection
settings and Membership are outside this runtime change. Membership stays on
hold. A targeted source revert before deployment requires no business-data undo;
after actual normal recovery, do not reverse checkpoints or erase proof/history
metadata without a separately reviewed plan.
