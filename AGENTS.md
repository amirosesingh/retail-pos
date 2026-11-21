## Beta-first changes and production approval

- Start feature/fix branches from the current `beta` branch and open PRs into
  `beta`. Test changes there before proposing production promotion.
- Prefix beta PR titles with `[BETA]` and label them `beta`. Prefix PRs into
  `main` with `[PRODUCTION]`, label them `production`, and mark unapproved
  promotions `awaiting-owner-approval`.
- Promote tested changes with a separate `beta` → `main` PR. Never push,
  merge, or enable auto-merge into `main` without the owner's explicit approval
  for that specific promotion. Previous approvals and passing checks are not
  permission to promote new changes. Never assert approval on the owner's behalf.
- Keep Cloudflare beta websites live on beta pushes and keep checks automatic.
  Accumulate Android/Windows changes on beta; publish their paired beta installers
  only after the owner explicitly says “Publish beta now”. Do not create a
  `beta-publish-YYYYMMDD-HHMMSS` tag or dispatch the beta-release workflow without
  that request. Implementing or merging a fix is not publication approval.
- Preserve existing functionality, branch restrictions, permissions, and
  operator-managed database configuration. PR labels do not grant access or
  authorize production deployment.

## Prompt incremental beta integration and verified promotion

- Integrate each approved, independently reviewable fix into `beta` promptly
  once its exact reviewed head passes required CI and relevant regression
  checks. Do not accumulate finished PRs solely to wait for an unrelated batch.
  Refresh the destination branch, reconcile conflicts without losing either
  intended behavior, inspect the scoped diff and verify the merged result.
- Merge only the changed feature and necessary reviewed dependencies; never
  replace the repository or overwrite newer features with an older checkout.
  Keep each unfinished or failed item tracked separately, with a next step.
- Verify the deployed beta's affected end-to-end workflows before promotion;
  passing CI, a visible page or one successful request is insufficient. Keep
  production promotion ready as beta progresses rather than letting it drift.
  Promote through a separate `beta` to `main` PR after required beta acceptance
  and the owner's explicit approval for that specific promotion. This rule
  does not waive production, database, billing or installer-release approvals.

## Scoped PR changes and regression protection — beta and production

- Creating, updating or merging a PR must preserve existing features. Include
  only the approved feature/fix changes and their necessary reviewed dependencies;
  do not replace a checkout/repository, copy older source over newer code, stage
  every local file, or bundle unrelated edits/refactoring.
- Compare against the latest destination branch, inspect the final file/content
  diff and resolve conflicts by preserving both intended behaviors. A particular
  Git merge method does not guarantee correctness. Never treat a clean merge as
  proof that workflows, permissions or data integrity still work.
- Before merge, run relevant regression checks for the changed feature and its
  shared dependencies, including applicable checkout/receipt, authorization,
  branch/cluster, offline/sync and platform paths. Require passing checks on the
  exact reviewed head; document limits instead of claiming untested behavior is
  preserved. Keep a recoverable baseline and a targeted rollback path.
- If a necessary correction expands the approved scope, obtain owner approval
  first. These rules apply equally to beta and production PRs and do not replace
  the separate explicit approval required for each production promotion.

## Durable synchronization and long-offline integrity

- Downloading an application update is independent of POS sign-in and sync
  status. Stage and verify downloads while normal work continues. Offer
  installation as a separate action.
- Before installation, finish renderer saves, drain accepted local writes and
  verify the configured local SQL database under the existing sync lease.
  Committed pending uploads, failed uploads and pending shift closes may remain
  queued while the cloud is unavailable. Preserve their payloads, IDs, proofs,
  receipts and checkpoints across the update.
- Permitting an installer after local saves is not cloud acceptance. Never mark
  queues synchronized, advance upload checkpoints or finalize a shift because an
  update starts. Resume eligible uploads through the existing coordinator after
  restart and reconnect. Keep actual local save failures, unreadable local
  storage, active transactions and database migration/bootstrap as installation
  blockers.

- Follow the [POS sync implementation plan](docs/database/pos-sync-implementation-plan.md)
  for future sync work. The [previous rules](docs/database/archive/pos-sync-rules-before-2026-11-07.md)
  and [previous plan](docs/database/archive/pos-sync-plan-before-2026-11-07.md)
  are historical backups. Implement in reviewed beta stages through the existing
  entry points. Keep compatibility until isolated acceptance and cutover.
- Synchronization is two-way. Local SQL Server uploads authorized business
  events and permitted local changes. Supabase downloads canonical cloud
  changes and confirmed results to eligible tills. The registry defines each
  table's direction, field ownership and scope. Give uploads and downloads
  independent progress and health within their authorization and dependency
  guards. Reuse the existing Windows ODBC Driver 18 connection and HTTPS relay.
- On SQL Server 2025 Express, use one durable transactional outbox and one
  uploader. Use Change Tracking only on approved legacy current-state mirrors.
  Keep journal delivery independent of capture history. Treat native CDC as a
  separate decision for a future deployment that supports it.
- Publish complete cloud change groups in commit order to a durable feed per
  authorized scope. Use private Supabase Realtime signals to wake authorized
  readers and resume from saved checkpoints on reconnect or polling. Apply the
  whole group and its cursor together. Recover an expired cursor through a
  staged snapshot that preserves the journal, pending sales and active shifts.
