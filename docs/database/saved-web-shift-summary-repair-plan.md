# Saved web closing: one-shift summary repair

4 November 2026. Preparation and isolated tests only. Live execution requires
separate approval of the exact project and immutable artifact hash.

The owner now selects the saved 1 November WEB closing for STR1 shift
`1a349429-cea1-4f45-8d2b-36678d37ad27`, superseding the earlier selection of the
original cashier closing. This decision lets the current cloud graph be made
consistent without requiring access to the original cashier PC. It does not
authorize discarding that PC's pending work or replaying obsolete #359.

Target: ROSEGILL → rosegill0011@gmail.com's Org (`bjxgimekljzlnwejuawj`)
→ pos (`qhrufhtbeguxydenzfey`), database `postgres`,
https://qhrufhtbeguxydenzfey.supabase.co. Branch:
`a611a328-2217-4d77-944a-5f6a637d123b`.

## Exact proposed change

`scripts/maintenance/repair-web-shift-parent-summaries.sql` copies only these
five NULL parent summaries from the exact existing linked reconciliation:

| Parent field | Before | Existing saved reconciliation |
| --- | --- | --- |
| expected_cash | NULL | 648 |
| expected_card | NULL | 123 |
| expected_digital | NULL | 472 |
| variance_cash | NULL | 0 |
| variance_total | NULL | 0 |

The saved closing remains `2026-11-01T13:38:37.207159Z`; opening remains
`2026-10-31T02:22:18.108Z`. The existing ORIGINAL count remains
`e4de3b43-5667-48e6-b493-e8622f7a026e` and reconciliation remains
`fb96ca0c-f5bf-4af1-a941-079e7f9787e1`. No count, tender, time, actor, child ID,
child row, existing non-NULL variance, stock, sale or current drawer changes.

Normal enabled triggers increment the parent version from 5 to 6 and update
updated_at; one honest postgres maintenance audit records before/after states
and the owner-selected saved-web authority. Existing triggers emit two feed
entries: one shift update and one audit insert. No activity notification or
shift closing event is created. No schema, grant, configuration, checkpoint,
queue or author-proof changes are included.

## Exact evidence and safety checks

Root refreshed the saved facts read-only on 4 November. Parent fingerprint:
`996d4f3d74e9d7704fb68403f0818d1b`; graph:
`fd55a0dbab4401786c7f801407330bb4`. Source count/reconciliation fingerprints and
link/cardinality/header/null/matching flags are in
`web-shift-summary-repair-evidence.json`. Root's in-memory five-field candidate
passed the unchanged strict validator with unchanged children, candidate hash
`49d753292cc47b33c52c88645dccc3ad` before normal clock/version changes.

The repair is one atomic DO statement. It requires postgres identity/database,
the one exact target and explicit saved-web authority; locks parent and child
rows NOWAIT; pins original full-row and graph fingerprints; and requires the
same single ORIGINAL count/reconciliation and five NULL destinations. It retains
all ten captured trigger definitions and exact raw source hashes, both graph
helper bodies/attributes and nondeferrable child-parent FKs. It never disables
triggers. UTC and the existing shift-function context are transaction-local and
restored. Any changed, busy, ignored, invalid or unaudited write aborts the entire
statement. Successful replay validates the exact before/after transformation and
all unchanged children before returning without writes.

This uses the corrected raw trigger pins from the seven-row repair. Normal tests
retain the production trigger list unchanged and install exact CRLF function
bytes through server-side escapes. A normalized pin or raw-only source change
is rejected. No substitution of fixture-generated pins masks production parity.

## Verification and remaining acceptance

71 PGlite and 72 native PostgreSQL scenarios passed, with real captured triggers,
other seven shifts preserved, stock/sales/children unchanged, audit and graph
rollback, maintenance-role denial, legitimate/forged replay, local context
restoration and real two-session NOWAIT contention. Disposable native fixture
`owned-HXWwYK` was stopped and removed. These are isolated tests, not live repair
or installed-device acceptance.

Prepared artifact SHA256:
`3745EE19DCBA22F34B8ECA5395201F35CE2D88A8C736984F1745CB4BCED94650`.
Scoped Vitest bridge passed; ESLint and diff checks passed. No live historical
write or application runtime change was performed by this preparation.

Before execution, recheck the exact live fingerprints and guard metadata. After
separately approved execution, verify one audit, two feed entries, exact five
summaries, version+1, preserved time/counts/children and strict target graph.
Validate all branch graphs with `validate_graph(graph, branch, id, false)`;
closed headers still invoke strict validation while actual open shifts remain
valid. Passing `true` for every branch shift would incorrectly demand open shifts
be closed. Root's read-only simulated branch check passed all 27 graphs after
substituting this candidate; no live rows were changed by that check.

Then observe normal scoped download, committed local graph/checkpoint progress
and UI readiness; a successful repair or HTTP response alone does not establish
complete Electron/Android adoption. Never reset a checkpoint to hide a gap.

The original cashier PC may still contain an older saved closing and pending
journal/Change Tracking work. When available, inspect it read-only before retry,
upgrade or adoption. Preserve pending records and evidence; current guards must
hold conflicting stale writes rather than overwrite the selected web closing.
Do not promise legacy production 1.4.79 has current protection or auto-adopts the
cloud repair. Any later authority reversal or pending-data resolution is a
separate reviewed operation. Membership remains ON HOLD.
