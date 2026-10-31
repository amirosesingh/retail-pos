# TRF-15: atomic transfer dispatch and verified native operator

Status: approved code and isolated-test batch; **not applied to the live database**.
Membership remains on hold. No real dispatch, approval, stock correction or
permission change is authorized by the test batch.

## Confirmed incident and causes

Read-only investigation of `ST-STR1-WEB01-20261031-0001` found an approved STR1
to BET2 transfer for one pair. Its sending branch had zero stock and no child
warehouse with stock. PostgreSQL correctly raised a shortage and rolled back;
the transfer was not dispatched. Do not bypass that shortage or manufacture stock.

The source review also confirmed three separate defects:

1. The browser dropped the structured SQL error code, hiding useful shortage
   guidance behind a generic error.
2. Dispatch committed before a separate linked-request completion call. That
   completion could violate the request lifecycle, reporting failure after stock
   had moved.
3. Native dispatch used a service JWT without the verified staff identity that
   the stock routine required. Approval already had a separate staff adapter.

## Prepared change

Migration:
`20261031042447_atomic_transfer_dispatch_and_verified_native_actor.sql`.

- Preserve the installed warehouse picker through a guarded copy, extending only
  its admission check for the verified native actor. Abort on an unexpected
  implementation rather than overwriting unknown amendments.
- Make dispatch and valid linked-request completion one transaction. Lock parent,
  child and existing item rows before validation/picking; retain the validated
  immediate foreign key that serializes a concurrent item insertion at commit.
- Add a private, append-only `private.transfer_dispatch_receipts` table for the
  immutable dispatch intent. It records transfer/line/approval facts, actor and
  dispatch time; it is not replicated and has no direct anon, authenticated or
  service-role table grants. Existing records are not backfilled. Reject a
  pre-existing table that is not the expected owned, marked, exact shape.
- Return a versioned authoritative result through
  `public.stock_transfer_dispatch_atomic`. Validate the complete unique item set
  and integer quantities against current approval ceilings before mutation.
- Add service-only `public.stock_transfer_dispatch_atomic_for_staff`. The trusted
  server supplies the verified staff identity and terminal branch binding, checks
  current action/page/account scope, and rechecks the locked transfer branch.
  Never accept a renderer-supplied actor, branch or strictness override.
- Preserve the old public void contract and its quantity clamp/default behavior.
  Both paths use the atomic core. Preserve existing permission helpers, legacy
  grants and approval rules; new internal helpers are owner-only.
- Restrict the lifecycle/history exception to the validated linked request.
  Attribute that paperwork completion to its dispatcher without setting
  `verified_by` or implying physical goods verification.
- Reconcile one ambiguous response using the identical request. An immutable
  receipt and current authorization must agree before replay; no second deduction.
  Historical dispatched documents without a receipt fail closed for review.

The client preserves error codes, shows bounded operational guidance, validates
the response against the submitted transfer/branches/quantities, and removes the
second request-completion write. It applies absolute source-root stock only when
the original cached product has not been replaced, fences session/branch changes,
and retains newer statuses. Child-warehouse buckets still refresh through existing
authorized synchronization; this is not proof of immediately fresh warehouse UI.

Existing fresh-dispatch notification rules/channels are retained. Replay suppresses
duplicate client notifications; observer failures cannot turn committed dispatch
into a business failure. External notification delivery remains best effort,
including response-loss cases. No SQL notification insertion, outbox or rule change
is included.

## Preserved rules and limits

- Stock shortages remain blocking. Existing warehouse order, ownership, SKU,
  pricing, checkout, receipt, approval and branch/cluster rules are preserved.
- Partial and zero dispatch retain the existing close-without-remainder semantics.
- No products, quantities, sales, shifts, users, grants or settings are rewritten
  by applying this migration. New receipt rows are created only by later dispatches.
- This correction does not repair legacy direct transfer-item/header CRUD rules.
  The receipt detects changed facts on retry; locks do not make rows permanently
  immutable after commit.
- Offline transfer support is not added. Native requests still require the
  existing verified online server path. Old installed clients/backends and actual
  devices require their own acceptance checks.

## Verification and deployment gate

Permanent tests use in-memory PostgreSQL, canonical transfer/product triggers,
captured live definitions, and a disposable loopback PostgreSQL cluster for
independent-session races. They never accept a production database URL/profile.
Final counts, commands and revision belong in `docs/TASK_TRACKER.md` and the PR.
CI runs the atomic database scenarios as well as existing complete regressions.
The captured live DDL is ignored local review evidence supplied with optional
fixture arguments; a fresh CI checkout runs the canonical scenarios by default.

Before application, separately obtain approval for this exact target:

- Connection/account: **ROSEGILL** (connector link nickname `beta`).
- Organization: **rosegill0011@gmail.com's Org**, `bjxgimekljzlnwejuawj`.
- Project/database: **pos**, `qhrufhtbeguxydenzfey`.
- API URL: <https://qhrufhtbeguxydenzfey.supabase.co>.

Capture the installed routines/metadata before application; verify recognized
definitions, table absence/shape, exact ACLs, migration checksum and project
identity. Use the migration runner's transaction, then verify definitions, grants,
new table/trigger protection and history. Do not dispatch the real shortage case
to test the upgrade. Apply the approved database dependency before deploying the
new client; an old server must fail closed with an upgrade message.

## Recovery

Keep the pre-change function definitions and Git baseline. Revert only this PR's
application changes through a reviewed beta PR if necessary. Database rollback is
a separately reviewed migration restoring the captured picker wrapper, lifecycle
and history functions and restricting the new entrypoints. Preserve dispatch
receipt evidence and all committed movements; never reverse stock automatically
or drop receipts to make a retry succeed. Installer publication, OTA and production
promotion remain separately authorized actions.