- Refresh Approvals, Holds and the in-app badge promptly for authorized active
  sessions, including PIN-only tills and named cross-store recipients when
  store policy permits them. Use minimal wake signals and authorized reads.
  Recheck permission and ticket binding when claiming an approval. Preserve
  authorized polling when Realtime is unavailable.
- Before replacing the current route, classify all deployed relations and
  critical writers. Verify two isolated tills against staging with the agreed
  offline rules, matching scoped records and business values, and a successful
  cutover and handback drill with a pending sale and an open shift. Preserve the
  existing live database, production promotion and release approval boundaries.
- Save a local business operation and its durable pending upload evidence in
  the same transaction. Keep pending operations until verified server acceptance;
  retries and lost acknowledgements must not duplicate sales, payments, stock
  movements or closing actions. A network success alone is not acceptance.
- When enabled local SQL is ready, supported Electron writes must await that
  local transaction before reporting success or uploading the business record.
  The uploader reads committed pending evidence through the existing coordinator.
  Preserve the explicit commit target and the approved unavailable-SQL fallback;
  an actual local write failure must remain a failure rather than silently
  switching the operation to the cloud.
- With a native bridge, treat unreadable, malformed, recovering or enabled-but-unready
  local SQL state as a blocked supported write, never as an empty/unconfigured database. Choose
  the existing central writer only through the verified SQL-disabled state or
  existing web, Management and approved online-session routes. A verified local
  route with a missing native writer requires retry/update, not a cloud fallback.
- For store-rule changes, the existing native edit queue owns the supported
  `block_shift_close_on_hold` and `max_drawer_cash_limit` patches while online as
  well as offline. Preserve exact decimal values, expected revisions, stable
  operation IDs and uncertain-response/context fences. Other or mixed rule
  edits retain the authorized central workflow and explain that target before
  save. Do not add unsupported native policy or cluster authority implicitly.
- Display bootstrap as preparation. Show protected shift review only for an
  explicit registered shift-domain hold; generic item, stock or count failures
  are not grounds for a financial comparison login. Older async snapshots and
  retries must not overwrite newer readiness or connection state.
- Keep online terminal revocation reads at ten seconds and security wake signals
  immediate. Coalesce successful presence writes to sixty seconds per current
  registration/client, retry failed writes and retain unreported sync progress.
  Never discard all terminal-table signals to reduce idle work. Reuse verified
  empty recovery ranges only within the same serializable transaction; do not
  cache empty/proven state across cycles, identities, pools or protected writes.
- Label equal table counts as counts only. Reserve content verification for the
  actual signature comparison; a zero journal or deferred Membership service
  does not certify every workflow. The [18 November evidence](docs/database/beta-local-first-recovery-2026-11-18.md)
  separates source/fixture checks from installed offline, restart and hosted
  acceptance. Keep that distinction when updating these rules after a release.
- Require Main-owned, purpose-bound admission for every native refund, including
  direct IPC calls. Recheck the current actor, local receipt, exact amount,
  branch, policy and context inside the refund transaction. Direct authorized
  users do not need an additional approval PIN or override reason. Hosted
  approvals must be verified by Main against the existing authenticated service;
  never extend their precommit expiry or fabricate a local approver audit. Keep credentials
  out of persisted records and retain stable receipt-proven replay after a lost
  reply. New grouped and FIN62 refunds save a separately signed, exact-operation
  approval companion with their original transaction and existing journal.
  Main's current operator key witnesses a verified synced manager PIN; it does
  not impersonate the manager or require that manager to sign in on this PC.
  Follow branch/global Refund approver rules and their existing fallback,
  offline-approval and online-only settings. Direct authority adds no extra PIN.
  Admission handles still expire before commit. A committed companion survives
  normal handle expiry and restart; verify current original-author, reviewer,
  approver and rule authority before first cloud acceptance. An exact previously
  accepted receipt is replayed without another financial effect. Metadata ACKs
  never prove business acceptance. Missing or revoked authority keeps work held.
  Hosted verification supports both a named human Auth session and a valid
  revocable terminal-bound PIN session, through the existing admission policy.
  Keep the verified operations-PC, witness, branch and approval checks; do not
  require password users to establish another PIN session. Reject machine
  identities and unbound or revoked PIN proofs.
  Retain Main's native handle for the same uncertain renderer refund attempt;
  coalesce authorization, save and post-ACK reconciliation. Retry through Main
  and the existing receipt-proven repository path instead of authorizing a new
  refund or bypassing `EALREADY`. Fence transient attempts to the current actor,
  session, branch, receipt amount and database context. Clear them on context
  change; unused expired admission needs fresh explicit approval. This does not
  extend admission expiry or Main's existing replay-retention deadline.
  Receipt confirmation must consult that same bound uncertain attempt before
  requesting fresh UI approval; a background `refunded` flag alone cannot
  confirm it. Keep Main's receipt proof and ordinary first-attempt policy.
  A never-uploaded FIN62 sale/refund uses Main's separately signed creation-date
  witness for refund-age eligibility, with current policy and exact original
  financial facts. Match an existing central date or the new projected row;
  never fabricate a central sale or wait on that row before registering its
  required financial metadata. Grouped/hosted issuance keeps canonical checks.
  Share pure protocol, transport-schema and exact comparison helpers between
  native and hosted verification. Keep Electron persistence/drivers and React
  initialization outside Worker imports; verify the actual Worker boundary
  when changing these shared modules.
