# Retail POS feature functionality audit

Audit date: 2026-10-04  
Application version: 1.4.4  
Audited baseline: latest `origin/main` content, plus the remediations recorded below in the working tree  

## Status legend

| Status | Meaning |
| --- | --- |
| Verified | Implementation is present and relevant automated checks passed. |
| Implemented / UAT | Implementation is present, but the complete business workflow still needs user-acceptance testing. |
| Conditional | Functionality depends on deployment variables, credentials, external services, or an operator setting. |
| Field validation | Functionality requires a real device, peripheral, installer, SQL Server, or network-failure exercise. |
| Update required | A known defect, security weakness, static-check failure, or dependency issue remains. |
| Optional expansion | The present behavior is intentional; changing it would be a new product capability. |

## Verification results

| Check | Result | Functional interpretation |
| --- | --- | --- |
| Repository freshness | Pass | Audit started from the latest `origin/main` content; the fixes below are present in the working tree. |
| Route inventory | 117 route declarations | Application routes and APIs are compiled into the current build. |
| Test inventory | 190 files / 1,243 tests | All 190 test files and all 1,243 tests passed. |
| Production Web build | Pass | Client and server bundles compile successfully. |
| Android phone bundle | Pass | `mobile:build` produced `capacitor-shell`. This is not a signed APK/device test. |
| Electron runtime smoke | Source pass; packaged launch OS-blocked | Real source-Electron admin and cashier sales saved to local SQL and synchronized with no UI errors. Windows Device Guard blocks the unsigned packaged EXE before Electron starts. |
| Windows package source preflight | Package/SQL pass | Source/configuration, installer and unpacked application build complete; packaged native-SQL smoke passes. Authenticode signing is still required for Smart App Control. |
| SQL Server schema registry | Pass | All 70 registered tables verified. |
| Offline sync contract | Pass | All 70 table ownership/sync decisions verified. |
| Supabase registry | Pass | 70 tables and 1,187 columns reported. |
| Logic health scan | Pass | 561 files; zero critical, warning, or informational placeholder-logic findings. |
| ESLint | Pass | Zero errors and zero warnings. |
| TypeScript | Pass | `npx tsc --noEmit` completes cleanly. |
| Public deployed E2E | Pass | Public shell, recovery/security headers, member join, and voucher routes passed two read-only live tests. |
| Authenticated deployed E2E | Pass for current hosted artifact | All four deployed tests pass, including a complete admin route sweep and cashier denials for locations, staff and database settings. |
| Live Windows checkout | Pass | A cashier cash sale completed through the installed application, persisted its sale, line, payment and activity data, reduced stock by one, and reset the register for the next bill. |
| Live local/cloud reconciliation | Pass | Reconciliation reported `matched: true`, no differences, failures or conflicts across the checkout tables and the wider checked table set. |
| Production dependency audit | Pass | `npm audit --omit=dev` reports zero vulnerabilities after the `fast-uri` update. |

## Register, sale, payment, and receipt functionality

