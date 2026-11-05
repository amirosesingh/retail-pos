## Verified execution — 4 November 2026

Owner approved these exact local repairs and confirmed Electron closed, no unsaved checkout and no concurrent schema maintenance. Both guarded artifacts applied to the pinned POS_Local identity. Readback verified three summary targets and one receipt, plus fourth CLOSED revision 3 with seven existing children and one receipt. Lossless comparison found all 18 retained local graphs equal to the reviewed cloud snapshot under both privacy projections, with no orphans. PR382 merged beta at e6af19de. Electron reopened Ready; automatic recovery is advancing through existing checkpoints. Full recovery completion remains under observation. No stock/sales/permission/configuration edits, queue clearing or manual checkpoint reset. The preparation text below records the approved design, not current execution status. Private package stays ignored; its preparedOnly manifest is an immutable artifact descriptor, not a live authorization registry.
# Three retained local shift summary mirrors

LOCAL54, 4 November 2026. Preparation and isolated tests only. The exact local
SQL artifact must receive separate approval before execution.

Local target: `LAPTOP-N0QBONGL\LCRPOS` → `POS_Local`, database GUID
`CEAFA630-D613-423C-8997-8A31DF70C506`, branch
`a611a328-2217-4d77-944a-5f6a637d123b` (STR1).
Cloud source: ROSEGILL → rosegill0011@gmail.com's Org
(`bjxgimekljzlnwejuawj`) → pos (`qhrufhtbeguxydenzfey`, `postgres`),
https://qhrufhtbeguxydenzfey.supabase.co.

## Exact scope and evidence

Fresh read-only comparison covered all 18 retained local six-table graphs against
28 cloud STR1 graphs under both existing privacy modes. Fourteen already matched.
These three had only five NULL derived summaries plus row_version/updated_at
differences; all other parent facts and every child row matched:

- `d252a275-ebf7-4a09-8cd7-a45706c594a3`
- `2e735bd8-0db2-44fb-a6f7-e28edc64f7e0`
- `85902cc1-9804-4d6f-af4f-f73a1e7799b8`

Each complete local parent matched the existing approved cloud maintenance
audit's before_state losslessly; current cloud parents matched after_state.
Their local reconciliation rows already contain the exact accepted cloud
financial facts. Private amounts/full snapshots remain in ignored local review
evidence and the owner's exact change review, not Git.

`scripts/maintenance/mirror-three-str1-shift-summaries.sql` copies only
`expected_cash`, `expected_card`, `expected_digital`, `variance_cash` and
`variance_total` from those exact pinned existing local reconciliations. It does
not recalculate sales, expectations or variances. It also mirrors row_version
5 → 6 and the exact accepted cloud updated_at
`2026-11-03T13:07:17.283233+00:00`. Those metadata copies are necessary because
RECOVERY53 compares all registered facts; ignoring clocks would weaken proof.
Opening/closing times, counted amounts, people, terminal, state, notes and all
child IDs/rows remain unchanged.

The artifact binds 22 full registered row fingerprints, exact reconciliation and
cloud audit identities, and each accepted after-parent fingerprint. Typed string
projections, length prefixes, NULL markers and UTF-16LE SHA256 preserve numeric,
Unicode and 100 ns timestamp evidence without publishing full business rows.

## Transaction, provenance and concurrency

Use a short owner-confirmed maintenance window: stop the local development app
and its automatic sync, retain SQL Server itself, and run no concurrent migration
or DDL. Do not kill another till, clear a queue or change its connection profile.

The script rejects another server/database GUID, unauthorized maintenance access,
an existing caller transaction or IMPLICIT_TRANSACTIONS ON. It locks the receipt,
three parents, complete child graphs and other selected-branch retained rows with
UPDLOCK/HOLDLOCK/NOWAIT. Busy work aborts rather than retrying or overwriting it.
Full schema, primary identity, CT and exact captured trigger checks run after
locks and again after writes before commit; no trigger is disabled. Pending or
unattributed graph journals and unacknowledged intents prevent execution.

The captured `shifts_unfinished_tickets` trigger stays enabled and unchanged.
These three are CLOSED → CLOSED, so its ACTIVE-close held-ticket rule does not
transition another shift. The unrelated fourth active shift remains untouched.