- Keep every unaccepted financial transaction's rows under its existing journal
  ownership, including `stock_delta_applied.movement_id`. A held, failed,
  paginated or ambiguously acknowledged transaction must not leak its remaining
  effects through independent Change Tracking uploads. Retain dependent groups
  together, use the registry's actual primary key, and recheck pending ownership
  inside the existing serializable row capture. Only exact business acceptance
  permits the corresponding journal/checkpoint progress.
- Validate machine-protocol field sets with explicit byte ordering, independent
  of the hosted database's locale. Preserve strict fields, types, financial
  bytes and function privileges. Test a real linguistic collation as well as
  ordinary fixtures; do not change the database locale or weaken validation to
  admit a valid event.
  Normalize SQL UUID lookup arguments at the storage boundary without changing
  signed payloads. Historical SHA-derived publication IDs use canonical
  PostgreSQL UUID syntax; their read-only transport field must preserve those
  IDs. Keep command, author, entity and authorization UUID checks unchanged.
- During atomic extended snapshot recovery, preserve an already corrected cash
  receipt only when a later accepted correction in that same hash-verified pin
  proves the exact current full receipt graph, complete item/tender sets and
  immutable cash-birth fields. Retain the existing journal and Change Tracking
  holds; commit correction, stock proof and cursor together. A newer timestamp
  or revision alone never authorizes skipping or replacing a receipt.
- Recover approval for a saved refund by attaching fresh verified evidence to
  its original operation through the existing write/recovery barrier and sync
  coordinator. Never refund again, repeat stock, change signed monetary bytes,
  replace chain history or fabricate an old manager/source signature. Legacy
  FIN62 evidence may use a clearly identified review reference for the exact
  original operation, bound to the source verified now; it is not an invented
  historical refund key. Missing or ambiguous original evidence remains held.
- Transfer drafts use the existing local transaction/journal. Before centrally
  coordinated approval, dispatch, receipt or verification, require Main's current
  stage permission, correct source/destination branch and the existing verified
  final-upload barrier. Recheck the local transfer identity/version after the
  barrier. Retain the draft and give a clear online/pending-upload result when
  the handoff fails; do not submit an action against an unacknowledged dependency.
- Pending offline work must survive restart, slow connectivity and long offline
  periods. Change Tracking expiry and history-retention policies must not erase,
  acknowledge or overwrite unsynchronized work. Test expired-history recovery
  separately from normal short-disconnect retries. Do not promise unlimited
  offline operation without checking storage capacity and credential/policy rules.
- Synchronize missing or actually changed facts. Avoid rewriting identical rows,
  advancing versions unnecessarily or restarting completed downloads. Use bounded
  pages and durable progress; only advance a checkpoint after its required data
  and acknowledgement/proof have committed. Revalidate scope and pending changes
  before trusting a saved cursor or recovery plan after a restart.
- Versions and timestamps support concurrency checks; neither the highest version
  nor newest device timestamp alone establishes authority. Preserve original shift
  closings and authorized corrections from web or native terminals. Retained
  legacy work with missing evidence needs explicit recovery provenance; never
  fabricate an original author's signature, accepted receipt or cloud baseline.
  Bind acceptance to the stable operation ID and its verified receipt. A cursor
  is a resume position. Advancing it must not rewrite unchanged rows or bump
  their versions. Preserve existing version fields for compatible concurrency.
- Classify exact matches, missing operations, validated cloud evolution and true
  conflicts before recovery writes. Keep both histories for competing closings
  and require an authorized decision where no safe causal winner can be proved.
  Never fix recovery by resetting registration/checkpoints, clearing pending work,
  weakening branch/author checks or ad-hoc manual copying into production.
  Separately approved, guarded maintenance remains subject to exact-target review.
- Apply the same sync rules to every applicable table in normal operation,
  initial setup, offline reconnect, and expired-history recovery. Use the
  existing registry to define each table's authoritative source, supported
  directions, identity, authorized scope, dependencies and deletion policy.
  Declare intentionally local-only or cloud-only tables and excluded columns
  explicitly. Preserve each table's actual branch, cluster, Management and
  private-data boundaries.
  Verify that these match the actual schemas and runtime paths when changing
  sync. Electron saves authorized local work and its outbox in SQL Server
  before upload. Cloud-managed data and accepted web/mobile operations enter
  native replicas through the authorized download path.
- Preserve foreign keys, stable record IDs, exact values and business
  dependencies in both directions. Verify parent and child identities and
  scopes. Apply parent inserts before dependent rows and commit protected
  groups together. Publish local changes only after the group commits. Apply
  permitted deletes in dependency-safe order using the existing tombstone and
  retention rules. If a parent is missing, fetch it within the same authorized
  scope or defer the dependent work. Never disable constraints, invent parents or
  acknowledge an incomplete group to make sync advance. Test missing and
  out-of-order dependencies on both push and pull, including restart and retry.
- For `sale_items`, derive branch scope from the verified `sale_id` to
  `sales.id` to `sales.store_id` relationship. A nullable or blank child
  `branch_id` never makes the item global. Native and hosted bootstrap, feed,
  recovery, detail reads, counts and tombstones must follow that same parent
  scope. At native apply, verify incoming and retained parent bindings inside
  the existing page transaction; a missing or foreign parent keeps the page and
  cursor pending. Hosted readers filter unauthorized candidates before limits.
  Preserve historical child labels instead of rewriting business rows to pass
  a scope check. Other catalogue tables retain their own declared scope rules.
