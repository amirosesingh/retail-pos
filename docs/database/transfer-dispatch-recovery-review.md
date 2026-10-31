# TRF-15/16: request-item integrity and atomic transfer dispatch

Status: approved code and isolated-test batch; the exact reviewed migration was
separately approved and **applied to ROSEGILL pos on 31 October 2026 at 15:47
(Asia/Brunei)**,
live history `20261031074715`. Final beta merge and installed-device acceptance
are separate steps.
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

That approval was received for SHA256
`972A62DF76BEE85B93CBC7CB0C7C3985EC8C7109D6456AFBC1B36384B35579D2`.
Immediately-before definitions matched the saved preimages. Installed readback
confirms the exact guarded picker copy and lifecycle/history changes, preserved
legacy grants, owner-only private helpers/receipt table, public authenticated-only
atomic RPC and service-only native adapter. The receipt table had zero rows and
the reported transfer remained approved/undispatched. Independent live read-only
review also passed. Advisor categories match the baseline; the
[authenticated SECURITY DEFINER advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
adds the intended atomic entrypoint (92 to 93 routine findings). Its explicit
action/branch guards and minimal grants are verified; this does not certify or
resolve all historical database advisories. The no-policy informational advisory
also adds the private receipt table (10 to 11). It intentionally has no client or
service-role raw table access; guarded owner routines handle it. No real transfer
was executed as a live test.

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

## TRF-16: original request item overwritten during fulfilment creation

The owner reported `23514 TRANSFER_REQUEST_INVALID` at 15:51:30 Asia/Brunei
after the approved atomic migration. Read-only investigation found that the
original request had no item rows. The child transfer held the former request
line, with its original creation timestamp and later row revision.

The old sequence derived a child header with
`stableChildId(requestId, "8", 0)` and both documents' lines with group 6.
That helper replaces the UUID suffix, so nesting it produces identical request
and child line IDs. Upserting the child reassigned the existing row's
`transfer_id`. The new dispatch validator correctly refused missing request facts;
it must not be weakened to permit this corrupted document.

The scoped application correction derives only new fulfilment header UUIDs from
the full normalized request UUID using domain-separated WebCrypto SHA-256/UUIDv8.
The shared checkout ID helper, existing direct-transfer/draft line IDs, SKU
numbering and existing legacy fulfilment identities remain unchanged.

Before creating a new child, request approval now reconciles the central request
and existing fulfilment. Native clients use a named verified relay read, not local
SQL absence as proof. Existing action, active-staff and source-branch restrictions
remain server-controlled; the response contains operational fields only, fully
paged in bounded requests. Browser reads use the authenticated central client.
Ambiguous/unavailable snapshots and cached/local pending children fail closed.
Lost approval/child acknowledgements adopt saved facts rather than create another
document or approval; scope changes fence both writes and deferred UI updates.

### Guard and exact repair — separately approved and applied

- Migration `20261031080149_prevent_transfer_line_reparenting.sql`, SHA256
  `36D22E840F9D5063AC447AD6F1E4854062F4939D81B84DA7FE1A55AAEE40C0E3`,
  rejects changes to an existing item row's parent. Inserts, same-parent updates,
  draft removals and legitimate sync retries remain valid. It rewrites no rows
  and changes no existing grants or approval rules.
- Maintenance script
  [restore-sr-bet2-20261031-request-line.sql](../../scripts/maintenance/restore-sr-bet2-20261031-request-line.sql),
  SHA256 `6C99BACB16C6D90238A23DEBB290EBB3CFB42CB1E2005D141EDF3A557735A7CF`,
  restores one owner-confirmed line on `SR-BET2-WEB01-20261031-0001`: requested
  and approved quantity 1, SKU `SKU-000000178020`, barcode `6927050888645`,
  original snapshot cost 49. It creates a fresh line UUID and one append-only
  maintenance audit, preserving the surviving child row and all headers.

The maintenance transaction checks exact document/branch/snapshot facts, uses
NOWAIT/try-advisory locking, and aborts instead of waiting behind an operator.
Temporary local timeouts are 2 seconds for locks and 10 seconds for statements.
Product business fields, stock, movements and receipts must remain identical.
Normal existing triggers add two branch sync-feed entries. A matching audited
retry is a no-op; stale facts, audit suppression/tampering or other side effects
roll back the complete transaction. Apply the separately approved parent guard
before this repair so an older client cannot steal a row again.

The owner confirmed the original one-pair request. Its saved activity and approval
history support those values but are marked client-reported; no original row
preimage was found in `change_history`. That confirmation supports the proposed
repair, not permission to execute it. The owner subsequently gave separate exact
ROSEGILL-project approval for both unchanged artifacts. The guard was applied at
16:31:26 Asia/Brunei on 31 October 2026, history `20261031083126`; the bounded
repair succeeded at 16:31:50. Root and independent live readback verified one new
parent line and its maintenance audit, the unchanged original child snapshot,
unchanged approved headers and zero dispatch receipts. Request integrity is valid.
Future repairs still require separate approval.
The script does not add stock: STR1 still has zero available and a one-pair
dispatch remains a genuine shortage until stock is received/counted correctly.

Existing installed offline builds need the updated client to prevent local ID
collisions; a PostgreSQL guard alone cannot repair their local SQL cache. A
concurrent old/new creator can still leave competing pending headers: ambiguity
must be reviewed, and atomic dispatch prevents a second fulfilment of the request.
No global uniqueness/re-keying or automatic legacy data repair is included.
Full creation tests also exposed missing private approval/one-argument helper
definitions in the canonical installer baseline. Actual captured definitions are
used only in the isolated fixture; fresh-install approval repair remains a
separate audit item, not a claim of completed installer verification.
