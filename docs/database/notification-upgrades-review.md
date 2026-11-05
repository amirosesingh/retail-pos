# Notification upgrades: preparation review

Reviewed 31 October 2026 (Asia/Brunei). Source and disposable PostgreSQL tests
only. No live database edits, rule activation, messages or inventory actions.
Membership remains on hold. This document is supporting evidence; the task
tracker remains the current task ledger.

## Exact target for a later approval

ROSEGILL connector, rosegill0011@gmail.com's Org (`bjxgimekljzlnwejuawj`), project
**pos** (`qhrufhtbeguxydenzfey`),
<https://qhrufhtbeguxydenzfey.supabase.co>.

The parent agent's read-only live checkpoint reports the core 24 October rules
upgrade already deployed, `notification_settings.rules` not an array, legacy
`enabled=false`, and no delivery rows. Re-check the exact live definitions and
settings shape immediately before any proposed application. A connector nickname
is not proof of a separate beta database. This review does not authorize a write.

## 1. Personal clear: unsafe alone; additive correction prepared

File: `20261025141638_personal_notification_acknowledgements.sql`.

It replaces `public.sync_apply_activity_events(jsonb)` only. On an existing event
ID it unions the existing and uploaded `cleared_by` arrays rather than erasing
earlier recipients' acknowledgements. Event content remains immutable. It revokes
public/anonymous/authenticated execution and grants execution to `service_role`.
It does not backfill existing events or change sales, stock, users or grants.

The intended stale/offline protection works in isolated PostgreSQL, but the
upgrade has a confirmed branch-lock regression: the conflict update checks only
the globally unique event ID, not the existing event's branch.

Reproduction using the actual canonical native batch routine:

1. An existing event belongs to Branch B and targets its manager.
2. Registered Branch A terminal submits that ID with incoming `store_id=A` and
   `cleared_by=[manager-b]`.
3. The batch validates the incoming Branch A scope.
4. `ON CONFLICT(id)` updates the Branch B event's acknowledgement to `manager-b`.
   Its original branch/content remain B, but its private notification is cleared.

The HTTP path verifies the terminal and forwards activity rows to the service
RPC (`sync-endpoint.server.ts`). `assertStoreSyncScope` special-cases only the
stores table, so it does not add an existing-event identity check. This is an
acknowledgement integrity defect, not demonstrated content exfiltration or a
checkout defect. All execution here used isolated fake records.

The owner subsequently approved **preparation only** of an additive correction
and isolated tests. The old migration remains unchanged and must not be applied
alone. No live notification upgrade is authorized by this preparation approval.

Prepared file:
`20261030234813_guard_activity_acknowledgement_branch_ownership.sql`.
Supabase CLI2.121.0 generated this timestamp using `migration new`; the earlier
untracked candidate20261030234442 was replaced because that version was already
used by the separately approved live shift-proof migration. The candidate was
copied and hash-verified into the new CLI-created file, then only the old
candidate was removed. No applied/source history was rewritten.

The correction replaces only `sync_apply_activity_events(jsonb)`, retaining
SECURITY INVOKER, fixed search_path and the existing service-only execution ACL.
It revalidates the transaction-local native batch terminal/branch context using
the existing `pos_sync_validate_scope`; incoming JSON cannot choose that context.
Both production callers, `pos_sync_push_batch` and `pos_sync_push_aggregate`,
already establish it after validating the terminal binding. Raw calls without
context fail. Operations binding, Management admission and account/recipient
permissions are unchanged.

The conflict update checks the actual locked existing row: its store must be
the same SQL-equivalent branch, or blank/unowned as in the existing shared/global
acknowledgement behavior. NULL, empty and trimmed-blank ownership remain shared;
the literal `global` is not a magic store entitlement. A foreign nonblank branch
fails. The insert still changes only `cleared_by` on conflict, unioning existing
and uploaded values. Existing title, message, audience, metadata, branch, IDs,
timestamps and delivery state remain immutable. No new visibility or recipient
right is introduced; the existing native operator acknowledgement guard still
precedes upload.