| Function | How it currently works | Platforms | Status | Required update or operation |
| --- | --- | --- | --- | --- |
| Register screen | Shared register canvas drives product selection, cart and checkout. | Web, Android, Windows | Verified | Run cashier UAT with the production catalog. |
| Product search | Searches the active catalog and supports register selection. | All | Verified | Benchmark search with the largest expected catalog. |
| Barcode entry | Keyboard/scanner input resolves product barcodes; camera scanning is capability-gated. | All; camera varies | Verified / field validation | Test each scanner and representative damaged/duplicate codes. |
| Cart add/increase | Adds products and changes quantities under register rules. | All | Verified | Cashier workflow UAT only. |
| Cart quantity reduction | Permission/approval protected when required. | All | Verified | Confirm cashier versus supervisor policy. |
| Delete line / void cart | Permission matrix and authorization rules protect destructive actions. | All | Verified | Test denied and approved paths with production roles. |
| Price override | Protected by granular permission/manager approval. | All | Verified | Confirm price-floor and audit policy with management. |
| Tax calculation | Uses configured tax matrix and receipt calculations. | All | Verified | Finance must reconcile sample taxable and exempt baskets. |
| Rounding | Applies application rounding rules to totals and tenders. | All | Verified | Validate legal/business rounding settings per market. |
| Line discount | Supports permission-controlled item discounting. | All | Verified | Confirm maximum-discount approval rules. |
| Bill discount | Supports bill-level discount and configured authorization. | All | Verified | Finance UAT for tax/discount interaction. |
| Promotions | Applies configured offer logic, including threshold/tier/FOC behavior. | All | Verified | Test overlapping campaigns and precedence before launch. |
| Coupon/voucher application | Validates and records campaign use against a sale. | All | Verified | Load-test concurrent public claims and redemptions. |
| Member attachment | Attaches a member, history, benefits and available vouchers to a ticket. | All | Verified | Validate production member data and consent requirements. |
| Loyalty earning | Sale completion records points according to configured rules. | All | Verified | Finance/business sign-off on earn rules. |
| Loyalty redemption | Permission-aware redemption contributes to tender/discount behavior. | All | Verified | Test refund/reversal of redeemed points in UAT. |
| Hold/park ticket | Stores a working ticket for later reopening. | All | Verified | Test two tills attempting to reopen the same held ticket. |
| Held-ticket history | Shows held, resumed, cleared and discarded ticket activity. | All | Verified | Retention policy review. |
| Checkout | Validates shift, authorization, totals and tender before committing. | All | Verified | Production settlement reconciliation. |
| Cash tender | Records cash paid and change in payment transactions. | All | Verified | Drawer/cash-count UAT. |
| Card/other tender | Records configured payment method. | All | Verified / conditional | Payment-provider integration or manual settlement must be validated. |
| Split tender | Supports multiple tender rows and validates their combined total. | All | Verified | Test cash/card/provider combinations. |
| Sale atomicity | Sale, lines, payments and dependent business changes use atomic contracts. | Cloud; local-first on Windows | Verified | Repeat with a real SQL Server connection and forced interruption. |
| Bill numbering | Generates configured human-readable receipt numbers. | All | Verified | Test uniqueness across offline tills and reconnects. |
| Duplicate-click protection | Busy/commit state prevents repeated checkout submission. | All | Verified | High-latency UAT. |
| Sale recovery | Recovery logic preserves/reconciles interrupted work. | All; strongest offline path on Windows | Verified | Power-loss/restart field exercise. |
| Refund | Permission/authorization controlled; reverses sale effects through stable refund behavior. | All | Verified | Finance UAT for full and partial scenarios supported by policy. |
| Cancel finalized bill | Requires reason, restores stock and records audit information. | All | Verified | Confirm accounting treatment and reporting wording. |
| Correct finalized bill | Cancels/reverses and returns corrected work to the selling workflow. | All | Verified | Cashier/supervisor UAT. |
| Exchange | Looks up one exact eligible receipt, returns selected positive sale lines as credit, sells replacement lines, collects/refunds the difference, and atomically links the original to one exchange. Refunded, return-only, ambiguous and already-exchanged bills are blocked. | All | Live-verified on Electron; automated/cloud verified | Real Electron price-difference exchange passed locally and in Supabase. Still test mixed tender, member points and cashier-denied paths. |
| Receipt search/history | Finds processed sales by receipt/transaction identifiers and filters. | All | Verified | Large-history performance test. |
| Receipt reprint | Reconstructs customer/gift/internal print data under permission control. | Web preview, Windows hardware | Verified / field validation | Test paper widths, logo, Unicode, cut and reprint labels. |
| ESC/POS output | Generates thermal-printer command bytes. | Windows | Verified in automated tests | Certify supported printer models. |
| Customer display | Publishes register-facing transaction state to a second-screen view. | Primarily Web/Windows | Implemented / field validation | Test display disconnect, refresh and restart recovery. |
| WhatsApp receipt | Queues/sends a receipt and tracks delivery state. | All | Conditional | Configure Meta credentials/templates and validate callbacks/retries. |

