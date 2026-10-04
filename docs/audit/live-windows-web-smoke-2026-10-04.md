# Live Windows checkout and synchronization report

Validation date: 2026-10-04  
Application version: 1.4.4  
Scope: installed Windows/Electron POS, configured local SQL Server, cloud reconciliation, role access, release packaging and hosted Web readiness

## Executive status

| Area | Status | Evidence | Remaining operation |
| --- | --- | --- | --- |
| Cashier completes a sale | Pass | A real authorized cash sale completed in the installed POS; the completion dialog closed and the register reset to a new bill. | Repeat card and split tender during payment-terminal UAT. |
| Local SQL persistence | Pass | Sales count changed from 6 to 7 and the sold product stock changed from 2 to 1. Sale, line, cash payment and item-activity records were readable after commit. | Retain this check in the Windows release smoke suite. |
| Cloud synchronization | Pass | Checkout reconciliation returned `matched: true`, no differences, zero failed jobs and zero conflicts. | Exercise a forced network outage and recovery. |
| Exchange workflow | Pass | A real Electron exchange returned one BND 49 item, sold one BND 339 replacement, committed BND 290, and synchronized the header, lines, payment and original-bill lineage. | Add mixed-tender and loyalty-points exchange UAT. |
| Admin access | Pass | Admin session opened the principal administration, reporting, inventory, sales, booking and settings routes without a visible page or console failure. | Rerun against the newly deployed Web artifact. |
| Cashier access | Pass | Cashier PIN authentication established staff-level POS authority and completed the sale without database-administration permission. | Expand denied-route assertions for the production role matrix. |
| Receipt print | Conditional | The sale remained committed when the operating system returned `Print job canceled`. | Configure a usable/default printer and certify print, cut, drawer and reprint behavior. |
| Windows build | Package pass; launch OS-blocked | The final 1.4.4 installer and unpacked application were rebuilt from the remediated source. Packaged native-SQL smoke passes, but Device Guard blocks the unsigned packaged `Retail.exe` before startup. | Authenticode-sign the installer and payload, then rerun the packaged runtime smoke with Smart App Control enabled. |
| Hosted Web | Pass for deployed artifact | Four deployed read-only tests passed: public/security headers, anonymous member/voucher surfaces, the complete admin route sweep, and cashier privilege denials. | Deploy this working-tree release when approved, then repeat the same suite against that release. |

## Defect and remediation trace

| Stage | Observed behavior | Root cause | Remediation | Result |
| --- | --- | --- | --- | --- |
| Aggregate branch checks | Checkout reported that payment saving could not be completed. | Sale-related and terminal-owned aggregate rows could retain an untrusted or absent branch value. | Stamp sale, audit and shift operations with the verified terminal branch and include terminal identity in the trusted aggregate. | Branch checks now use server-verified device scope. |
| Cashier authority | Cashier could sign in but the Electron main-process checkout authority remained locked. | Session adoption incorrectly required `can_manage_sync_backup`, a database-administration capability. | Install verified staff POS authority immediately after cashier authentication; allow active staff session adoption while retaining independent database/sync IPC guards. | Cashier completed checkout without being granted administrative database access. |
| SQL aggregate commit | SQL MERGE did not insert the expected branch row, followed by a branch-verification rejection. | `AggregateRepository.commit()` called the operation repository without `branchId` and `terminalId`; SQL parameter binding saw an undefined branch scope. | Pass the aggregate branch and terminal scope into every operation application. | The same live checkout path committed successfully. |
| Diagnostics/sync noise | Old recovered bootstrap errors remained visible and overlapping sync runs could report false failures. | Recovered jobs were not scoped tightly enough and concurrent callers raced. | Scope recovery to type/organization/branch/terminal and share the active synchronization result. | Dashboard contains no current failed sync job or conflict. |

## Transaction evidence

### Latest source-Electron role smoke

| Role | Bill | Sale ID | Total | Local SQL | Cloud sale/items/payment | Queue after sync | UI errors |
| --- | --- | --- | ---: | --- | --- | ---: | --- |
| Administrator | `LC361D-PC25-20261004-0002` | `83aa9d98-42ea-4def-a2fa-8e2f4ccac35f` | 49.00 | Pass | 1 / 1 / 1 | 0 | None |
| Cashier | `LC361D-PC25-20261004-0003` | `26D27F58-249D-4813-98C5-BC879F90EE17` | 49.00 | Pass | 1 / 1 / 1 | 0 | None |

Both roles completed the real Electron complete-and-print flow against the configured `POS_Local` database. The administrator could open settings, update and database screens. The cashier remained correctly unable to run the privileged manual reconciliation command; normal background synchronization still drained the queue to zero.

