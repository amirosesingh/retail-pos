# Production hardening audit — existing POS only

Read-only audit of the shipped system, followed by targeted fixes. No subsystem was
rebuilt, duplicated or replaced. Emergency access was kept.

## Area classification

| Area | State | Evidence |
| --- | --- | --- |
| Branch / terminal ownership on the relay | Implemented | `src/core/api/relay-policy.server.ts:46-70,384-406` rewrites or refuses every store-scoped row against the proven caller's branch; child rows resolve through their parent (`sale_items` → `sales`). |
| Caller proof | Implemented | `src/core/api/pos-relay.server.ts:451+` fails closed and reads all proofs, so an admin on a registered till keeps the admin role pinned to that till's branch. |
| Allow-listed routines | Implemented | `RELAY_RPCS` (`pos-relay.server.ts:266`) checks permission and record ownership before running `sale_refund` with the service key. |
| Local SQL writes | Implemented | `electron/db/repo.cjs:536-547` runs each batch in one SQL Server transaction with rollback. |
| Central batch writes | **Fixed** (was production-risky) | PostgREST has no cross-request transaction; `commitOps` ran ops in a bare loop, so a refusal mid-basket dropped the remaining writes. |
| Stock deltas | **Fixed** (was incorrect) | `withRelativeStock` only matched `insert`, but every movement is written as `upsert`, so the relative-delta path was dead code and each sale pushed a client-computed absolute stock figure. |
| Duplicate sale writer | **Fixed** (was dead + risky) | `db.recordSale` was fire-and-forget; the register uses the awaited `pos-store` path. The unawaited copy is removed. |
| Idempotency | Implemented | Client-generated ids with `on_conflict` merge (`pos-relay.server.ts:347-368`), per-tender `client_transaction_id` 409 reconciliation, movement-id dedupe in `stock_apply_deltas`. |
| Approvals | Implemented | Ticket snapshot + fingerprint verified at claim time; single-use grant. |
| Secrets / `.env` | No action needed | `.env` held only a public publishable key, URL and project id, and is git-ignored (`.gitignore:39`). No service-role key, JWT or `sb_secret_` value was present, so nothing required rotation. |
| Emergency access | Untouched | Device-clock code, independent of network, registration and cloud config, as specified. |

## Fixes applied

1. **`src/core/api/pos-db.ts` — `runBatchLive`.** All three commit paths (online-only,
   desktop, browser) now run the batch through one helper. On a non-connection failure
   after at least one write has landed, the remaining ops are enqueued in the durable
   outbox, a `partial_commit` diagnostic is recorded, and the error is still raised.
   Connection failures are untouched so the existing local fallback keeps working.
2. **`src/core/api/pos-db.ts` — `withRelativeStock`.** Counts `upsert` movements as well
   as `insert`, restoring the server-side relative stock application and removing the
   lost-update race between two tills selling the same product.
3. **`src/core/api/pos-db.ts` — removed `db.recordSale`.** No unawaited sale writer can
   let a checkout print while the bill is silently lost.
4. **`src/lib/diagnostics.ts`** — new `partial_commit` diagnostic kind.

## Tests

`src/lib/__tests__/online-commit.test.ts` gained "parks the rest of a half-stored basket
instead of dropping it". Full suite: 59 files, 406 tests, all passing.

## Stage 2 — terminal lifecycle, desktop bridge, emergency access (v1.3.116)

### Terminal lifecycle

| Rule | State | Evidence |
| --- | --- | --- |
| The trust decision belongs to the server | **Fixed** | `terminal_token_claim` is now a `SECURITY DEFINER` routine that decides; the till only presents an id, a device name and a device proof. |
| A claim is bound to the device that made it | **Fixed** | `src/core/activation/device-proof.ts` derives a per-device HMAC from the sealed device secret and sends it as `p_proof_hash`; a claim from a second device is refused, the same device may re-present. |
| A revoked or expired code cannot activate | **Fixed** | The routine raises `TERMINAL_TOKEN_REVOKED` / `TERMINAL_TOKEN_EXPIRED`; `activationFailureMessage` turns each into a plain sentence instead of a generic failure. |
| A code for a closed or missing branch cannot activate | **Fixed** | `TERMINAL_BRANCH_REQUIRED` / `TERMINAL_BRANCH_INACTIVE`, where inactive means the `stores` row is deleted, archived or switched off. |
| Revoked credentials cannot be reused for sync | Implemented | `pos-relay.server.ts:499` refuses a revoked terminal token before any write. |
| Offline grace really ends access | Implemented | `startupDecision` treats `grace-expired` as unregistered (`startup-decision.test.ts`). |

