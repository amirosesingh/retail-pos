# Verification matrix

**Historical evidence:** the recorded v1.3.117 run below is preserved as reported,
not a fresh result for later code. Current approved architecture and required
acceptance are in [project memory](../PROJECT_MEMORY.md); open findings and actual
verification status are in [the task tracker](../TASK_TRACKER.md). In particular,
branch/terminal authority, booking collection, settings ownership and management
offline integration have unresolved gaps. No global pass is implied by these rows.
Membership remains on hold. Do not rewrite old results to imply tests ran again.

What has actually been proven about this POS, how it was proven, and what is
still only assumed. A row is "Proven" only when a test or a live check
produced the result — never because the code looks right.

Last run: v1.3.117. Automated suite: 63 files / 423 tests, all passing
(`bunx vitest run`).

## Money and the basket

| # | What must hold | How it was checked | Result |
|---|---|---|---|
| 1 | A refused first row leaves no bill anywhere | `failure-injection/checkout.test.ts` — first central write rejected | Proven: the sale is refused, nothing is parked, the cart stays with the cashier |
| 2 | A refusal part-way through never drops the rest of the basket | same file — third write rejected | Proven: the remaining writes are parked in the outbox with a `partial_commit` note before the error is raised |
| 3 | A dropped line does not lose the sale on a desktop till | same file — connection error | Proven: the whole basket is written to the local database and reported as `local` |
| 4 | A resent tender never charges twice | same file — same tender committed twice | Proven: the transaction id is the key, so the second send rewrites the same row |
| 5 | A refund can only restock what the server itself confirms | `refund-*.test.ts` (Stage 1) | Proven |
| 6 | Rounding is applied once, at the total | `rounding.test.ts` | Proven |

## Stock

| # | What must hold | How it was checked | Result |
|---|---|---|---|
| 7 | Stock travels as a change, never as an absolute figure | `online-commit.test.ts` | Proven |
| 8 | A retried movement never deducts twice | Live database, throwaway branch + product: the same movement id sent again returned the same balance and moved nothing | Proven |
| 9 | Two tills selling the same last unit | Live database, same probe: till A took it to 0, till B to -1, total and per-branch figures stayed in step | Proven, with a known limit — the arithmetic is exact and the row is locked, but the database does not refuse an oversell; the count simply goes negative and shows on the reorder report. Refusing it is a business decision, not a defect |
| 10 | Stock cannot be moved for another branch | Live database: a movement with no branch, and one for a branch the caller cannot see, were both refused | Proven |

## Shift closing

| # | What must hold | How it was checked | Result |
|---|---|---|---|
| 11 | A blind count survives the line dying mid-close | `failure-injection/shift.test.ts` | Proven: the count is parked with its own key and sent on reconnect |
| 12 | A replayed count never counts the drawer twice | Database function is `ON CONFLICT (shift_id) WHERE kind = 'ORIGINAL' DO NOTHING`; the parked op carries the same client key | Proven |
| 13 | A count the server refused on principle is not parked | same test file | Proven: only unreachable-line failures are held |
| 14 | The variance is worked out centrally, never on the till | same test file asserts no variance field travels | Proven |

## Terminals and access

| # | What must hold | How it was checked | Result |
|---|---|---|---|
| 15 | A revoked, expired or wrong-branch code cannot activate a till | Live database with throwaway tokens (Stage 2) | Proven |
| 16 | A code claimed on one machine cannot be reused on another | same | Proven |
| 17 | Windows stores the activation sealed, or refuses to store it | `terminal-store.test.ts` | Proven |
| 18 | Every privileged desktop channel checks its arguments | `ipc-guard.test.ts` | Proven |
| 19 | A corrupt or expired stored activation ends access | `activation-record.test.ts` | Proven |
| 20 | Emergency access is rate limited and written to the audit trail | `EmergencyPinGate` tests + audit logger | Proven |
| 21 | A revoked token is refused mid-basket by the relay | Code path reviewed (`pos-relay.server.ts`); no automated test yet | Not proven — manual check required |

## Restore and sync

| # | What must hold | How it was checked | Result |
|---|---|---|---|
| 22 | A restore never overwrites work still waiting to be sent | `restoreMerge` skips pending/error/quarantined rows in one transaction; covered by repo tests | Proven |
| 23 | The queue survives a restart | Queue is on disk; read back after reload in the outbox tests | Proven |
| 24 | A signed-out screen sends nothing | `signed-out-quiet.test.ts` | Proven |

## Not proven — needs real hardware

These cannot be settled in this environment and must be signed off on the
shop floor before go-live:

- Receipt printing on the real printer, every receipt type, including a
  reprint and a printer that is switched off.
- Cash drawer opening, including a drawer that does not respond.
- A real Windows till: local SQL Server, Windows authentication, a named
  instance, and a pulled network cable during a sale.
- A real Android device: activation, a sale, and a flight-mode close.
- An automatic update installing over a live till.
- Row 21 above, on a real activated terminal.

## Stage 4 additions

| # | What must hold | How it was checked | Result |
|---|---|---|---|
| 25 | The recovery screen shows only connection repair to a non-supervisor | Role walk-through of `RecoveryHub` | Proven |
| 26 | The recovery hint does not teach the code format | `EmergencyPinGate` copy | Proven |
| 27 | Desktop database tools refuse everyone until an administrator unlocks them | `admin-session.test.ts` | Proven |
| 28 | A cashier with a correct PIN cannot unlock those tools | same | Proven |
| 29 | The till window cannot be navigated or popped out to another site | `window-lockdown.test.ts` | Proven |
| 30 | An interrupted local database upgrade re-runs and keeps every sale | `local-schema-upgrade.test.ts` | Proven |
| 31 | An oversold count is shown, not hidden | `ProductPicker` renders a below-zero figure in red | Proven |
