# STOCK401 two-till Beta acceptance

## Read-only preflight

The checked target is Retail POS Beta `irjkmhgrjgcaoixcixut`, PostgreSQL 17.11. The
catalog check found the existing grouped cash, refund, transfer, stock and FIN62
dependencies. It found no STOCK401 ledger, effect, author, frontier, opening,
cutover or replica objects and no dedicated `CODEX-STOCK401-%` branch. The
existing transfer writer fingerprints, catalogue visibility routine and product
delete guard matched. The online deduction witness pins Beta's hardened
`stock_apply_delta` replay comparison and its current document write grants.

## Prepare the candidate artifacts

1. Prepare the hosted foundation in this order.

   | Order | Repository input |
   | --- | --- |
   | 1 | `supabase/migrations/20261105113916_stock_history_effective_ledger.sql` |
   | 2 | `supabase/migrations/20261105172030_stock_history_accepted_effect_capture.sql` |
   | 3 | `supabase/migrations/20261105232647_stock_history_author_claim_admission.sql` |
   | 4 | `supabase/migrations/20261106035442_stock_history_original_source_receipts.sql` |
   | 5 | `supabase/migrations/20261106042742_stock_history_verified_source_membership.sql` |
   | 6 | `supabase/migrations/20261106065813_stock_history_selected_time_period_reader.sql` |
   | 7 | `supabase/migrations/20261106073851_stock_history_coverage_frontiers.sql` |

2. Prepare `scripts/preparation/stock-history-recorded-openings.sql`,
   `stock-history-physical-stocktakes.sql`, `stock-history-stocktake-cutover.sql`,
   and `stock-history-replica-export.sql` against that foundation. The first
   three are transaction-body artifacts. The replica export and dated hosted
   inputs contain their own transaction boundaries. Freeze the exact approved
   payload for the selected execution tool and verify its migration-ledger
   behavior, with one transaction owner per execution. Keep scoped guard
   provisioning separate from routine creation.
3. Review any additional business witness modules used by the acceptance
   scenario at their exact deployed prerequisites. Grouped cash and grouped
   refund follow original-source membership. FIN62 refund follows grouped
   refund. The transfer, online-deduction, product-membership and product-merge
   modules have separate source guards and fixture coverage. The
   `stock-history-product-merge-evidence.sql` module follows the authoritative
   merge module and uses its accepted receipt to identify the stock effects.
   Exercise product merge only on its separate disposable single-writer branch
   until admission can prove the native writer's pending-work barrier on the
   hosted side. The opening receipt certifies inventory at one cutoff. Each
   later writer still requires proven coverage.
4. Use the candidate Beta Worker and candidate Windows Main process. On each
   owned disposable Windows database, verify its actual SQL Server GUID and
   install the exact reviewed prepared `031_stock_history_effective_ledger.sql`
   and `stock-history-stocktake-fence.sql`. Verify the fence routines and
   trigger fingerprint. The native downloader installs its own guarded
   replica metadata. Scope `POS_STOCK_HISTORY_PILOT_ENROLLMENT` individually
   to the exact branch, terminal, database GUID, project origin, and trusted
   Beta backend origin for each candidate process.
5. For the separate disposable merge test, also prepare
   `database/sqlserver/prepared/stock-history-product-merge-intents.sql` and
   set the approved database GUID as a SQL `uniqueidentifier` in session context under
   `pos_stock_history_merge_database_guid`. The dedicated table stores the exact
   original roster, local pre-merge evidence and accepted receipt across
   restart. Existing refund and booking receipts keep their current schema.

## Run the isolated dry run

Use the repository's pinned Node runtime, an owned PostgreSQL 18 binary
directory, Windows SQL Server LocalDB, and ODBC Driver 18. The commands start
and clean up generated fixtures. They take no hosted connection or saved POS
profile.

```powershell
$env:POSTGRES_TEST_BIN = '<owned PostgreSQL 18 bin directory>'
$env:STOCK_HISTORY_NATIVE_REPLICA_TEST = '1'
node scripts/test-stock-frontier-postgres.cjs --run
node scripts/test-stocktake-fence-sqlserver.cjs --run
node scripts/test-native-product-merge-sqlserver.cjs --run
```

The composed fixture uses two distinct enrolled terminal identities and real
signed frontier receipts. Two separately created SQL Server databases download
the same published opening and read through the native IPC authorization path
after reconnecting without another hosted page. Validate the local fence and
Main signing in the accompanying LocalDB fixture. Hosted credential exchange,
installed POS sessions and the physical stock count require the separate Beta
acceptance below.

The merge test uses a separate Windows database. For a saved merge, use
**Check saved merge** in Inventory. The relay checks the original operation
after taking the same lock as the writer. If it already accepted the merge,
Electron either applies the exact receipt to the unchanged selection or
verifies the matching result already brought down by sync. The latter leaves
stock untouched and records completion without another upload. Divergent or
unverifiable local facts keep the original attempt available for review.

## Run the approved synthetic-branch acceptance

1. Confirm the exact candidate artifact hashes and Retail POS Beta project.
   Use a new private, isolated stocktake-marked branch and two owned Operations
   PC registrations with unique native database GUIDs. Verify the enrolled
   cohort is exhaustive, both Windows devices have a current stock author
   enrollment, and the witness and reviewer are different authorized POS
   Administrators. Keep their credentials and terminal proofs private.
2. From the witness's Beta terminal context, use `prepare` on the canonical
   `/api/v1/pos/sync` route's `sqlServerStocktakeCutover` action. Both Main
   processes call `business:stocktake-control` with `arm`, then `prove` in the
   `arm` phase. Confirm both report the same stocktake and that each reported
   fence generation matches its own arm receipt. An omitted till or retained pending operation must hold
   the stocktake. Use the two returned receipt bindings to `arm` centrally.
3. Verify actual stock-changing writes to the synthetic branch are held while
   ordinary work outside that branch continues. Use the displayed roster and
   cutoff to complete the physical count with explicit zeros. For this first
   opening both observations must reconcile without corrections during the
   pause. Release and reconcile discrepancies through the normal stock flow
   before starting a fresh lease.
4. Seal with the original roster hash, cutoff and counted quantities. On the
   second registered PC, the reviewer uses the sync route's `review` action
   to read back the sealed evidence hash, roster and counts. Both Main
   processes return new `confirm` proofs bound to the same local fence and
   unchanged source prefix. The reviewer publishes once, then verifies that
   replaying the same evidence returns the original cutoff and receipt.
5. Release via the hosted action and use the persisted release receipt to
   release both local fences. Verify exact read at the verified cutoff, a
   later cutoff held for missing coverage, replica download on both tills,
   offline read after restart, denied foreign scope and denied export for an
   account without export permission. Check that routine stock writes resume
   and that original business journals were preserved.
