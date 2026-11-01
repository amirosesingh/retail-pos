# Go-live checklist

Work through this on the real shop hardware, in order. Anything that fails
stops the go-live — none of these are optional.

Reconciled 2026-10-27: use [project memory](../PROJECT_MEMORY.md) and the
[current tracker](../TASK_TRACKER.md) for approved rules and unfinished defects.
This is an acceptance checklist, not a record of completed checks. Transaction,
stock, concurrency and failure tests require isolated/restored fixtures and
approved test devices; never damage real business data. Membership is on hold.

## 1 November 2026 — cumulative beta promotion preparation

**Production is not signed off.** Prepare one cumulative beta source candidate,
not a combination of old installers or a replacement checkout. Current production
is `v1.4.79` (`2f404e6f`). Published beta `1.4.81-beta.2` uses source `dd4331b0`,
whose tree equals beta `273c685c`. The newer Windows closing-journal correction
is [PR #353](https://github.com/amirosesingh/retail-pos/pull/353), source `1c867a43`
and reviewed head `ce6ee9e5`; neither published installer includes it yet.

The checked main-to-beta comparison contains 88 beta-only commits and 566 changed
files before PR #353. Existing tests and prior scoped acceptance are evidence for
their recorded revisions, not complete certification of this accumulated release.
Main's two unique release/merge commits currently add no distinct runtime tree
changes; preserve their history through a reviewed merge, never overwrite main.

Version decision: `prepare-beta.cjs --next` currently reports `1.4.81-beta.3`,
while committed source metadata is `1.4.80`. The stable release workflow preserves
an untagged source version, so unchanged promotion would publish `1.4.80`.
Recommend explicitly preparing stable `1.4.81`; this is a proposal, not a version
change or publication approval. Check the exact release identities again before
the owner approves a specific beta-to-main PR.

Required gates before that promotion:

- [ ] Merge the reviewed shift fix into beta and verify the exact candidate's
      checks. PR #353 head `ce6ee9e5` passed Security checks, Android compile,
      iPhone build and a Cloudflare deployment/check for that source; the official
      served URL/source was not independently read back. These are not a new Windows installer
      or affected-PC runtime acceptance.
- [ ] Recover/verify the affected PC's original locally saved closing graph and
      timestamp, preserving counts, identity, queue and active drawer. Cloud still
      has both identified STR1 shifts OPEN with no closing children. No automatic
      historical repair is approved. A separate beta profile cannot stand in for
      the affected production profile's pending data.
- [ ] Resolve or explicitly review the known higher-revision stale OPEN upload
      that can reopen a CLOSED row. PR #353 does not correct this older lifecycle
      risk. No live guard migration is currently approved.
- [ ] Review the separate all-open history/filter and administrator timing/closure
      requirements. Current Correct is a closed-count recount, not an open-shift
      closing/time repair. The owner selected original-closing recovery first.
- [ ] Reconcile exact live dependencies. The tested notification acknowledgement
      upgrade `20261030234813` remains not approved/applied live. Never replay all
      migrations or treat an applied filename as proof of every installed body.
- [ ] Reconcile unresolved critical audit findings in TASK_TRACKER.md, including
      alternate authority paths, booking atomicity/received-payment allocation and
      stock privacy, before claiming whole-system readiness. Preserve Membership
      and its dependencies; do not remove earlier beta work by copying older code.
- [ ] Build/restart the exact Windows runtime. Verify two successive cashier
      sales and receipts, branch denial, offline final count/recount, reconnect,
      exact cloud acknowledgement, queue preservation and original attribution on
      isolated test data and authorized test hardware. Browser hot reload does
      not execute the changed Electron Main/SQL worker.
- [ ] Prepare/review a separate `[PRODUCTION]` beta-to-main PR, label it
      `production` and `awaiting-owner-approval`, with exact source/version,
      dependency readiness, evidence limits and rollback. No production merge or
      auto-merge until the owner approves that specific promotion.

Main merge is a release action: after successful main Security checks,
`version-release.yml` can commit/tag the stable version and dispatch platform
publication automatically. Keep beta installer publication separate; it requires
the exact owner instruction “Publish beta now”. Source/client rollback must retain
business rows and pending journals/receipts; it cannot undo already synchronized
closures or delivered notifications. Do not restore an older whole database or
clear queues as a release rollback.

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
