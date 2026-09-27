# Full audit — Web, Android and Windows

Date: 2026-09-02. Scope: `src/`, `electron/`, `scripts/`, `.github/`, `supabase/`.
Method: repo-wide static review, dependency scan, database linter, plus targeted
reads of the checkout, sync, activation and recovery paths.

**No code was changed for this report.** Each item is ranked and carries the file
reference and a one-line fix so you can choose what gets done next.

Summary: 3 Critical, 8 High, 9 Medium, 8 Low.
Dependency scan: no high or critical npm vulnerabilities.

---

## Critical

### C1 — Every APK and installer ships your database identity
`src/lib/external-supabase-config.ts:22` hardcodes the project URL
`https://qhrufhtbeguxydenzfey.supabase.co` and its publishable key as the first
resolution source, and `src/lib/public-config-script.ts:10-16` writes that
resolved config into a `window.__POS_CONFIG__` script inside the rendered
`index.html` that `scripts/mobile-build.cjs` packages into the APK. The Android
workflow additionally bakes your hosted backend address
(`.github/workflows/android-apk.yml:75`, `VITE_POS_SERVER_URL`), and that backend
holds the service-role key. Anyone you hand a build to receives a client already
pointed at your tenant.
**Fix:** remove the hardcoded constant and omit the config script from
mobile/desktop shells; provision per device. (This is Part 1 of the approved plan.)

### C2 — Cashier PIN sign-in is public and unthrottled
`src/routes/api/public/cashier-login.ts` and `src/lib/cashier-login.server.ts:29-95`
verify the PIN with no attempt counter, delay or lockout — failures are only
audited after the fact. Manager PINs *are* throttled
(`src/lib/pin-throttle.server.ts`, used by `authorization.functions.ts:134` and
`pos-rules.functions.ts:135`); the cashier path is not. Compounded by M1 below,
which hands an attacker the usernames and the exact PIN length.
**Fix:** route cashier login through the same `throttleStatus`/`throttleFail`
helpers, keyed by username and caller IP.

### C3 — Checkout can tell the cashier "nothing was saved" after the sale is stored
`src/lib/pos-db.ts:1929-1956` commits six operations sequentially with no
transaction. If the sale header lands and a later operation fails,
`src/lib/use-checkout.ts:458-463` shows *"Payment was not saved… Nothing was
stored"* while the sale row is durably in the database, and the cart stays loaded
— inviting a second collection of the same payment.
**Fix:** make that message conditional on whether the header committed
(`db.saleAttemptExists`), and only claim "not saved" when it did not.

---

## High

### H1 — Emergency PIN has no attempt limit
`src/lib/emergency-pin.ts:42-84` and `electron/emergency-pin.cjs:80-111` derive a
6-digit code valid across a ±3 minute window; `electron/main.cjs:1477` exposes
`emergency:verify-pin` over IPC with no backoff or lockout. A million guesses
against a live window is scriptable.
**Fix:** exponential backoff and a max-attempts lock in the main process before
calling `verifyPin`.

### H2 — Full central schema readable by any till session
`src/routes/api/public/health-metadata.ts:37-107` returns the complete table and
column inventory to any caller holding a cashier or terminal token, not just an
administrator.
**Fix:** gate `shapes`/`relations` behind a staff/manager role, not bare terminal identity.

### H3 — Service-role key accepted under three different environment names
`src/lib/pos-relay.server.ts:85-100` silently takes the first of
`POS_SUPABASE_SERVICE_ROLE_KEY`, `POS_SERVICE_ROLE_KEY`,
`SUPABASE_POS_SERVICE_ROLE_KEY`. Stale duplicates stay live and rotation cannot
be verified.
**Fix:** one canonical name; fail loudly when more than one is present.

### H4 — Hydration mismatch on every page load
`src/lib/theme.tsx:46-47` toggles `class="dark"` on `<html>` from a head script
before hydration, but `src/routes/__root.tsx:178` renders `<html lang="en">` with
no class and no `suppressHydrationWarning`; `theme.tsx:54` separately seeds
`prefersDark` to `true`. This is the console error you are seeing today.
**Fix:** add `suppressHydrationWarning` to `<html>` and seed the client default
from the same value the boot script wrote.

### H5 — Two disagreeing definitions of "online"
`src/components/pos/SyncSettings.tsx:63,102` shows Live/Online from
`isOnline()` (`sync-outbox.ts:355-357`, raw `navigator.onLine`), while activation
and the cloud gate use the real heartbeat `isCloudConnected()`
(`registration-status.ts:24-27`). Sync & Backup can read "Live" while every write
is failing.
**Fix:** point `SyncSettings` at `isCloudConnected()`.