## Shift, drawer, authorization, and staff functionality

| Function | How it currently works | Status | Required update or operation |
| --- | --- | --- | --- |
| Staff email/password sign-in | Back-office authentication creates guarded application sessions. | Verified | Run authenticated deployed E2E with admin and branch-user credentials. |
| Cashier PIN sign-in | Activated Android/Windows devices can authenticate enrolled cashiers locally/centrally as available. | Verified | Physical-device and offline credential-expiry testing. |
| PIN lockout | Failed attempts are scoped and limited. | Verified | Confirm support unlock procedure. |
| Idle timeout | Session activity and configurable expiry are enforced. | Verified | UAT configured timeout values on each shell. |
| Session resume | Valid sessions survive intended app transitions/restarts; expired sessions are rejected. | Verified | Device restart acceptance test. |
| Role presets | Cashier, warehouse, supervisor and administrator presets seed the granular matrix. | Verified | Business owner signs off the role matrix. |
| Granular permissions | Sales, drawer, inventory, member, report and system actions have independent flags. | Verified | Maintain a role-to-operation acceptance sheet. |
| Route guarding | Navigation visibility and route access use the permission registry. | Verified | Authenticated deployed route crawl remains pending. |
| Manager override | Restricted actions can request/record authorization according to configured rules. | Verified | Supervisor PIN and remote approval UAT. |
| Approval centre | Lists and resolves pending authorization requests. | Implemented / UAT | Test timeouts, rejection and competing approvers. |
| Approval audit | Override history records actor/action/context. | Verified | Retention and compliance review. |
| Open shift | Creates the active shift with opening values. | Verified | Live drawer procedure UAT. |
| Shift lock | Trading requires an open shift unless bypass permission is granted. | Verified | Confirm exception policy. |
| Cash count | Closing workflow records counted denominations/amounts. | Verified | Physical till balancing exercise. |
| Expected cash | Derives expected cash from opening and recorded tender activity. | Verified | Compare with a full business day. |
| Variance | Calculates over/short and supports approval/recount policy. | Verified | Configure threshold and escalation recipients. |
| Close shift / Z report | Finalizes counts, reconciliation, close events and report data. | Verified | Printer and finance UAT. |
| No-sale drawer open | Permission-gated and recorded as an event. | Verified / field validation | Test actual drawer pulse and reason policy. |
| Cash drawer hardware | Electron bridge sends supported hardware operation. | Field validation | Certify drawer interface/model and failure handling. |
| Staff administration | Creates/manages accounts, roles, permissions, PINs and branch responsibility. | Verified | Joiner/mover/leaver acceptance test. |
| Custom role behavior | Role definitions and permission overrides are cached for offline use. | Verified | Multi-device propagation testing. |

## Inventory, purchasing, receiving, and transfer functionality

