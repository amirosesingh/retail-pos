# SHIFT63 — branch shift sharing (preparation; not applied)

Owner approved preparation and implementation on 5 November. Baseline is beta
`68470185e574ec06a3a0ce1573e7bb47c70de32e`, in the separate
`codex/shift-sharing-rules-beta` worktree. Membership is unchanged and on hold.

## Behavior

- `allow_branch_shift_sharing` defaults **true**, preserving branch-wide sharing.
- A nullable branch value inherits the global value; absent global value is ON.
- OFF restricts a normal registered terminal's new checkout to its own shift.
  The registration comes from verified server scope or Electron Main, never an
  editable sale/renderer field. An administrator on a normal till remains bound.
- Cashiers sharing one physical till can continue the same shift. History,
  reporting and authorized management corrections retain their existing scope.
- `allow_multiple_shifts_per_terminal` is a separate setting. This change does
  not reinterpret or repair that setting's existing inconsistent consumers.
- A native sync request must also use its actual terminal's shift when OFF.
  A valid device proof alone does not prove that a new write predates cutover.
  Already accepted exact receipts retain their replay rules. Unknown older
  cross-till work stays pending for review, never erased or reassigned. OFF is
  unavailable until the complete PC cohort and old queues are reviewed.

## Exact proposed cloud changes

File: `supabase/migrations/20261105090100_branch_shift_sharing.sql`. The same
bytes are in `scripts/preparation/shift-branch-sharing.sql` and the marked
SHIFT63 section at the end of `supabase/schema.sql`.

1. Add nullable boolean `public.pos_store_settings.allow_branch_shift_sharing`.
   No default/backfill writes existing rows. Add TRUE to `pos_rules_defaults()`.
2. Extend the existing settings sync routine's explicit field list, preserving
   its body and row-version checks. `pos_rules_save` remains unchanged and
   recognizes the field through its existing canonical-default allowlist.
3. Extend `pos_rules_snapshot` with a readiness boolean; its existing branch
   visibility and saved metadata remain intact.
4. Add private `shift_sharing_private.authorize`, `check_checkout`,
   `check_setting`, `can_disable` and immutable-contract functions, plus a
   private RLS-enabled immutable contract-pin table. No client/service role can
   mutate that table or execute the private functions directly. Pins cover
   function definitions, owner, security mode, search path/configuration,
   execution grants and exact enabled trigger definitions.
5. Add service-only RPCs `pos_checkout_sale_for_terminal`,
   `pos_open_shift_for_terminal`, and `pos_shift_active_for_terminal`.
   The hosting relay verifies the session/device before calling them. Mutations
   also recheck the actual current account, permission and registered device.
6. Add `pos_shift_sharing_ready()` (boolean metadata only) and business triggers:
   `shift_branch_checkout_guard` on new sales, `shift_branch_open_guard` on new
   shifts, and `shift_branch_setting_guard` on setting changes. OFF is blocked
   until required historical-entry compatibility and the owner-reviewed
   FIN62 branch cohort/pending-work cutover are present. Global OFF checks all
   affected PC branches; an online/mobile-only branch acquires no PC/offline
   capability. Direct client
   attempts cannot authorize a sale by setting a frontend terminal/context.

Applying this preparation creates no sale, shift, stock movement, price change,
account grant or rule-value change. Existing financial writer definitions stay
unchanged. No live application has occurred.

## FIN62 composition and rollout gates

The checkout adapter delegates to the existing writer, or to the ready FIN62
`pos_live_financial_sale` when that contract is installed. An installed but
unready financial adapter fails closed; it never falls back to an older writer.
The final integrated hosting route must call the outer sharing adapter first.

The FIN62 verified administrator missed-bill adapter sets and restores the
transaction-local `pos.shift_checkout_context` JSON around its unchanged
historical writer, including exception paths:

`{"branch":"<verified branch>","terminal":null,"mode":"historical_admin"}`