### Live Electron exchange evidence

| Field | Verified value |
| --- | --- |
| Original bill | `LC361D-PC25-20261004-0003` |
| Replacement exchange bill | `LC361D-PC25-20261004-0004` |
| Exchange sale ID | `c194701e-2133-4b39-bcc7-782b6fd5210f` |
| Returned line | Quantity -1 at BND 49; `is_return=true` |
| Replacement line | Quantity 1 at BND 339; `is_return=false` |
| Amount collected | BND 290 in one payment row |
| Local SQL result | Original bill linked to replacement; exchange aggregate committed atomically |
| Supabase result | Header, both lines, payment and original-to-replacement link present |
| Sync result | 0 pending, 0 failed, 0 conflicts; checked table counts matched |
| UI/runtime errors | None |

The first cloud verification exposed that the legacy immutable-sale merge discarded `exchanged_to_bill_number`. Migration `20261004210000_sync_exchange_link.sql` now permits only the monotonic null-to-value transition. Existing links cannot be cleared or replaced, and the exchange trigger plus unique index prevent a second exchange of the same original bill.

### Earlier installed-application evidence

| Field | Verified value |
| --- | --- |
| Bill number | `LC361D-PC25-20261004-0001` |
| Sale ID | `15D480B8-AC3C-4C13-99EE-D7CE612EA045` |
| Tender | Cash |
| Sale total | 29.00 |
| Sale lines | 1 |
| Quantity | 1 |
| Unit price | 29.00 |
| Sales rows before / after | 6 / 7 |
| Product stock before / after | 2 / 1 |
| Post-commit register state | Reset to a new bill |

The transaction is intentional audit test data and was not deleted because it proves the actual database and synchronization path. It should be handled according to the business's test-data policy before financial go-live.

## Local SQL and cloud reconciliation

| Table or control | Local | Cloud | Outcome |
| --- | ---: | ---: | --- |
| `sales` | 10 | 10 | Match |
| `sale_items` | 5 | 5 | Match |
| `payment_transactions` | 9 | 9 | Match |
| `item_activity_logs` | 10 | 10 | Match |
| `stock_delta_applied` | 11 | 11 | Match |
| `shift_sessions` | 881 | 881 | Match |
| `audit_logs` | 2,137 | 2,137 | Match |
| `products` | 1,779 | 1,779 | Match |
| Reconciliation differences | 0 | 0 | Pass |
| Failed synchronization jobs | 0 | — | Pass |
| Conflicts | 0 | — | Pass |

## Settings synchronization and conflict resolution

| Scenario | Cloud result | Windows local SQL result | Status |
| --- | --- | --- | --- |
| Web saves a newer receipt setting | `show_barcode=true`, revision 211 | Pulled the identical value, revision and timestamp | Pass |
| Stale Electron payload has an artificially higher revision | Rejected; the newer Web value remained authoritative | No stale overwrite | Pass |
| Genuinely newer Electron payload has a lower incoming revision | Accepted and normalized to the next revision | Pull/reconciliation matched cloud | Pass |
| Concurrent/equal revisions | `updated_at` decides first; `row_version` is the deterministic tie-breaker | Electron pull uses the same order | Pass |
| Web realtime broadcast stalls after the durable database write | Save returns after a 1.5-second best-effort broadcast timeout; periodic durable sync remains the fallback | Not applicable | Fixed and live-verified locally |
| Sync queue after Web-to-cloud-to-SQL propagation | — | 0 pending, 0 failed, 0 conflicts | Pass |

| Settings ownership class | Tables / examples | Synchronization rule |
| --- | --- | --- |
| Shared, bidirectional | `pos_settings`, `pos_store_settings`, `settings_scoped`, `settings_overrides`, `integration_settings` | Last writer wins by authoritative `updated_at`; revision is normalized/tie-broken. |
| Cloud-authoritative | `secure_settings`, `settings_locks` | Devices consume central policy; local copies do not override cloud policy. |
| Device-local | Database connection, printer/hardware and update configuration | Remains on the terminal; secrets stay in Electron DPAPI or Android Keystore. |

## Local database health

| Check | Result |
| --- | --- |
| Profile | `POS_Local` |
| State | `enabled_ready` |
| Connectivity | Connected |
| Trading readiness | Ready |
| Authentication | Windows authentication |
| Registered schema | 70 of 70 tables |
| Missing tables | 0 |
| Incompatible tables | 0 |
| Schema differences | 0 |
| Database write probe | Pass |
| SQL health latency | 10 ms |
| Change tracking | Active |
| Current synchronization job | None; idle/ready |
| Queue | 0 pending, 0 failed, 0 conflicts |
| Historical red notification | A 2026-09-28 bootstrap job failed with `SYNC_TABLE_FORBIDDEN`, then a later matching bootstrap completed. Recovered historical failures are now excluded from the current failure badge. |

