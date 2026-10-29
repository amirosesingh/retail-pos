# Go-live checklist

Work through this on the real shop hardware, in order. Anything that fails
stops the go-live — none of these are optional.

Reconciled 2026-10-27: use [project memory](../PROJECT_MEMORY.md) and the
[current tracker](../TASK_TRACKER.md) for approved rules and unfinished defects.
This is an acceptance checklist, not a record of completed checks. Transaction,
stock, concurrency and failure tests require isolated/restored fixtures and
approved test devices; never damage real business data. Membership is on hold.

## Before the day

- [ ] Every branch exists in the system with the right name, code and address.
- [ ] Every member of staff has their own account and the role they should
      have. No shared logins.
- [ ] Staff administration, including role/account changes, is available only to
      the administrator or a user explicitly delegated the applicable saved
      staff-management permission; ordinary roles do not imply that grant.
- [ ] Products loaded, with barcodes, prices, tax rates and opening stock
      counted on the shelf, not carried over from a spreadsheet.
- [ ] Suppliers and stringing services loaded.
- [ ] Receipt header, footer, logo and tax wording checked on a printed copy.
- [ ] Bill numbering starts where the old system stopped.
- [ ] A backup has been taken and a restore of that backup tested on a spare
      machine.

## Each till

- [ ] Activated with its own code; the code is refused on a second machine.
- [ ] The branch shown on screen is the branch the till is standing in.
- [ ] Normal terminal A remains A-only for cashier, manager and administrator,
      through direct APIs/IPC and offline reads/writes, not only the selector.
- [ ] Management devices see only their authorized branches and consolidated
      scope; shared physical SQL does not expose other data to a normal till.
- [ ] Reassignment is separately authorized/audited and safely handles pending
      work without changing the original branch of transactions.
- [ ] Receipt prints, and prints again on a reprint.
- [ ] Cash drawer opens on a cash sale and on a no-sale.
- [ ] Barcode scanner reads a product.
- [ ] Customer display shows the basket and clears after the sale.
- [ ] Automatic updates point at the live release channel.
- [ ] Emergency access code works on that device's own clock.

## Rehearsal, with the network unplugged

- [ ] Open a shift, sell, take cash and card, print — the till keeps working.
- [ ] The screen says clearly that the till is offline.
- [ ] Plug the network back in: everything sent, queue empty, no duplicates
      on the central copy.
- [ ] Close the shift offline: the count is held and sent on reconnect.
- [ ] Pull the plug mid-sale and check the sale is either complete or absent
      — never half.

## Rehearsal, with the network up

- [ ] With isolated stock, simultaneous sales retain correct balances and obey
      the saved prevent-negative-stock policy. Test both enabled and disabled
      states, including authoritative checkout and retry; no universal allow rule.
- [ ] Verify customer refunds remain denied while the existing refund policy is
      disabled. Exercise supported exchange/reversal stock-once behavior using
      fixtures; do not enable refunds just to satisfy an old checklist.
- [ ] Required approvals accept only the selected eligible user with the right
      action, branch, limits and credential policy; reject wrong/replayed PINs or
      tokens. Role name or page visibility is not sufficient approval authority.
- [ ] Revoke a till's activation from the admin screen; that till stops
      selling within the heartbeat window.
- [ ] X report mid-shift and Z report at close both agree with the drawer.
- [ ] Booking deposits count when received; final collection creates one sale,
      one stock effect and a persistent receipt link, including retry/failure.
- [ ] All eight terminal scenarios in PROJECT_MEMORY.md have revision-specific
      results, including omitted request proof and installed IPC wrapper checks.

## Day one

- [ ] Someone with admin access is on site or reachable all day.
- [ ] The old system stays available, read-only, for one week.
- [ ] The Sync screen is checked at close: queue empty, no quarantined items.
- [ ] A backup is taken at the end of the first trading day.

## Sign-off

| Item | Checked by | Date |
|---|---|---|
| Data loaded and verified | | |
| Tills activated and printing | | |
| Offline rehearsal passed | | |
| Online rehearsal passed | | |
| Owner accepts go-live | | |

## Stage 4 sign-off

- [ ] On a real till, confirm the database tools ask for an administrator sign-in and refuse a cashier.
- [ ] Confirm a link in a receipt or note opens in the browser, not inside the till window.
- [ ] Install this build over an older till and confirm unsent sales and shifts are still there afterwards.
- [ ] Switch a till off during the first launch of this build and confirm it comes up complete on the next start.
- [ ] Confirm a non-supervisor on the recovery screen sees only the connection cards.