| Function | How it currently works | Status | Required update or operation |
| --- | --- | --- | --- |
| Product catalog | Lists active/archived products, price, stock and catalog metadata. | Verified | Large-catalog performance test. |
| Add/edit product | Permission-controlled product and price maintenance. | Verified | Concurrent-edit UAT. |
| SKU allocation | Global SKU rules and configured numbering are enforced. | Verified | Import/migration uniqueness exercise. |
| Barcode linking | Associates alias/product barcodes and rejects duplicates. | Verified | Scanner and supplier-label UAT. |
| Archive/restore | Preserves product lifecycle without unsafe deletion. | Verified | Confirm downstream ecommerce visibility. |
| Delete guard | Prevents unsafe product deletion when dependent business records exist. | Verified | Data-retention sign-off. |
| Product merge | Consolidates duplicates/alias barcodes under permission. | Implemented / UAT | Test historical reporting after merge. |
| Product import | Worker-based import parses and validates bulk records. | Verified | Test maximum file size and malformed rows. |
| Category/unit/location management | Maintains catalog groupings, units and stock locations. | Verified | Production hierarchy migration. |
| Stock metrics | Calculates on-hand and inventory metrics from operational records. | Verified | Compare with physical count. |
| Stock adjustment | Records reasoned stock increases/decreases. | Verified | Configure mandatory reason codes. |
| Physical stock count | Scanner/count workflow records confirmations and variance. | Verified | Warehouse floor UAT. |
| Stock history | Reports adjustments, damage/loss and count differences. | Verified | Retention/export review. |
| Supplier directory | Maintains centralized purchasing suppliers. | Implemented / UAT | Duplicate/inactive supplier rules. |
| Purchase orders | Creates and manages purchase-order lines/status. | Implemented / UAT | Validate approval and tax workflow. |
| Goods receiving | Counts arrivals and posts accepted quantities to stock. | Implemented / UAT | Partial, damaged, excess and blind-receipt testing. |
| Stock requests | A branch requests supply and tracks approval/status. | Live-verified | Retain rejection, cancellation and lost-in-transit scenarios in business UAT. |
| Transfers | Creates, approves, dispatches, receives and verifies stock movement between any source/destination branch pair; terminals are clients, not the topology boundary. | Live-verified | Rollback-only live lifecycle passed against two production branches, including source decrement, destination increment and movement rows. Add high-concurrency and lost-in-transit UAT. |
| Transfer import quantities | Import quantities are validated and preserved. | Verified | Large transfer-file test. |
| Verification log | Shows OTP/member-verification attempts and outcomes. | Implemented / conditional | Live delivery-provider test. |

## Members, bookings, services, and campaigns

| Function | How it currently works | Status | Required update or operation |
| --- | --- | --- | --- |
| Member directory | Searches and manages loyalty members and tier information. | Verified | Privacy/access review with production data. |
| Member history | Shows purchase and loyalty activity under permission. | Verified | Large-history pagination test. |
| Public member join | `/join` is the single anonymous white signup page; `/membership` redirects to it and no member-login page is exposed. The central public flag can intentionally close enrollment. | Live database and public-route verified; currently flag-disabled | Enable `member_domain_enabled` when enrollment should open, then complete one real email-OTP signup. Claimed-member enrollment now also persists the submitted phone/profile. |
| OTP verification | Creates and tracks one-time verification requests. | Conditional | Validate SMS/WhatsApp/email delivery, expiry and abuse limits. |
| Coupon campaign management | Creates campaigns, rules, links and tracked vouchers. | Verified | Business UAT for start/end/time-zone behavior. |
| Public coupon claim | Narrow anonymous claim route exposes campaign behavior. | Conditional; public smoke passed | Concurrency and rate-limit test. |
| General booking intake | Creates service/reservation booking from configured rules. | Implemented / UAT | Full front-desk booking exercise. |
| Racket-service intake | Captures racket job details, job tag, timing and service charges. | Implemented / UAT | Workshop hand-off and printed-tag test. |
| Booking deposits | Enforces configured deposit mode/minimum. | Implemented / UAT | Finance reconciliation. |
| Booking partial payment | Accepts additional payments and recalculates balance. | Implemented / UAT | Mixed-tender and duplicate-submit testing. |
| Booking collection | Requires balance settlement and produces the collected sale/bill. | Implemented / UAT | End-to-end booking-to-sale reconciliation. |
| Booking refund | Caps refund to money received and records method/reason. | Implemented / UAT | Finance and permission UAT. |
| Booking cancellation | Requires reason, releases stock and records refund/retained-money decision. | Implemented / UAT | Cancellation-fee policy sign-off. |
| Racket job status | Tracks workshop progression, collection and incident notes. | Implemented / UAT | Staff responsibility and damaged-job exercise. |
| Booking WhatsApp | Sends booking/job communications through the configured channel. | Conditional | Meta template and delivery-state validation. |

## Reports, audit, dashboard, and notifications