The three UPDATEs use `CHANGE_TRACKING_CONTEXT(CLOUD)` because they mirror
already accepted cloud facts. They create no new cashier correction, author
proof, upload journal, acknowledgement, shift baseline or checkpoint. One honest
local maintenance receipt is inserted into existing `local_operation_receipts`:
operation `6bf0deed-ea7a-4a2f-9265-b2e92bbce754`, type
`cloud_shift_summary_mirror`, entity STR1 branch. Its JSON note binds before/
after/source-audit digests, the actual SQL maintenance principal and commit time.
No new cloud or local audit event is invented; the existing cloud audit records
retain complete before/after history.

Replays must match the exact receipt and current result. Virtual restoration of
the seven original fields must recreate every pinned original row fingerprint;
a forged receipt cannot authorize altered counts or history. Missing/partial
receipts, changed facts or failed audit insertion abort. Any SQL error rolls
back all owned changes and preserves the caller's original XACT_ABORT option.
Other retained branch graphs are compared dynamically before/after within the
transaction, avoiding a stale pre-three-repair dependency on the fourth repair.

Data row locks are not claimed to mechanically exclude every CREATE TRIGGER.
Native tests exercise both metadata timing and transactional trigger rollback.
Post-write checks can roll back SQL transactional effects, but cannot promise
undo of hostile DBA actions or external nontransactional trigger effects. The
explicit no-concurrent-DDL maintenance boundary therefore remains mandatory;
no temporary schema alteration or unsupported lock workaround is used.

## Acceptance and remaining work

Actual uniquely owned LocalDB tests passed 18 groups: production target refusal,
exact seven-field/three-parent effects, CLOUD CT context, receipt and replay,
changed counts/notes/100 ns clocks, pending work, insertion rollback, disabled/
unknown trigger and receipt identity drift, pre/post metadata checks, real DDL
and parent-lock contention, caller transaction preservation and unchanged
children/other open shift/held orders/stock/sales/checkpoints. The native fixture
was stopped, dropped and deleted (`CodexLocal54_19a7418c0f324330b872499f5ae2f1e9`
/ `Local54Fixture_19a7418c0f324330b872499f5ae2f1e9`). Tests also cover Unicode,
trailing spaces and decimal precision beyond JavaScript's safe range. They use
synthetic financial values and the
exact captured trigger bytes in a definitions-only JSON fixture; no POS_Local,
operator profile or cloud data is written by the harness.

Run the actual fixture only with pinned Node 22 and
`node scripts/test-local54-three-shift-mirror.cjs --run`. CI validates the public
artifact/trigger contract; the Windows SQL test is opt-in through
`RUN_LOCAL54_SQLSERVER=1`.

Prepared artifact SHA256:
`D5A11AC4C5152677100276EAEFF7412F53579B164834E1A0FF9A48EFEFFBCE90`.
The three CI contract tests passed (actual SQL bridge is opt-in), scoped ESLint
passed, and the 18-group native acceptance ran separately. No live local repair
has been performed by this preparation.

Before any approved execution, root must recheck fresh cloud audit/current graph
authority and the exact local fingerprint/schema/pending state, present the
immutable artifact SHA256 and private exact financial change table, and confirm
the maintenance window. After execution, read back all three graphs losslessly,
the receipt and CT context, unchanged other rows/metadata, then let normal
recovery retry from its existing checkpoint. Do not reset checkpoints manually.

This does not by itself clear branch recovery. A fourth retained local OPEN shift
`f7c9512a-92dc-4f88-b49d-71d55c577670` differs from its accepted cloud CLOSED
graph and seven cloud-only closing children; it is explicitly excluded here and
requires its separately reviewed adoption plan. Matching the three does not
authorize closing that active drawer, dropping drafts or resolving old-PC pending
work. Historical mirrors also do not prove future bidirectional closing upload;
that needs the separate current-code offline-close/cloud-ack/download workflow
regression. Membership remains ON HOLD. This batch includes no production promotion.

Rollback before execution is a targeted source revert only. After commit, retain
the receipt and private before-image evidence; any compensating local action
needs a fresh exact plan. Never broadly restore the database, clear journals or
rewind checkpoints as an automatic undo.
