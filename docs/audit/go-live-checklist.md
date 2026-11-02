# Go-live checklist

Work through this on the real shop hardware, in order. Anything that fails
stops the go-live — none of these are optional.

Reconciled 2026-10-27: use [project memory](../PROJECT_MEMORY.md) and the
[current tracker](../TASK_TRACKER.md) for approved rules and unfinished defects.
This is an acceptance checklist, not a record of completed checks. Transaction,
stock, concurrency and failure tests require isolated/restored fixtures and
approved test devices; never damage real business data. Membership is on hold.

## 2 November 2026 — beta integration and production preparation

Later controlling update (REL-31): PR #360/#361 are merged to beta `0bc58a16`
and final checks passed. The owner now explicitly includes pending dependency
PRs #343–#347 and prepared lifecycle **source** #357, and selects stable source
version **1.4.81**. The earlier exclusions/version proposal below describe the
previous checkpoint and are superseded for those source changes only. The next
computed beta becomes **1.4.82-beta.1**; no installer publication is authorized.
Integration candidate `5bb6c488` with matching React/DOM 19.3.1 passed 604 suites /
4,305 tests, full types/lint, 79 native/release tests, 137 isolated SQL scenarios
and 56 real-browser synthetic cases; version-prepared web/Windows builds and
56 version/database/release tests also passed. Exact integration PR CI and final
review still precede merge. Preserve original PR ancestry and verify merged state.
No live SQL was applied; #359 remains HOLD. Existing production/device/data
gates below remain open and must not be reclassified as passed by these checks.

The owner requested merging the reviewed CPU/native fixes into beta and preparing
production if ready. This authorizes PR #360/#361 beta integration, not held
PR #357/#359 execution, unrelated dependency upgrades or a main release.

The exact combined candidate `efe5b6c2` passed 604 suites / 4,305 tests,
79 native/release tests, TypeScript, scoped lint and web build. Independent
reviews matched the source blobs and found no remaining scoped defect. Individual
PR heads passed platform/security checks; CodeRabbit skipped. These checks
protect the changed privacy, timeout, acknowledgement and telemetry paths, not
the complete installed cumulative release. Record final merge/CI identities in
the task tracker and [production draft PR #354](https://github.com/amirosesingh/retail-pos/pull/354).

**Production is still not signed off.** The main-to-combined-source comparison
at that immutable candidate is 580 files, +35,054 / -2,940, and 105 candidate-only
commits; final remote merge commit totals must be recalculated. Do not mistake
the eight-file recent-fix delta for the entire production promotion scope.

The original full STR1 PC closing graph was captured and its digest verified.
Cloud now contains a later owner-confirmed deliberate web closure with different
children. The owner selects original cashier facts while preserving both audit
histories. Draft PR #359's old metadata replay is superseded and **HOLD**; require
a new exact reconciliation plan and separate execution approval. Never clear
queues, reset checkpoints, auto-close rows or replace the later history.

Current metadata remains `1.4.80`; the calculated next installer beta is
`1.4.81-beta.3`. Generated beta version output must not be committed. Proposed
stable `1.4.81` requires an explicit reviewed metadata decision across package,
lock, version and generated SQL files. Updating beta's base to `1.4.81` first
changes its next beta to `1.4.82-beta.1`; do not force a mismatched workflow input.
No stable version or release tag is created by this preparation.

Remaining production gates include final exact-beta checks and destination diff,
installed Windows upgrade/checkout/receipts/offline/reconnect acknowledgement,
applicable mobile behavior, hosted CPU/recovery acceptance, exact live dependency
definitions, unresolved critical tracker findings, all mandatory terminal scope
scenarios, stale lifecycle/higher-revision convergence and original-closing
reconciliation. Draft PR #357 remains outside this candidate and unapproved live.
Other cancellation/pass-budget/health-probe proposals remain separately scoped.
Membership and its dependencies stay on hold. No database upgrade is authorized
merely by a code merge or installer release.

## 1 November 2026 — historical cumulative preparation checkpoint

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

- [x] Merge the reviewed shift source into beta. PR #353 merged as `b31c74e4`;
      history UI PR #355 subsequently merged as `423950b4`. Both merge trees
      equal their exact reviewed/passing source trees. Automatic Codex code
      reviews reported no findings; CodeRabbit skipped beta. These are source
      checks, not a new Windows installer or affected-PC runtime acceptance.
- [x] Finish status-only PR #356's exact-head checks/review and beta integration
      as `ead66f30`, whose tree matches the reviewed source.
      Its five-file patch passed602 suites/4,249tests, TypeScript/lint and
      independent browser/IDB fixtures. A zero journal must not claim complete
      Change Tracking upload; current errors and unavailable reads must stay
      visible. No retry/queue/data behavior is changed by that patch.
- [ ] Reconcile the affected PC's original closing graph and timestamp with the
      later deliberate web closure, preserving both histories, counts, identity,
      queue and active drawer. Complete private capture succeeded on 2 November;
      the earlier cloud-OPEN premise is superseded. No automatic historical
      repair is approved. A separate beta profile cannot stand in for the
      affected production profile's pending data.
- [ ] Resolve or explicitly review the known higher-revision stale OPEN upload
      that can reopen a CLOSED row. PR #353 does not correct this older lifecycle
      risk. Draft PR #357 prepares two service-only routine guards;71 captured
      SQL scenarios,16 real concurrency cases and complete-graph tests passed
      independently. No live guard migration is currently approved. Native
      higher-local-revision convergence remains a separate unresolved boundary.
- [x] Implement and independently test complete-history All/Open/Closed filtering
      and clear row identity in PR #355, preserving current checkout selection.
- [ ] Review the separate administrator timing/closure fallback. Current Correct
      is a closed-count recount, not an open-shift closing/time repair. The owner
      selected original-closing recovery first.
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
- [x] Create separate draft `[PRODUCTION]` beta-to-main PR #354, labelled
      `production` and `awaiting-owner-approval`, recording the version proposal,
      dependency readiness, evidence limits and rollback.
- [ ] Finalize the exact production candidate/version after remaining gates and
      obtain the owner's approval of that specific promotion. No production
      merge or auto-merge is authorized yet.

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