| Function | How it currently works | Status | Required update or operation |
| --- | --- | --- | --- |
| Dashboard | Presents revenue, profit, peak-hour and operational KPIs. | Verified structurally | Reconcile definitions/totals against finance. |
| All-shops panel | Aggregates multi-branch takings and stock. | Implemented / UAT | Production multi-branch scale test. |
| Live business board | Combines branch sales, share, margin and top-item analytics. | Implemented / UAT | Validate time zone and late-sync behavior. |
| Sales report | Revenue, discount, tax, cashier and tender summaries. | Verified structurally | Reconcile a closed accounting period. |
| Item-sales report | Line-level cost, margin, price and cashier history. | Verified structurally | Validate refunds/exchanges in margins. |
| Stock report | Adjustments, checks, damage/loss and variance reporting. | Verified structurally | Compare to signed stock count. |
| Payment report | Tender and cashier transaction reporting. | Verified structurally | Match payment-provider settlement. |
| Void/refund report | Shows destructive financial events and reasons. | Verified structurally | Finance/compliance sign-off. |
| Edit history | Permanent account, permission, override and change trail. | Verified | Retention/export policy. |
| Register activity | Presents holds, splits, drawer and register event timeline. | Remediated | Accepted offset is capped at 4,500 and source scanning at 10 × 500 rows; sparse audiences receive an explicit 422 asking for narrower filters. A database cursor/RPC remains an optional scale improvement. |
| Retail performance | Profit, velocity, cover and cashier performance views. | Implemented / UAT | Validate formulas with finance. |
| Catalog changes | Reports product, price and stock edits. | Implemented / UAT | Pagination and retention test. |
| Business analytics | Top sellers, trends, savings, shop share and profit. | Implemented / UAT | Large-history query benchmark. |
| Activity/notifications | Combines operational events and WhatsApp delivery status; supports export. | Implemented / UAT | Live feed and CSV acceptance test. |
| Alerts history | Filters warning, critical, stock, variance and security alerts. | Implemented / UAT | Define alert ownership and response SLA. |
| Coupon report | Reports campaign/coupon application and usage. | Implemented / UAT | Reconcile claims, redemptions and reversals. |
| Audit trail | Identifies actor, terminal, branch, action and context. | Verified | Compliance retention review. |
| Telemetry | Terminal heartbeats and sync audit history feed health views. | Verified structurally | Connect monitoring/alerting and exercise stale-terminal behavior. |

## Settings and administration functionality