Historical entry remains distinct from an ordinary shiftless checkout. Do not
change its original-shift audit semantics or post it into a current drawer.
The public readiness check holds OFF until this dependency is present and
pinned. The cloud financial upgrade must install before this sharing migration
captures its pins. Missing dependencies do not become trusted automatically
when an unknown later function appears. Final installer versions and the
combined migration order still require integration review. Old binaries cannot
implement a newly disabled sharing rule; update participating tills and review
pending uploads before approving the cohort and enabling OFF. This
upgrade does not silently turn OFF on any branch.

## Exact proposed local changes

`database/sqlserver/prepared/027_shift_branch_sharing.sql` adds only nullable
`bit` `dbo.pos_store_settings.allow_branch_shift_sharing`, with existing-table,
type and caller-transaction checks. It contains no business-row update and is outside automatic
migration discovery. The generated registry, schema and guarded existing-data
download bundle include the same column. Existing SQL configuration, database
collation, quantities, sales, prices and credentials are unchanged.

Native new sales check their shift's actual SQL owner inside the original
transaction. Main overwrites any caller terminal/classification using saved
registration. Failure rolls back the sale and operation receipt together. An
old-schema rule reader retains ON; this is not a claim that packaged schema
validation accepts a missing column. Apply the reviewed additive local upgrade
before running this installer against an existing database. Cohort approval for
OFF must include the current client build and local 027, as well as the FIN62
metadata upgrades, rather than assuming financial local-schema 26 proves the
new sharing field exists.

## Verification at this checkpoint

- 22 actual disposable PostgreSQL policy groups and matching PGlite cases.
  Includes defaults/inheritance, own-till opening/read/checkout, normal-terminal
  administrator denial, management/browser access, revoked permissions,
  direct-client forged context denial, service-only ACLs, pending publication,
  historical context, native sync denial, complete/revoked cohort, global
  cutover coverage, source/pin/ACL drift, old-client missing-field preservation,
  save/reload/stale version and unchanged writer source.
  The fixture writer is deliberately minimal; these are policy checks, not a
  claim of complete production checkout/stock verification.
- 11 actual owned LocalDB scenarios include the real aggregate writer, foreign
  till rollback, own-till sale, same-PC handover, management classification,
  restart, old-schema default, caller-transaction safety and repeatable additive
  upgrade preserving data.
- Focused unit/relay regressions verify exact verified-identity arguments and
  no downgrade on permission, conflict, network or malformed 404 failures.
- An actual Main IPC-handler VM test proves renderer terminal/management claims
  are overwritten; a branch-bearing registration cannot become Management just
  by carrying that label. Independent real native-RPC tests deny a fresh foreign
  till's shift, accept its own shift, and acknowledge an already accepted exact
  cross-till receipt once without rewriting history.
- Full suite checkpoint: 5,107 passed, 7 skipped. Later focused checks cover the
  final small Main-boundary and SQL replay/capability refinements; exact-head CI
  remains required before integration. TypeScript, scoped lint and diff checks
  passed. Final focused canonical/policy/Main run: 52 passed.
- Full-suite final run, independent review, CI, merged-beta workflows and actual
  desktop/mobile rendering remain separate gates. No credential-entry workflow
  or physical-phone UI check is claimed here.

## Frozen proposed SQL hashes

- Cloud `20261105090100_branch_shift_sharing.sql`:
  `17B9FB70FF19E5A43C034D9024D593C2918507257B7B92CD63E491AE9668FB07`.
- Local prepared `027_shift_branch_sharing.sql`:
  `E0E9A77D847A08961BAA1EB7D75C67F971960E086FA286A7891FC424DE93F359`.

These are review identifiers, not live-application approval. The cloud financial
bundle `20261105090000_shift_financial_known_history.sql` must precede the
sharing migration; use the root release checklist for the final combined order.

## Recovery

Keep this independently reviewable beta change separate from FIN62 until the
contracts are composed and tested. Before release, record the exact reviewed
commit and migration hashes. Revert only this code change if necessary, keeping
additive columns/data. Do not drop data, disable authorization triggers, clear
queues, reset checkpoints or silently change an operator's OFF setting as a
rollback shortcut. If rollback to an older binary is needed while OFF is saved,
obtain an explicit operator decision about restoring sharing or retain a
compatible guarded build. Cloud/local application, promotion and publication
need their existing separate approvals.