The routine compares affected rows with the complete submitted array and raises
`SYNC_BRANCH_FORBIDDEN` on a filtered conflict. A denial therefore rolls back
earlier rows, trigger/delivery effects and the batch receipt; it cannot become a
successful partial acknowledgement. PostgreSQL evaluates an ON CONFLICT update
condition against the conflicting row after locking it, including concurrent
inserts. See [PostgreSQL17 INSERT](https://www.postgresql.org/docs/17/sql-insert.html)
and [Supabase function security](https://supabase.com/docs/guides/database/functions).

Durability paths: `scripts/generate-supabase-sync-contract.cjs` reads the marked
function/ACL block from the new migration for activity_events only. Both canonical
definitions in `supabase/schema.sql` match it, including the later appended
definition that would otherwise restore the old behavior. No other generated
table contract or historical migration was changed.

## 2. Soft-token owner/admin rule: scoped tests pass

File: `20261025133911_soft_token_owner_admin_notification_rule.sql`.

It replaces the existing `public.notify_soft_token_approval()` trigger function.
For successful TOTP approvals with a named authorizer it emits one idempotent
activity event, using the existing trigger. Its privacy ceiling is the verified
token owner plus active administrators. Rule selections, role/branch eligibility
and channels can narrow delivery; they do not broaden that ceiling. The trigger
does not copy token codes or secrets into the activity event.

It also conditionally updates `pos_settings.id=1`: append a default app-channel
soft-token rule only when `notification_settings.rules` is already an array and
there is no rule for this event. An existing disabled/custom token rule is left
unchanged. Legacy/null rules are not activated. At the parent's current live
checkpoint, this conditional update is expected to affect zero settings rows;
verify that immediately before proposing application. It sends no historical
events and does not change approval permissions or approval limits.

Isolated tests passed for selected users/roles, disabled rules, branch/actor
filters, inactive accounts, PIN/failed attempts, native actor/terminal distinction,
original owner/admin privacy, private WhatsApp suppression, push eligibility
rechecking, idempotent reapplication and preserving legacy/current settings.
An owner assigned to another branch is filtered by the existing recipient scope;
do not describe this upgrade as unconditional delivery to every possible token
owner regardless of scope. Physical delivery, real offline token verification,
network providers and installed device acceptance were not exercised.

## Executed checks and recovery

The pre-correction reproduction ran the exact existing personal upgrade with the
real immutable-event trigger, native batch/scope routines and core rule/queue
functions in PGlite:14 scenarios passed and the existing-ID branch collision
failed. That recorded failure was not readiness. The expanded `--baseline` mode
now reproduces5 failures with18 controls passing; it deliberately retains the
unsafe old function and is not the CI command.

`node scripts/test-notification-upgrades.mjs` applies the exact additive correction
and passes **23 scenarios**. They cover original-ID foreign-branch forgery, new
and existing same-branch events, raw missing/mismatched context, global/blank
ownership, monotonic personal/system unions, stale retries, secondary unique-key
and duplicate-ID conflicts, full batch/aggregate rollback, receipt retention/retry,
immutable audience/content and rule/delivery controls. The parity case runs the
actual generator in a disposable copy, compares every canonical activity
definition with the migration and executes generated SQL against the denial
regression. `.github/workflows/ci.yml` now runs this isolated script on future
PRs. No external database or runtime download is used by it.

The trigger-time competing-insert fixture is explicitly a same-command
cardinality-refusal test, not a claim of independent-session concurrency.
Separate `scripts/test-notification-ack-races.mjs --postgres-bin <bin-directory>`
passed **6 real two-session PostgreSQL17.11 races**. Each waits until
`pg_blocking_pids` confirms a competing session actually blocks before releasing
COMMIT/ROLLBACK: foreign insert is refused; same-branch insert is unioned without
changing content; rolled-back foreign insert allows the waiting legitimate new
event; stale concurrent recipients are unioned; late foreign conflict rolls back
the earlier event and receipt; concurrent replay applies one batch once.

That harness accepts binaries only, never a database URL/profile, creates its
own disposable random-port loopback cluster under ignored test cache, and stops
and removes its fixture afterward. The existing previously verified portable
PostgreSQL archive supplied the runtime; no installer, service, PATH or existing
database/configuration changed. Windows' default network sandbox refused
loopback10013, so the owner-approved isolated harness ran with escalation.
Real race checks are separate from PGlite and are not currently the CI command.

Independent read-only review found no concrete scope, immutable-content, union,
global or caller regression. The reviewer separately repeated23 PGlite/generator
scenarios,6 real two-session races and6 related Vitest suites/44 tests. These are
source and isolated-fixture results, not installed-device/delivery certification.

Official Supabase function and PostgreSQL conflict semantics documentation were
read. The changelog fetch was unavailable (unsupported markdown transport); no
new Supabase API or dependency is used. Source/preparation verification remains
separate from live application.

If a separately approved upgrade is later applied, capture prior function
definitions/ACLs and the exact settings JSON first. Reverting a function definition
does not undo acknowledgements or already delivered notifications. Do not restore
an old whole database or overwrite concurrent settings/sales to roll this back.

Preparation rollback is a revert of this source batch: the new additive migration,
activity-only generator/canonical changes, isolated scripts and CI step. Keep the
old migration as historical evidence. For any future live rollback, capture the
prior function definition and ACL before application; restoring the unguarded
union would reintroduce the known collision. Function rollback cannot undo
acknowledgements or delivered notifications. Do not repair history or reset
operator rules to simulate rollback. Exact-project live approval, current-state
readback and a reviewed rollback definition remain required.