| Settings area | Current functionality | Status | Required update or operation |
| --- | --- | --- | --- |
| Workspace/store identity | Configures organization/store presentation context. | Verified | Production value review. |
| Display/theme/elements/type/lines | Controls register/display appearance and layout behavior. | Verified | Cross-resolution visual UAT. |
| Receipt designer/logo | Configures receipt identity and layout assets. | Verified / field validation | Print every supported width and logo format. |
| QR settings | Configures generated QR behavior. | Implemented / UAT | Scan generated codes on representative phones. |
| Groups/inheritance/visibility | Applies scoped setting inheritance and page visibility. | Verified | Store-versus-terminal override UAT. |
| Tax/rules | Controls business, tax and authorization behavior. | Verified | Restrict ownership and record change approvals. |
| SKU/bill/stock numbering | Defines numbering formats and allocation. | Verified | Concurrency and migration exercise. |
| Catalog configuration | Controls catalog-related behavior. | Verified | Production data review. |
| Region/time zone | Controls regional presentation and date grouping. | Verified | Validate daylight/time-zone reporting requirements. |
| Payment methods/payment/accounts | Maintains tenders and account-related settings. | Verified | Settlement/accounting mapping sign-off. |
| Booking rules/services/slip | Controls deposits, timing, services and printed booking data. | Implemented / UAT | Front-desk/workshop sign-off. |
| Shift alerts | Configures variance/shift alert behavior. | Verified | Assign alert recipients and thresholds. |
| Notifications | Configures activity/notification behavior. | Implemented / UAT | Delivery and retention validation. |
| Branch telemetry | Displays/configures terminal health telemetry. | Verified structurally | Monitoring ownership and escalation runbook. |
| Hardware/printer | Stores peripheral profiles and print behavior. | Field validation | Certify supported devices. |
| Terminal/mobile-terminal management | Registers, activates, revokes and manages devices. | Verified | Fleet lifecycle exercise. |
| Session management | Shows and controls active device/user sessions. | Verified | Remote revocation test. |
| Database/cloud connection | Operator supplies the runtime Supabase endpoint/key; Android Keystore and Electron DPAPI seal device secrets. | Verified | Preserve `supabaseConfig()` as the sole resolver. |
| Local database setup | Windows configures and tests the local SQL Server profile. | Field validation | Test least-privilege SQL account, reconnect and recovery. |
| Data sync/status | Shows offline queue, health and reconciliation state. | Verified structurally | Multi-till conflict and outage exercise. |
| Shared settings conflict resolution | Web and Electron publish timestamped changes; physical settings columns are merged independently through `settings_scoped` field clocks, and row revision provides a deterministic tie-breaker. | Live-verified | Keep device clocks synchronized and add a two-terminal simultaneous-edit acceptance test. Nested values inside one JSON column still share that column's clock. |
| Database explorer/diagnostics | Administrative inspection and health tooling. | Implemented / UAT | Confirm production access and redaction policy. |
| Logic health/system audit/security alerts | Surfaces structural and security/health checks. | Verified structurally | Integrate checks into release CI and operations. |
| Application updates | Web deploys normally; Android uses signed APK releases; Windows uses installer feed. | Code verified / field validation | Unsigned Android web-code OTA is disabled and purged; signed APK and signed Windows upgrade tests remain physical release operations. |
| WhatsApp settings | Stores/configures integration credentials and behavior. | Conditional | Configure a production Meta app and callback monitoring. |

## Platform functionality comparison

| Capability | Web | Android | Windows/Electron |
| --- | --- | --- | --- |
| Core shared application routes | Yes | Yes | Yes |
| Normal selling | Online only | Online only | Online and offline-first |
| Local business database | No | No | SQL Server |
| Offline sale/shift/payment journal | No | No | Yes |
| Cloud synchronization | Direct cloud operation | Direct cloud operation | Local/cloud push, pull, checkpoints and reconciliation |
| Cashier PIN | No | Yes | Yes |
| Terminal activation | No | Yes | Yes |
| Emergency recovery | No | Yes | Yes |
| Sealed device secrets | Hosting variables are public client configuration | Android Keystore | Windows DPAPI |
| Camera barcode scanning | Browser camera | Native mobile camera | Webcam when available |
| Direct thermal printing/drawer | No | No | Yes |
| Customer display | Browser window | Limited/mobile presentation | Dedicated second-screen workflow |
| Update method | Hosted deployment/page reload | Android-verified signed APK only | Installer/update feed |
| Current validation level | Build and public deployment smoke pass; latest authenticated hosted deployment still pending | Phone bundle build passes; handset/signed-APK acceptance pending | Installed-app admin/cashier checkout and configured SQL Server/cloud reconciliation pass; trusted signed installer and hardware acceptance pending |

## Confirmed update-required items