### H6 — Bill numbers can duplicate on a fully offline device
`src/lib/bill-number.ts:197-209` reads the sequence and computes the next value
with no lock before the caller writes it back. Online, the unique index
(`supabase/schema…:5003`, `sales_store_bill_number_key`) plus the retry loop in
`pos-store.tsx:1049-1066` catches it; offline there is no such safety net.
**Fix:** serialise compute-and-write behind a per-device async mutex.

### H7 — Dead email/password sign-in screen still ships
`src/components/pos/LoginScreen.tsx` has zero importers anywhere in `src`
(verified) yet exposes a full sign-up path. Real entry is PIN/terminal based.
**Fix:** delete it along with the unused `signUp` plumbing.

### H8 — Two implementations of the security alert bell
`src/components/pos/SecurityAlertBell.tsx` is unreferenced while the identical
polling/toast logic is inlined in `StatusCluster.tsx:26,43,159,191,245`.
`ManagerOverrideDialog.tsx` is likewise unreferenced, superseded by
`AuthorizationDialog.tsx`.
**Fix:** delete the orphans or make `StatusCluster` import the component.

---

## Medium

### M1 — Staff roster, roles and PIN lengths are fully public
`src/routes/api/public/terminal-staff.ts:17-21` is deliberately unauthenticated
and `src/lib/staff-admin.server.ts` returns `pin_length` per user. That is staff
PII plus the search space for C2.
**Fix:** require the terminal registration token, and drop `pin_length` from the response.

### M2 — Device encryption key stored beside the data it protects
`src/lib/device-secrets.ts:34-40,68` keeps the AES-GCM key in the same
`localStorage` as the ciphertext. It defeats grep, not an attacker with script
execution.
**Fix:** hold a non-extractable WebCrypto key in IndexedDB, or use the platform keystore.

### M3 — Silent plaintext fallback when the OS vault is unavailable
`electron/config-store.cjs:9-15,44-48`, `electron/cloud-credentials.cjs:60-68`,
`electron/emergency-pin.cjs:37-45` fall back to `0600` JSON when `safeStorage` is
unavailable. Deliberate, but invisible to the operator.
**Fix:** persistent warning in diagnostics and on screen when sealing is off.

### M4 — Security alert ingest writes with the publishable key
`src/routes/api/public/security-alerts.ts:54-56` calls
`rpc/security_report_findings` with the anon key; the HMAC gate is correct, but
safety then depends entirely on that function's own policy.
**Fix:** confirm the function is not anon-executable, or relay it with the service key.

### M5 — Offline is assumed to mean "will sync later"
`src/lib/pos-db.ts:50-62` shows "saved on this terminal — it will sync" for *any*
error while `navigator.onLine` is false, including validation and permission
failures that will never sync.
**Fix:** take that branch only when `isConnectionError(error)` is also true.

### M6 — Tax and totals computed in three places
`pos-store.tsx:2706-2748` (`cartTotals`), `booking-charges.ts:84-108`
(`intakeTotals`, whose result feeds the real charge via `use-checkout.ts:126-127`)
and the receipt preview in `SettingsFrame.tsx:189-213` each derive subtotal → tax
→ total with different rounding helpers.
**Fix:** one shared `computeTax()` used by all three.

### M7 — Database functions broadly executable
The linter reports 70 `SECURITY DEFINER` functions callable by any signed-in user
and 7 callable anonymously, plus 2 tables with row security enabled but no policy.
Note: this ran against the previously managed project; the same review must be run
against your own project, which is where the POS actually writes.
**Fix:** revoke `EXECUTE` from `anon`/`authenticated` on every function not meant
to be called directly, and add policies (or disable the Data API) for the two
policy-less tables.

### M8 — Deprecated public sync alias still mounted
`src/routes/api/public/sync.ts` duplicates `/api/v1/pos/sync`. Same guards today,
but two surfaces to keep in step.
**Fix:** add a test asserting both routes resolve to the same handler, then retire the alias.

### M9 — Stock delta refusals have no retry path
`applyStockDeltas` (`src/lib/pos-db.ts:1472-1484`) logs a refused batch from
`stock-recovery.ts` and moves on; no follow-up retry was found.
**Fix:** park refused batches in the outbox so they are retried and visible.

---

## Low

- **L1** `nextBillNumber` (`bill-number.ts:217-226`) is still exported and can hand out a
  number whose durable write silently failed. Checkout uses `reserveBillNumber`; remove the foot-gun.
- **L2** RPC-missing errors (`terminal-tokens.ts:548-579`, `PGRST202/203`) read like a
  connection problem to a non-technical operator. Reword.