The header status popover now reports SQL Server activity, the most recent SQL health-check time and the cloud-sync queue independently. This prevents an old cloud/bootstrap job from making a healthy local SQL Server appear stopped.

## First-login catalogue hydration remediation

| Observation | Cause | Fix | Verification |
| --- | --- | --- | --- |
| A previously activated till could authenticate while showing an empty register catalogue until restart. | Main-process login repaired the terminal branch, but the renderer had already loaded its unscoped local snapshot and did not know the branch changed. | Persisting a verified branch now publishes a `branch` business-change event; the renderer treats it as a full local snapshot reload trigger. | Focused cashier-login, checkout and reconciliation tests passed; the full suite is 1,242/1,242. |

## Feature validation boundary

| Feature group | Automated/code status | Live status in this run | Next live operation |
| --- | --- | --- | --- |
| Register, cash checkout, local write, stock decrement | Verified | Pass | Card and split-payment UAT. |
| Admin navigation, reports, inventory, sales, bookings, settings | Verified | Route smoke pass | Execute create/update/cancel workflows against the newly deployed Web build. |
| Stock requests and transfers | Automated multi-branch contract and live lifecycle verified | Rollback-only request → approve → dispatch → receive → verify passed between two live branches; stock and movement rows reconciled | Add concurrent requests plus reject, cancel and lost-in-transit business UAT across the required number of branches/clients. |
| Booking lifecycle | Verified structurally | Route smoke only | Create, amend, allocate, complete, cancel and refund a booking with both roles. |
| Shift open/close and cash controls | Verified structurally | Existing synchronized records reconciled | Open/close a new test shift, record float, drop and variance, then reconcile. |
| Exchange | Automated safeguards and cloud constraints verified | Real Electron exchange passed locally and in Supabase | Add mixed-tender, member-points and cashier-denied acceptance cases. |
| Refund, void, held sale | Verified structurally | Not live-mutated in this run | Run permission-denied and manager-approved paths and verify inventory/tender reversal. |
| Printer/drawer/display/scanner/camera | Automated contracts exist | Printer unavailable/canceled; other hardware not exercised | Hardware certification matrix by make/model and failure mode. |
| Android activation, Keystore, camera and signed update | Build/tests pass | No physical handset run | Clean install, upgrade, restart, revocation and camera test with a signed APK. |
| Web authenticated roles | Build/public smoke pass | Current hosted artifact not redeployed | Deploy current source and run admin/cashier Playwright flows. |

## Release security and Smart App Control

| Check | Result | Required action |
| --- | --- | --- |
| Rebuilt `Retail.exe` Authenticode status | `NotSigned` | Sign with a trusted RSA Authenticode certificate. |
| Rebuilt setup executable status | `NotSigned`; 143,458,975 bytes; SHA-256 `E111566876FFD41A1C2F9D979E5B7562ABD2BED38F812AC3B9B6A7FE4CCEE664`; built 2026-10-04 21:34 local time | Do not distribute it until it is signed and the Smart App Control launch test passes. |
| GitHub Windows release gate | Implemented | The release job now requires certificate secrets and fails unless both the payload and installer report a valid Authenticode signature. |
| GitHub Android signing gate | Implemented | The APK job verifies the APK signature and compares its signer SHA-256 certificate digest with the configured release keystore before publishing. |
| Smart App Control behavior | It can block unknown or unsigned executables, including the temporary NSIS uninstaller used during packaging. | Keep Smart App Control enabled; fix publisher trust through signing. |
| Latest runnable artifact | Source Electron was live-tested against `POS_Local`; the latest rebuilt `release/win-unpacked/Retail.exe` passes packaged native-SQL smoke. Unsigned NSIS installer creation is blocked by Device Guard/Smart App Control before completion. | Sign the installer and payload before release. |
| Release acceptance | Not complete | Verify every shipped EXE/DLL and installer/uninstaller signature, then install/upgrade/uninstall on a clean Smart App Control-enabled machine. |

## Final disposition

| Decision | Status |
| --- | --- |
| Electron payment-save incident | Fixed and live-verified |
| Local SQL connectivity/schema/write health | Pass |
| Local-to-cloud consistency for checked data | Pass |
| Safe to distribute the existing setup executable | No |
| Ready for signed Windows pilot after printer/setup validation | Yes |
| Ready to claim every feature works live on every platform | No; the remaining operations are explicitly listed above |