| Priority | Item | Functional impact | Required operation | Exit test |
| --- | --- | --- | --- | --- |
| Closed | Android unsigned/nonfunctional web-bundle activation | The ZIP was neither authenticated nor extracted into a valid web root. | The path is disabled and legacy downloads are purged; CI no longer publishes `bundleUrl`/web ZIPs. Android code updates only through signed APKs. | Mobile tests and `mobile:build` pass; physical signed-APK upgrade remains field acceptance. |
| Closed | Activity API high-offset upstream fan-out | A valid authenticated request could cause approximately 1,001 upstream requests. | Offset capped at 4,500, source reads capped at ten 500-row batches, explicit bounded-window response added to hosted and Electron-direct paths. | Unit and full suites pass; maximum database reads are 10 per accepted request. |
| Closed | TypeScript check failed in a test mock tuple | CI/static correctness gate was red. | Typed the mocked query argument. | `npx tsc --noEmit` passes. |
| Closed | `fast-uri@3.1.7` advisory | Production dependency tree had two moderate audit entries. | Upgraded the override and lockfile to 3.1.8. | `npm audit --omit=dev` reports zero vulnerabilities. |
| Closed | Three lint warnings | Code-quality signal was not clean. | Split theme storage helpers and documented the CommonJS wildcard boundary. | ESLint completes with zero warnings. |
| Closed | Electron staff bootstrap wrote null into required local email | Local bootstrap/synchronization failed on `dbo.app_users`. | Materialize a deterministic non-routable `@terminal.invalid` placeholder without copying staff PII. | Focused staff pull test and full suite pass. |
| Closed | Electron overlapping syncs created false busy failures | Startup, timer and manual sync could race. | Concurrent callers now share the active synchronization result. | Concurrency regression test proves one push/pull run and two successful callers. |
| Closed | Electron dashboard retained recovered job errors | Three old bootstrap failures could remain visible after recovery. | Failed jobs are hidden only when a later completed job matches type, branch, organization and terminal identity. | Repository regression assertion and Electron smoke pass. |
| Closed | Electron checkout showed “saving the payment could not be completed” | Branch-scoped SQL inserts were filtered out because aggregate operations did not pass branch and terminal scope to the repository; the subsequent branch verification then rejected the transaction. Cashier authority adoption also depended incorrectly on a database-administration permission. | Aggregate writes now carry verified branch/terminal scope, sale/audit/shift rows are stamped with trusted terminal scope, and successful cashier authentication immediately installs server-verified POS authority. Database and sync administration channels remain separately privilege-gated. | A real cashier cash sale persisted locally, reduced stock, reset the register, and reconciled to cloud with zero differences, failures or conflicts. Full automated suite also passes. |
| Closed | Stale Electron settings could overwrite newer Web settings | Settings sync compared only `row_version`, so independent writers could disagree about which change was newest; Web also waited indefinitely when a realtime broadcast stalled after the database save. | Shared configuration now resolves by `updated_at` with revision as a tie-breaker. Supabase insert guards normalize revisions and reject stale inserts; Electron pull uses the same order; Web realtime broadcast is best-effort with a 1.5-second timeout. | Live Web save reached revision 211, Electron local SQL matched the same value/version/timestamp, a stale high-revision payload was rejected, a genuinely newer low-revision payload was accepted, and the queue ended at 0 pending/failed/conflicts. |
| P1 | Windows release binaries are not trusted-code signed | Windows Smart App Control can block the unsigned application or the temporary NSIS uninstaller executable, preventing a reliable release build/install experience. | The GitHub release workflow now requires `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` and refuses to publish unless payload and installer signatures are valid. Supply a trusted RSA Authenticode certificate (or Microsoft Trusted Signing integration), then run the workflow. | `Get-AuthenticodeSignature` is valid for every distributed binary; clean-machine install, launch, upgrade and uninstall succeed with Smart App Control enabled. |
| Closed | Electron exchange cloud lineage was incomplete | The exchange sale, lines and payment synchronized, but the original bill's `exchanged_to_bill_number` was ignored by the immutable-sale merge. | Permit only a monotonic null-to-value exchange-link merge; retain database trigger and unique-index enforcement against replacement, self-links and duplicate exchanges. | The live test bill is linked in local SQL and Supabase; exchange tests, full suite and reconciliation checks pass. |
| Closed | Mobile bundle renderer depended on a temporary HTTP listener | Current runtime could reject the adapter request and time out the build. | Render through Nitro's standards-based fetch entry directly. | `npm run mobile:build` completes. |
| Closed | Authenticated deployed E2E was not run | Live role/route behavior was not proven in the earlier audit pass. | Runtime-only credentials were supplied without storing them in the repository. | All four deployed tests pass, including authenticated administrator and cashier checks. |
| P2 | Supabase advisor warnings require a permission audit | The advisor reports 5 anonymous and 93 authenticated `SECURITY DEFINER` functions callable through the API, plus leaked-password protection disabled. Some RPC exposure may be intentional, but each function must be reviewed against its expected role and internal authorization. | Inventory every reported function, revoke unnecessary `EXECUTE`, retain only intentionally public/authenticated RPCs with explicit in-function authorization, and enable leaked-password protection. | Security advisor contains no unexplained executable-definer warnings and password protection is enabled. |

