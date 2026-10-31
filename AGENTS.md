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
  and publication separately.

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
- Shared physical SQL storage grants no shared access. Management replication
  stores only its configured authorized scope. Preserve original business,
  branch, warehouse, terminal and user attribution where applicable through
  writes, reconnects, retries and synchronization; never relabel pending work.
- Branch reassignment requires a separate authorized administrative process,
  audit logging and safe handling of pending/failed/conflicted transactions.
  Ordinary session adoption or renderer activation mirroring is not reassignment.
- Preserve cluster catalogue boundaries and approved transfer rules. A broader
  management view does not authorize merging catalogues or stock ownership.

## Controlled audit and implementation

- Membership is **ON HOLD**. Do not redesign, activate or modify it. A confirmed
  critical shared dependency requires the owner's approval before any Membership
  change; do not treat general stabilization approval as that exception.
- Read the tracker's current batch authorization before editing. Batch 0 approved
  documentation only; on 2026-10-27 the owner separately approved Batch 1 to review
  Electron/mobile Operations and Management activation and fix trusted branch
  locking while preserving cashier checkout. This does not authorize unrelated
  corrections, live database changes, publication or production promotion.
  Approval for one batch is not approval for the remainder of the roadmap.
- Investigate first and present confirmed defects separately from suspected
  risks and unverified behavior. For each proposed implementation batch identify
  its recoverable Git baseline, affected files/dependencies, behavior, regression
  risks, tests and recovery plan; obtain approval before implementation.
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