Verified against the live database with a throwaway branch and four throwaway tokens:
first claim accepted, second device refused, same device re-accepted, revoked / expired /
inactive-branch each raised their own error. All test rows removed afterwards.

### Desktop bridge

- `electron/ipc-guard.cjs` gained declared argument shapes: `writeOp`, `writeOps`
  (max 500 ops, 5000 rows each, five known kinds, identifier-only table names),
  `options` / `connectionConfig` (scalars only) and `terminalConfig`.
- `electron/main.cjs` applies them to `pos:write`, `pos:write-batch`, `pos:connect`,
  `pos:test`, `pos:housekeep`, `pos:restore*`, `pos:compare-*` and `terminal:write`,
  with the check outside the `try` so a bad argument is refused rather than reported
  as a database error.
- `electron/terminal-store.cjs` now has exactly two states: sealed, or refuse. When the
  machine's vault is unavailable the activation is not written at all and the operator is
  told why; an older plain file is migrated into the vault and deleted on first read.

### Emergency access

Every attempt — granted or refused, with the remaining attempts and cool-off — is written
to the local audit trail and travels with the next sync. Rate limiting and cool-off were
already in place via `pin-lockout.ts` and are unchanged.

### Tests

New: `terminal-store.test.ts` (sealed write, refusal without a vault, migration of a plain
file) and `ipc-guard.test.ts` (write kinds, table names, batch caps, nested options,
activation shape, clean refusal). Full suite: 61 files, 416 tests, all passing.

### Verdict

Still **NOT PRODUCTION READY**: the failure-injection suite, the verification matrix and
the go-live checklist remain, and nothing has yet been exercised on real hardware
(receipt printer, cash drawer, a Windows till, an Android device).

## Stage 3 — prove it breaks safely (v1.3.117)

Failure injection, not code review: every case below broke the system on
purpose and the result was recorded.

**Defect found and fixed — a blind cash count could be lost.** Closing a shift
sent the count straight to the central database. If the line was down at that
moment the count was simply refused with "The central database could not be
reached" and the drawer had already been counted. `submitCashCount` now parks
the call in the durable outbox when, and only when, nothing could reach the
central database, carrying the same client key so a replay cannot count the
drawer twice, and the till says the count is saved and will be sent. A count
the server refused on principle (no permission, wrong state) is still refused
on the spot and never parked.

**Confirmed safe.** A refused first row leaves no bill anywhere; a refusal
part-way through parks the rest of the basket; a dropped line writes the whole
basket locally on desktop; a resent tender rewrites the same row rather than
charging twice; a retried stock movement moves nothing the second time; a
movement for another branch is refused. These were checked against the live
database with a throwaway branch and product, all rows removed afterwards.

**Known limit, accepted.** Two tills selling the same last unit both succeed:
the row is locked, the arithmetic stays exact and the branch and total figures
stay in step, but the count goes negative rather than the second sale being
refused. This is normal POS behaviour and shows on the reorder report; refusing
an oversell would be a business decision.

**Still not proven.** The relay's mid-basket refusal of a revoked token has no
automated test, and nothing here touches real hardware. See
`verification-matrix.md` for the full picture and `go-live-checklist.md` for
what must be signed off on the shop floor.

**Verdict: NOT PRODUCTION READY** until the hardware rows in the matrix are
signed off.

---

## Stage 4 — recovery scope, desktop hardening, local upgrades (v1.3.118)