- Use stable row IDs, operation IDs and the table's declared unique keys to
  prevent duplicates in the authoritative transaction. A repeated operation
  for the same confirmed sale bill number reuses that sale and fills only
  verified missing dependencies. A bill number that points to a different
  operation or payload is a conflict. Keep existing invoice uniqueness scopes
  and allow multiple distinct item and payment rows under one valid parent.
- Verify retained records against the authorized scoped snapshot, durable
  operation receipts and saved baselines as applicable. Advance a checkpoint
  only after its required records, dependencies and proof commit. An empty
  pending journal, matching business reference or newer timestamp alone does
  not prove that local work can be replaced, especially after tracking expires.
- Preserve durable evidence tying the exact held-cart revision and the saved
  shift closing to their accepted operations, even after temporary holds or
  history are cleaned up. Recover a verified missing sale, its items and
  payments and complete the matching hold in one local transaction. Remove
  the completed hold from the active list after commit and retain the audit
  history. Apply a dependent shift closure only after its holds are resolved.
  A bill number helps locate the related record; verified branch, operation
  identity and cart evidence establish the link. Keep checkout idempotent and
  keep the existing receipt access scope.
- When saved local and cloud records differ without decisive evidence, preserve
  both and show their versions and timestamps to the authorized reviewer.
  Save and audit the decision through the app, then resume scoped recovery.
  If review storage is unavailable, show the exact prerequisite and keep any
  independently verified comparison read-only. Schema upgrades follow separate
  approval.
- Automatically retry transient failures with bounded requests and controlled
  backoff, without overlapping identical work. Display actual upload/download,
  retry, paused, review-required and failed states. Do not hide a failure, report
  "up to date" with pending work, or repeatedly present a recoverable condition as
  an unexplained error. Revoked permissions hold work for review, not silent loss.
  Keep one coordinated recovery attempt per retry cycle and one persistent
  status for an unchanged review hold. Preserve raw diagnostics and manual retry.

## Fleet recovery, checkout and presentation isolation

- Routine recovery must run through the application for every applicable table.
  A PC reconnecting after a short or long offline period must not depend on an
  operator running per-PC history/count SQL. Use the existing durable jobs,
  validated incremental cursors and bounded resumable recovery. Classify missing,
  matching, pending and conflicting facts; counts alone do not prove equality.
- Keep recovery progress bound to the actual database/profile, registration and
  authorized scope. One PC's completion does not certify another PC. Coordinate
  shared workers, use bounded concurrency and staggered retries, and preserve
  pending work through interruption, expired history and lost acknowledgements.
  A feed's maximum allocated sequence alone is not a commit-order snapshot fence.
- Electron business writes remain atomic with their SQL Server pending evidence.
  Web and mobile use their existing platform adapters under the same authorized,
  idempotent operation contracts. Do not introduce a competing queue or force
  desktop storage assumptions onto another platform. Enforce current branch,
  author, approval and permission checks in the authoritative writer.
- Confirm sale/payment success only after the authoritative commit is verified.
  An uncertain response must retry or read back the same operation identity,
  preserving the accepted receipt and preventing a second charge, sale or stock
  deduction. Preserve exact financial evidence, refunds, original shift closings
  and later authorized corrections; a newer clock/version alone cannot replace
  them. Never silently acknowledge unavailable or unverified historical work.
- Graph controls, sorting and presentation changes must not restart business
  synchronization, reset cursors, clear caches/queues, change registration or
  reload the entire application. Grouping/chart-kind changes use confirmed data
  already read; a genuinely new range uses the existing bounded report reader.
  Preserve the navigation and controls, show scoped progress, reject stale
  responses, and hide old protected data on authority/scope changes. Do not weaken
  authentication or completeness gates merely to remove a loading indicator.
- Test short/long offline periods, multiple PCs with different retained work,
  restart/lost-ack retries, concurrent administrator corrections, denied/revoked
  access and the actual platform adapters before claiming recovery complete.
  Keep one-time reviewed schema upgrades separate from normal automatic recovery.

## Database calls, imports and historical evidence

- Resolve database/backend configuration from the existing trusted operator or
  hosting configuration. Preserve terminal identity, branch/warehouse/cluster
  scope and current authorization on every affected online, local and offline
  path. Do not fall back to another database or untrusted request identity.
- Parameterize SQL values and restrict dynamic identifiers to the reviewed
  schema/registry. Use the configured connection pool with bounded concurrency;
  avoid duplicate in-flight reads and unnecessary polling. A terminal is not
  equivalent to one physical PostgreSQL connection. Do not change pool limits,
  operator connection settings or billing to conceal a query/sync defect.
- Use exactly one transaction owner for a migration execution path. Inspect and
  test the provider/tool wrapper before submitting SQL containing BEGIN/COMMIT.
  Prepare tool-compatible, hash-pinned payloads with rollback and ledger-failure
  checks; never silently strip owner-approved bytes. Changed protected payloads
  require renewed exact-file approval. Verify source, grants and ledger before
  responding to transaction warnings; do not blindly reapply a committed upgrade.
- Preserve timeout/network errors separately from authentication/permission
  denials and business conflicts. Do not count connectivity failures as wrong PIN
  attempts or substitute empty/default settings as successfully loaded data.
  Block edits based on unverified safety defaults; preserve verified offline
  cached/pending settings according to existing policy.
  Upgrades must not silently replace previously matched offline operating rules
  with defaults. Preserve a safe read-only legacy transition until connection
  binding is verified; never use it to enable new privileges or unsupported rules.