- **L3** Emergency fingerprint is `sha256(secret).slice(0,8)`
  (`electron/emergency-pin.cjs:117-119`) — low entropy as a device identifier.
- **L4** `sk_live_...` placeholder in `SecureCredentials.tsx:69` trips naive secret scanners.
- **L5** Undocumented empty `catch {}` blocks: `CloudSetupGate.tsx:40`, `ColumnResizer.tsx:23`,
  `ItemActivityDrawer.tsx:60`, `StockCountDialog.tsx:85,445`, `TelemetryAgent.tsx:33`,
  `TenderSplit.tsx:28,40`, `SettingsSection.tsx:36,45`, `FeatureSchemaReport.tsx:44`,
  `LogicHealthPanel.tsx:76`, `SystemStatusPanel.tsx:139`, `external-client.ts:58`.
- **L6** `scripts/sync-coverage.cjs` fails confusingly under plain `node`; it needs bun.
- **L7** Platform capability branching is spread over 69 `isNative()`/`isElectron()` checks in
  22 files — the reason Part 2 of the plan splits app folders.
- **L8** `relay-policy.server.ts` (`safeAuthorizeRelayOp`) was not audited in depth; cross-branch
  write scoping via crafted `match`/`values` deserves a dedicated review.

---

## Verified as sound (no action)

- No unauthenticated write endpoint: every mutating `/api/public/*` route is HMAC-signed
  or proves a device/cashier/terminal/staff session.
- The relay enforces a table allow-list (`pos-relay.server.ts:262-353`).
- Hardware paths (printer, drawer, local SQL, updates, camera) gate per platform with explicit
  "unsupported here" returns — no silent no-ops were found.
- Sync coverage doc regenerates byte-identical: no declared coverage drift.
- No high or critical dependency vulnerabilities.
- No private key, service key or JWT is committed (`secrets.security.test.ts` enforces this).

---

## Suggested order

1. C1 (tenant-neutral builds — already planned as the next stage)
2. C2, H1, M1 as one hardening pass (PIN brute force, both surfaces)
3. C3, H5, H6, M5 as one checkout/connectivity-honesty pass
4. H4 (hydration), H7/H8 (dead code), then the Medium list

---

## Fixed in 1.3.86

- **C1** — the hardcoded project address and publishable key are gone from
  `src/lib/external-supabase-config.ts`. The web deployment now names its own
  project through `VITE_POS_SUPABASE_URL` / `VITE_POS_SUPABASE_ANON_KEY`
  (tried before any platform-injected `SUPABASE_*`), and
  `scripts/mobile-build.cjs` strips `window.__POS_CONFIG__` from the rendered
  shell and fails the build if any remains — an APK ships no tenant identity.
- **C2** — `/api/public/cashier-login` now runs through the same
  `pin-throttle.server` helpers as manager PINs, keyed by both the account and
  the caller's address, returning 429 with the minutes left while locked.
- **H1** — the recovery PIN has an attempt limit with exponential backoff, in
  the Electron main process (`electron/emergency-pin.cjs`) and on Android
  (`src/lib/emergency-pin.ts`).
- **M1** — `/api/public/terminal-staff` requires the activation token of a
  registered, unrevoked terminal and lists only that terminal's branch;
  `pin_length` is no longer published.

Covered by `src/lib/__tests__/tenant-neutral.security.test.ts`.

## Fixed in 1.3.87

- **C3** — checkout now checks `db.saleAttemptExists` before claiming nothing
  was stored, so a committed sale is never reported as a failed payment.
- **H2** — `/api/public/health-metadata` requires a staff account; bare
  terminal or cashier identity gets 403.
- **H3** — one canonical service-key name (`POS_SUPABASE_SERVICE_ROLE_KEY`);
  the retired names now fail loudly instead of being silently accepted.
- **H4** — `<html suppressHydrationWarning>` plus a client theme seed read from
  the class the boot script wrote: no hydration mismatch.
- **H5** — Sync & Backup reads `isCloudConnected()` instead of `navigator.onLine`.
- **H6 / L1** — `reserveBillNumber` is serialised behind a mutex and the unsafe
  `nextBillNumber` export is gone.
- **H7 / H8** — `LoginScreen`, `SecurityAlertBell` and `ManagerOverrideDialog`
  deleted, along with the unused `signUp` plumbing in `pos-auth`.
- **M5** — "saved on this terminal" only for genuine connection errors.
- **M6** — one `computeTax()` (`src/lib/tax.ts`) used by the cart, booking
  intake and the receipt preview.
- **M8** — `sync-alias.test.ts` asserts both sync routes share one handler.
- **M9** — refused stock deltas are retried automatically on every sync cycle.