| Finding | Severity | Root cause | Where | Fix | Test | Limit |
|---|---|---|---|---|---|---|
| Recovery screen exposed till-wide settings to anyone holding the recovery code | High | `RecoveryHub` rendered every card unconditionally | `src/platforms/web/components/pos/RecoveryHub.tsx` | Only activation, cloud connection and branch binding are open; SQL Server, offline grace and hardware need a supervisor or administrator | Manual walk-through of both roles | Recovery code is still a device clock code by the owner's decision |
| Recovery hint told a bystander how to make the code | High | The hint spelt out `YYYYMMDDHHMM` | `EmergencyPinGate.tsx` | Hint reduced to "the recovery code for this device"; it no longer teaches the format | — | As above |
| Activation could sit on disk in an editable file | High | `terminal-store.cjs` fell back to plain JSON when the vault was unavailable | `electron/terminal-store.cjs` | Sealed copy only; a legacy plain file is migrated once then deleted, and a machine without a vault stores nothing | `terminal-store.test.ts` | — |
| Desktop database tools were reachable by anyone at the keyboard | High | The `sqladmin:*` channels had no authorisation | `electron/admin-session.cjs`, `main.cjs`, `DatabaseExplorer.tsx` | Every channel except `status` needs an administrator username and PIN unlock, good for fifteen minutes and renewed on use | `admin-session.test.ts` (4 cases) | Rate limiting of the unlock itself relies on the shared PIN throttle |
| The till window could be navigated to any site while holding the bridge | High | No navigation, popup or webview guards, and no content policy | `electron/main.cjs` | Same-origin only, popups denied, external links handed to the browser, webviews refused, strict content policy on every response | `window-lockdown.test.ts` | — |
| Oversold items were not visible where they are worked with | Medium | Stock figures were rendered plainly | `ProductPicker.tsx` | A figure below zero is shown in red with "Oversold — count this item and correct it" | Visual | The oversell itself stays allowed (see Stage 3) |
| The till's own database had no version, so a half-finished upgrade was undetectable | Resolved | There was no controlled migration record | `electron/db/migrations.cjs` | `pos_schema_migrations` records applied migrations transactionally; generated schema validation reports the installed shape | SQL Server schema and migration tests | A real SQL Server smoke run remains required before release |

**Regression.** 66 files / 433 tests. One flake: `driver-install.test.ts` times
out under a full parallel run and passes on its own — a slow fake timer, not a
defect. Type check clean.

**Verdict: NOT PRODUCTION READY** — unchanged. The hardware rows and the relay
revocation row in the matrix are still open.

## Stage 5 — desktop channel privilege and fatal-fault handling (v1.3.119)

**Finding: every desktop channel was callable by anything running in the window.**
Severity: high. Root cause: argument checks existed (`electron/ipc-guard.cjs`) but
no caller check, so connection details, the terminal identity, stored
credentials, the audit trail and the database tools could be changed by any code
in the window. Fix: `electron/ipc-privilege.cjs` classifies every channel as
open / supervisor / admin and wraps `ipcMain.handle`, so the desktop process
refuses before the body runs; an unclassified channel defaults to admin.
`settings:set` and `config:set` are classified by the setting name, so a
cosmetic preference stays open while anything naming a backend, branch,
database, grace period, key, token or audit setting needs an administrator.
An unconfigured till may still be set up: a short first-run list is open only
while there is no activation, no local connection and no cloud credentials.
Levels reuse the existing till unlock (`electron/admin-session.cjs`, now with a
supervisor level); no second role store. Test:
`src/core/activation/__tests__/ipc-privilege.test.ts` (7 cases).
Limitation: the unlock is per-machine and in memory for 15 minutes.
Hardware needed: a Windows till to confirm the prompt on real staff records.

**Finding: an unhandled fault always kept the till trading.**
Severity: medium. Root cause: both process-level handlers logged and continued,
including for a corrupt local database file or an unreadable sealed activation.
Fix: `recordFault()` in `electron/main.cjs` classifies the fault; a recoverable
one is logged as before, a fatal one is logged as fatal and broadcast on
`app:fatal`, and `PrivilegeGate` replaces the register with a stop screen
telling the operator not to take payments. Test: covered by review; no automated
case yet because it needs a real corrupt database file.
Hardware needed: a Windows till.