- Preserve the original failure code, available primary SQL error number,
  registered table and safe operation phase through driver, coordinator and
  lifecycle wrappers. A generic `3621` or `ESYNC` must not replace an available
  cause. Keep SQL Server and hosted Data API failures distinguishable. Forward
  only allowlisted diagnostic fields; keep credentials, requests and row payloads
  out of diagnostics.
- Spreadsheet imports must preserve valid numeric amounts, decimals and identifier
  text; workbook styling alone must not change their meaning. Do not silently
  strip arbitrary characters into valid numbers, round/truncate amounts, shift
  columns when cells are blank, or discard leading zeros in identifiers. Report
  ambiguous/invalid values by original row and column before saving. Use preview,
  bounded batches and regression tests with real synthetic workbooks; never
  rewrite the operator's source workbook merely to clear formatting.
- Historical reports must use the requested branch/location and exact date/time
  cutoff with an explicit timezone. A shift-closing shortcut uses the saved actual
  closing instant. Prove opening balances and complete, deduplicated movements;
  report incomplete coverage rather than inventing historical stock or valuation
  from today's quantities/prices. Resolve effective-time versus recorded-time
  semantics before implementing historical reconstruction.

### Stock Report integrity and the first Beta stocktake

- Use the owner-approved brief pause only for the first stocktake on the isolated
  Retail POS Beta test branch. Verify the project, branch, terminal registrations
  and physical SQL databases. Stop scoped stock changes through the local and
  cloud write paths, and prove that every stock writer is accounted for and its
  outbound work has drained through the cutoff. An offline, retired, missing or
  unverified writer with unresolved work keeps publication on hold. Scope and
  time-limit the pause, verify its release or expiry, and preserve pending work.
  Obtain separate approval for any other hosted or production stocktake pause.
- Freeze the branch's eligible product roster and record an explicit physical
  quantity for every product, including zero stock. Require a different
  authorized Administrator to review the sealed count and its exact cutoff.
  Publish only the coverage supported by that evidence. Keep the dates before
  the first opening and the exact time of unproved movements unavailable.
- Bind an Electron stock-history download to the verified project, branch, till,
  opening, movement cursor and source revision. Check every scoped page, count
  and digest and revalidate the revision before one SQL Server transaction
  installs the evidence and advances the report head. Preserve local pending
  work, its original payloads, and its acknowledgement path. A report download
  grants no authority to clear a business upload or rewrite current stock.
- Conserve each branch's stock in a product merge. In the same authoritative
  operation, credit the surviving product only with quantities from products
  actually accepted for removal. Held products retain their stock and audit
  references. Preserve the surviving canonical SKU, branch rights and exact
  retry receipt. Verify the matching local and central accepted effects.
- Catalogue-only bulk imports create no stock movement. Posting receiving,
  transfer or adjustment work applies the approved stock change through its
  own authorized writer and durable acknowledgement. Keep zero-stock catalogue
  membership distinct from quantity and stock movement.

## Approved-scope autonomy and release evidence

- Continue routine implementation, relevant tests, agent review and beta PR updates
  within an approved batch without repeatedly requesting the same permission.
  Ask only for missing business decisions, materially new scope or a separately
  protected action. Approval is not implied by elapsed time or a passing test.
- Keep focused fixes in separate beta PRs with current heads and honest status.
  Do not call a classifier, prepared migration, passing CI or published installer
  a completed end-to-end recovery. Track implementation, regression tests, beta
  acceptance, database application and production publication separately.
- Preserve the existing exact-target database and specific production-promotion
  approval requirements. General instructions to finish quickly do not authorize
  live data repairs, billing changes, security bypasses or unreviewed releases.

## Approved page workflows, staff permissions and Settings

- Follow the owner-approved [POS workflow rules](docs/pos-workflow-rules.md)
  before changing terminal/login behavior, staff permissions, any Settings
  subpage, Home, Selling, Inventory or related operational workflows. The
  reference includes T1–T24, S1–S14 and the page/action responsibilities.
  These are requirements, not evidence that the current implementation passes.
- Automatically synchronize every eligible PIN user's authorized account,
  active status, branch scope, effective permissions and protected sign-in
  verification data to connected local SQL when the online source is reachable.
  Use verified registered-device authority independently of the current staff
  session. A prior login on that PC is not required. Preserve scope, offline
  validity and credential-purpose checks; never copy readable PINs/passwords.
- Once signed in, a person may perform every granted action within their
  authority without an additional approval PIN. Sign-in PINs, approval
  credentials, selected approvers and financial limits remain separate. Existing
  rules requiring approval beyond direct authority remain in force; no broad
  permission or administrator label bypasses terminal/branch binding.
- Preserve explicit user grants/denials on ordinary account edits. Explain the
  effect of an intentional role change before saving. Show page/action entry
  dependencies in the editor; never silently widen access or save an unusable
  grant as fully effective. Delegatable grants must work across navigation,
  direct routes, server/native writers and offline paths within their scope.
- Enforce each page's workflow on its subpages, dialogs, imports/exports,
  shortcuts, direct APIs/RPCs and IPC. Preserve existing financial calculations,
  durable operation identities, exact-once business effects and audit history.
  Membership remains ON HOLD. Keep unverified or ambiguous business behavior
  tracked rather than inventing a policy while implementing a page.