## Required acceptance operations before broad rollout

| Sequence | Operation | Platforms | Evidence to retain |
| --- | --- | --- | --- |
| 1 | Run authenticated deployed route/permission E2E. | Web/hosted APIs | Admin and branch-user Playwright report. |
| 2 | Install a signed APK on clean and previously activated phones. | Android | Activation, vault, camera, restart, revocation and signed-update checklist. |
| 3 | Sign and install the rebuilt Windows package on a clean till. | Windows | Valid Authenticode signatures plus install, upgrade, rollback/uninstall and DPAPI persistence checklist with Smart App Control enabled. |
| 4 | Exercise outage/restart against the configured SQL Server. | Windows | Normal online sale and local/cloud reconciliation already pass; retain sale/shift/payment evidence before, during and after a forced outage/restart. |
| 5 | Certify printers, cash drawers, scanners, webcams and displays. | Windows; relevant camera clients | Supported-model matrix and failure/recovery results. |
| 6 | Run two-till/two-branch concurrency scenarios. | Windows and cloud | Conflict, idempotency, held-ticket, stock-count and transfer outcomes. |
| 7 | Reconcile one full trading day against finance totals. | All | Sales, tax, tenders, refunds, shifts, inventory and loyalty reconciliation. |
| 8 | Conduct backup and clean restoration drill. | Windows/database operations | Recovery time, recovery point and restored-data validation. |
| 9 | Validate WhatsApp/OTP provider integration and monitoring. | All | Send, callback, retry, failure, expiry and abuse-limit results. |

## Optional product expansions

| Expansion | Current behavior | Work required |
| --- | --- | --- |
| Android offline selling | Android is deliberately live-only. | Encrypted local database, offline identity, operation journal, conflict policy, migrations and extensive interruption tests. |
| Web offline/PWA selling | Browser is deliberately live-only. | Service worker, secure local persistence, transaction journal and reconciliation design. |
| Android receipt printing | Direct hardware printing is not enabled. | Select supported printer SDK/protocol, implement native bridge and certify hardware. |
| Automated provider reconciliation | Payments are recorded, but provider settlement depends on the operational setup. | Provider API/file import, matching rules, variance workflow and reports. |
| Central conflict-resolution console | Conflicts are retained structurally. | Admin workflow for compare, choose/merge, audit and retry. |
| Automated disaster-recovery rehearsal | Restore is an operational procedure. | Scheduled isolated restoration and integrity checks. |

## Overall conclusion

The shared business application is broad and internally well tested: all 1,243 repository tests pass, TypeScript and lint are clean, production/mobile builds complete, the production dependency audit is clean, and the complete 70-table Windows sync registry is structurally verified. The previously reported Electron payment-save failure, source-neutral settings conflict resolution, price-difference exchange lineage, membership claimed-profile completion and multi-branch transfer status mismatch are fixed and live-verified against the configured local SQL Server and Supabase, ending with zero current queue failures or conflicts. The important unfinished work is now deploying and retesting the current hosted Web artifact, trusted signed installers/APKs, peripheral certification, forced outages, and multi-device concurrency/reconciliation.

The Web client can proceed to authenticated production acceptance after deployment of the current working tree. The Android base application can proceed to handset acceptance with unsigned live bundles disabled and legacy residue purged retry-safely. Windows checkout can proceed to a controlled till pilot after trusted code signing and clean-machine installation; printer, forced-outage, multi-terminal and backup-restore acceptance remain required. The successfully tested latest application bundle is running locally, but the older unsigned setup executable must not be distributed as the fixed release.