- When an approved change adds or changes a page/action, update its workflow
  mapping and shared permission registry as applicable. Keep required scope,
  prerequisites, save/commit result and recovery behavior explicit.
- Record rule compliance separately from implementation, focused tests, installed
  acceptance and release. A documentation approval is not permission for live
  database changes, production promotion or another installer publication.

## Terminal activation and staff login lifecycle

- Restore saved connection and registration state before selecting setup,
  activation or login. Determine verified-fresh versus recovery-required from
  native historical provisioning evidence before any hosted claim. Missing or
  unreadable renderer/native configuration must not classify a used device as
  fresh. Genuine first activation has no previous-SQL prerequisite.
- Manual codes and QR pairing follow the same project, device-family, physical
  proof and canonical-registration checks. Report success only after native
  persistence and strict read-back. A hosted claim alone is not confirmation
  that Windows saved registration, and activation grants no staff-session rights.
- Normal reopening, application updates, lock and logout preserve terminal
  registration, operator connection settings and durable pending work. End the
  person session independently; never require reactivation for a network failure.
- Verify staff credentials, active status, device eligibility and authorized
  branch scope through the authoritative login/session path. Use supported
  offline verification only when the service cannot judge the request; explicit
  wrong credentials, inactive/locked accounts, revocation and permission denial
  must not become offline login. Renderer roles/caches grant no native authority.
- Preserve the existing Operations branch lock and distinct Management scope.
  Emergency Access grants only its native-verified, allowlisted repair session;
  it does not grant cashier access, financial approval or cross-branch authority.

## Electron startup and local SQL readiness

- Electron must support its approved offline workflows when the configured local
  SQL database is ready and offline session/policy authority is valid. Loss of
  internet is not loss of local SQL. Keep explicit online-only operations and
  unreadable/unavailable local storage accurately distinguished.
- At normal offline close, finish accepted renderer/native writes and verify
  readable durable pending storage, then close without attempting cloud sync or
  presenting a cloud-synchronization-required dialog. Preserve pending work and
  resume eligible sync on reconnect/restart; do not fabricate cloud acceptance.
- At online close, use existing authorized final-sync policy and bounded retry.
  No pending work closes normally; loss of connectivity returns to safe offline
  closing after local durability checks. Never send anonymous staff operations
  merely to close a signed-out terminal. Local write/storage failure remains a
  real blocker. SQL files alone do not establish this application behavior.

- On normal application startup, automatically restore the enabled, saved local
  SQL Server profile and its vault credentials and open the native connection.
  Do not wait for Settings, staff login or the first sale to begin connecting.
  Keep a visible startup/progress window while this work runs.
- A connected socket is not local trading readiness. Validate the saved target,
  required schema and essential scoped bootstrap through the existing canonical
  startup service before declaring SQL ready for business operations. Preserve
  independent registration, person-session, branch and action-permission checks;
  database readiness grants no user authority.
- Coordinate startup and reconnect through the existing native service and pool.
  Show an actionable failure/retry state and preserve saved settings and pending
  work. Respect operator-disabled SQL and the approved unavailable-SQL online
  fallback; return to local operation only after verified local readiness.
- A normal quit during startup waits for the accepted local SQL validation
  work before tearing down Electron. Record the intentional quit after local
  cleanup without marking the build healthy or counting the quit as a failure.
  Keep genuine failed launches eligible for Safe Mode.
- This rule grants no additional migration, schema/data repair or production
  approval. Missing/unreadable previous SQL configuration must not be interpreted
  as a fresh terminal or proof that no pending transactions exist.
- Distinguish three connection states. Use the configured online database when
  local SQL is intentionally disabled or verified unconfigured. An approved
  online-only session may use the configured online route within its verified
  authority. Enabled SQL that failed, is unreadable or is awaiting recovery
  retains pending work and follows the existing recovery or authorized
  online-session flow. A failed local write stays a failed save.
- Explicit replacement registration may proceed online only through
  native-authorized recovery that seals and preserves the prior binding,
  settings and retained evidence, and holds prior local storage from reopening,
  business writes and synchronization under the replacement identity until its
  recovery is verified. Never turn that hold into an empty-queue acknowledgement
  or silently clear it. Ordinary valid-registration SQL reconnect stays automatic.
- A retained old-local recovery hold must not block authorized read-only SQL
  discovery. After verified replacement activation, permit a separate verified
  fresh current SQL target through the existing Settings authorization. Require
  schema readiness and locked verification of all user tables: only the exact
  migration ledger and unchanged built-in default-group seed may contain rows.
  Pin and recheck physical database identity and current registration/project
  before migration, bootstrap, trading or sync. Retain old profiles, encrypted
  credentials and recovery evidence separately; never relabel old transactions.
  Normal disable keeps current credentials; another registration or arbitrary-
  profile administrative path must not discard or bypass retained current work.

## Supabase configuration (do not regress)

`supabaseConfig()` in `src/lib/external-supabase-config.ts` is the single
resolver for the Supabase URL and publishable key. On a till or phone the
values come only from Settings → Database & Cloud Connection, sealed in the
Electron OS vault (DPAPI) or the Android Keystore and applied through
`setTerminalSupabaseOverride()`. The web deployment supplies them through
hosting variables printed into the page.

Legacy generated clients (`client.ts`, `client.server.ts`,
`auth-middleware.ts`, and `auth-attacher.ts`) must not be reintroduced or
registered in `src/start.ts`. They bypass the runtime operator configuration
that device builds require. The guard lives in
`src/lib/__tests__/own-database.security.test.ts`.

## iOS signing key preservation

- Preserve the existing iOS signing/OTA private key in `.ota-private/manifest-ed25519.pem` and any operator-supplied signing credentials. Never delete or rotate them during checkout, build, installer, or version cleanup.
- Keep private keys ignored by Git and out of commits, logs, PRs, and published artifacts. Verify an existing key matches `ios-ota.public.json` before using it; do not generate a replacement without an explicit owner request.

## Required project memory and session startup

- Before development, read [PROJECT_MEMORY.md](docs/PROJECT_MEMORY.md) and
  [TASK_TRACKER.md](docs/TASK_TRACKER.md), including the active approval boundary,
  unresolved findings, on-hold work and latest owner decisions. Follow their
  links to the relevant technical references; historical audit reports are
  evidence for their recorded revision, not proof of the current system.
- Verify the absolute Git root, branch, HEAD, version metadata and working-tree
  changes before editing. This repository has multiple worktrees, including
  older release checkouts. Never select a checkout by its folder name or version
  label alone, reset someone else's work, or copy older source over newer work.
- Reuse existing instructions and technical documents. Preserve applicable
  rules and explain any targeted correction. Do not create competing trackers.
- New owner instructions and corrections must be recorded in the tracker before
  dependent implementation, with acceptance criteria, affected scopes and any
  superseded decision. Update approved decisions in project memory. If authority
  or intent is unclear, retain a pending clarification and continue independent
  authorized work; never silently invent a business rule.
- Preserve every unfinished task across interruptions, pauses, handoffs and
  context compaction. Maintain a current next step and evidence. Report task
  starts, entry into verification, completions and blockers with one concise
  status update per meaningful transition (completed / working / pending).
  Avoid repeating unchanged status. Do not discard tasks because a newer request
  arrives unless the owner cancels or supersedes them.
- Keep implemented work separate from verified work. Record revision, test
  command/result, environment and unverified behavior. A visible page, enabled
  checkbox, source assertion, build, merged PR or published installer alone is
  not end-to-end verification. Track database application, merge, deployment
  and publication separately. Link the current release evidence in the
  relevant tracker entry or PR and retain dated reports as historical evidence.
- Record the hosted project/patch, installed version and tested source SHA
  independently. A hosted repair does not certify an older installed client.
  Trace installed sync acceptance through the requested UI action, local SQL
  commit and durable pending evidence, then authorized cloud acceptance and
  read-back of the same operation/record and branch. Check a cloud-origin change
  reaching local SQL without an upload echo when verifying two-way behavior.
  Distinguish local-database checks from an actual network-disconnected or
  restart test. Preserve unobserved steps as pending and keep each result scoped
  to its tested workflow. See the [17 November beta smoke evidence](docs/database/beta-sync-smoke-2026-11-17.md);
  that report is revision-specific evidence, not blanket POS certification.
- Build financial smoke fixtures through the actual domain builder/API and
  validate their required evidence before saving test money. Preserve the exact
  owned database, operation and sealed keys on unexpected failure so a fresh
  process can resume them. Never rewrite saved financial facts, clear pending
  work or relax production validation to repair an incomplete test fixture.

## Controlling POS architecture: branch-locked normal terminals

- A normal/Operations Electron or mobile POS terminal is registered to one
  specific branch. Every user, including an administrator or manager with wider
  account permissions, remains restricted to that terminal's branch. There is
  no ordinary branch-switching operation on that terminal.
- Enforce that restriction on backend reads/writes, direct APIs/RPCs, Electron
  IPC, local SQL/offline operations, caches and synchronization. Hiding a
  selector is insufficient. Resolve branch identity from verified registration
  and session state, never an untrusted renderer/request field. Omitting a
  request token must not discard a persisted terminal binding.
- Management device type, registered branch, account-authorized scope, role,
  action permission and selected view are distinct. Management terminals may
  select only authorized branches; their type or a NULL branch never grants all
  data. Do not apply an Operations lock to an authorized management device.
- Web management uses browser authentication, not native terminal registration.
  Inspect the existing temporary registration, pairing and activation flows for
  both Electron and mobile, including Operations versus Management, before
  proposing related authorization changes. Do not duplicate or retire them
  merely because their purpose is unclear.
- Warehouse permissions and picking remain subordinate to a normal terminal's
  branch. Another branch's protected warehouses or inventory require an
  explicitly approved cross-branch workflow. Do not infer an independent
  warehouse ACL or new access entitlement from the location hierarchy.
- Preserve the approved DEC-48 exception in project memory: a normal terminal
  may view positive available stock at other active locations in its own cluster
  through the authorized availability workflow. This grants no operating-branch
  switch, other-branch write access or cross-cluster catalogue visibility. SKU
  allocation remains global; per-location quantities remain distinct.
- Shared physical SQL storage grants no shared access. Management replication
  stores only its configured authorized scope. Preserve original business,
  branch, warehouse, terminal and user attribution where applicable through
  writes, reconnects, retries and synchronization; never relabel pending work.
- Branch reassignment requires a separate authorized administrative process,
  audit logging and safe handling of pending/failed/conflicted transactions.
  Ordinary session adoption or renderer activation mirroring is not reassignment.
- Preserve cluster catalogue boundaries and approved transfer rules. A broader
  management view does not authorize merging catalogues or stock ownership.

### Explicit cluster and branch workflow rules

- Follow the C1–C18 and B1–B18 rules and scope matrix in
  [POS workflow rules](docs/pos-workflow-rules.md#cluster-and-branch-rules)
  on every affected page, dialog, direct endpoint, native operation, replica and
  recovery path. Catalogue membership, stock location, user authority, device
  binding and a selected report filter are different scopes.
- Branches in the same configured cluster share the eligible catalogue; stock,
  sales, tenders and shifts retain their branch/location ownership. Global SKU
  allocation does not merge cluster catalogues. Cross-cluster product visibility
  requires approved catalogue membership or verified posted purchase/transfer
  receipt evidence; zero stock-map keys or draft documents do not prove receipt.
- All newly created distinct products use one global running SKU allocation
  across every branch/cluster in the same POS database. Use the existing atomic
  allocator and non-overlapping reserved ranges; never restart counters per
  branch, cluster, PC or display format. Imports/manual codes obey global
  uniqueness too. Retrying/replicating the same canonical product retains its
  SKU. Offline creation uses only valid reserved numbers; no local MAX+1 fallback.
  Reserved ranges can leave gaps or reorder creation-time display; do not claim
  gapless offline numbering or renumber existing products to conceal that.
- A verified posted purchase receipt or completed incoming transfer adopts the
  same canonical product/SKU into the receiving cluster's normal catalogue.
  Persist that membership independently of current quantity and recent history
  windows. At zero stock keep the product available to the receiving catalogue,
  marked Out of stock; never automatically demote it to reference-only, unshare
  it or archive it globally. Ordinary explicit product restrictions, staff rights
  and branch stock policies still apply. Keep origin and branch quantities clear.
- Optional manual cross-cluster reference viewing remains separate from manual
  sellability for products not yet adopted there. View alone grants no sale,
  stock or financial rights. A separate manual reference grant is not required
  after legitimate receipt. Manual unsharing cannot erase received membership,
  actual stock or history; explicit archive/restriction is a separate audited
  action. These are requirements to implement/verify, not current pass results.
- Preserve the normal-terminal branch lock and the positive, active-location
  same-cluster availability exception. Management may use only its authorized
  branch set. Neither a shared cluster, NULL assignment nor a physical local
  replica grants additional staff permissions or branch access.
- Apply the exact declared scope and ownership on initial download, ordinary
  upload/download, reconnect and expired-history recovery. Pause controls retain
  pending work; they do not acknowledge it. Never relabel old work after a branch,
  cluster, registration or connection change.
- Scope changes need authorized save/read-back, appropriate locks and deliberate
  recovery of retained work. A report filter or settings selector is not branch
  reassignment. Preserve separate branch financial history and warehouse ownership.
  Do not claim a saved private-stock preference, arbitrary Management subset or
  warehouse ACL is enforced without verifying the actual runtime boundaries.

## Controlled audit and implementation

- Membership is **ON HOLD**. Do not redesign, activate or modify it. A confirmed
  critical shared dependency requires the owner's approval before any Membership
  change; do not treat general stabilization approval as that exception.
- Read the tracker's current scope and approval boundaries. Older batch approvals
  remain historical evidence for the work they name.
- Investigate first and present confirmed defects separately from suspected
  risks and unverified behavior. Identify the recoverable baseline, affected
  dependencies and focused verification for the approved work. Follow the
  approved-scope autonomy rule for routine implementation and tests. Obtain
  separate approval for scope changes and protected actions.
- Preserve unrelated behavior and existing permission grants/denials. Never
  bypass authorization, widen access or silently change operator settings to
  make a test pass. Keep UI-only changes separate from financial/access changes
  and avoid unnecessary refactoring. Scope expansion requires owner approval.
- Use isolated fixtures/development databases for financial, stock, security and
  failure tests. Never perform destructive tests against real business data or
  apply production schema/data changes without explicit approval and reviewed
  migrations. A beta connection label does not prove database isolation.
- Require both allowed and denied cases for branch/warehouse access, direct
  routes/APIs, permissions, revoked/stale sessions and offline/reconnect/retry.
  The eight mandatory terminal scenarios are in PROJECT_MEMORY.md. Test the
  installed IPC wrapper and complete workflow, not just a helper in isolation.
- Audit modules, subpages, popups, settings persistence and shared dependencies.
  Use agents for independent bounded audits/reviews when requested; give each
  an explicit scope and write authority, reconcile results, and keep one owner
  per edited file. An agent report is not verification by itself.
- UI must be minimal, responsive, readable and practical on desktop/tablet/mobile.
  Give each setting/field responsibility one clear management home; verify actual
  consumers before consolidating duplicate editors. Preserve distinct scopes and
  workflows, use links to shared controls, and retain necessary business fields.
  Preserve essential business information; use compact rows/cards or expandable
  detail rather than squeezing desktop tables into phones. Check actual renders,
  accessible labels, keyboard/touch use, numeric wrapping, loading/empty/error
  states and permission-hidden layout reflow. Report unavailable device checks.
- After each batch inspect the final diff and report files changed, corrected
  defects, executed checks/results, remaining risks, unverified behavior and
  recovery instructions. Do not claim a full system or security scan passed
  unless its requested scope was actually completed.
