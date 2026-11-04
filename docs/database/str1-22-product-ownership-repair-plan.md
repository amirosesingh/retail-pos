# STR1 22-product ownership repair — applied and verified

Target: **ROSEGILL → rosegill0011@gmail.com's Org** (`bjxgimekljzlnwejuawj`) → **pos** (`qhrufhtbeguxydenzfey`), database `postgres`, <https://qhrufhtbeguxydenzfey.supabase.co>.

The proposed artifact is `scripts/maintenance/repair-str1-22-product-ownership.sql`. It is a one-time data repair, not a migration. The owner separately approved this exact repair after reviewing its records and effects. It has been applied once; this committed artifact is evidence, not an instruction to replay it.

Final prepared SQL SHA256: `97A72C1B54D38ADA2BADD75B3617E446914AAFF69886AE15775D2341F3DB90FB`.

The owner authorized and applied a repair for the 22 frozen product IDs whose missing ownership hides their zero-stock cloud rows from the STR1 catalogue. Read-only evidence shows each has a canonical stock map containing only STR1 at zero, a historical STR1 sale and no sales in another branch. Private full before images remain outside Git; the artifact contains only IDs and full-row fingerprints.

## Exact change and effects

- Set only `products.owner_store_id` from NULL to STR1 (`a611a328-2217-4d77-944a-5f6a637d123b`, group `361-degree-sports`) on exactly those 22 rows.
- Existing triggers increment each row version once and set its update time. Every other product field must remain equal, including all stock maps/quantities, SKU, barcodes, prices, archive/deletion status and catalogue transfer projections. Otherwise the entire transaction aborts.
- Preserve every existing trigger and grant. The SKU trigger is INSERT-only; the stock lifecycle trigger does not fire for an owner-only UPDATE.
- Existing triggers append 22 product master-history records and 22 global product-feed records. One honest database-maintenance batch audit stores the before/after images inside the database, without inventing a cashier identity; its existing trigger appends one STR1 audit-feed record. Total: **22 history records, 23 feed records, one audit receipt**.
- The existing feed wake trigger may send two best-effort private realtime hints, one products/global and one audit/STR1. Its existing per-transaction deduplication and error handling remain unchanged. Durable records, not socket delivery, prove the repair.
- No sale, inventory adjustment, checkout routine, permission, setting, local queue or checkpoint is altered. Subsequent normal sync may replace stale local quantities with the already-existing authoritative cloud quantities; that is not a stock adjustment made by this repair.

## Guards and replay

The transaction requires `postgres` execution against `postgres` with no authenticated staff identity. External execution must independently verify the exact project URL/ref above; the database name alone cannot identify a Supabase project.

It takes an advisory lock for this repair, share-locks branch identities and NOWAIT-locks the exact products. Busy, missing or changed records abort. Fresh provenance is checked again. Every current product must match its frozen complete before image.

The script pins all 15 noninternal product/audit/history/feed triggers, 19 relevant function raw bodies and their owner/security/configuration/ACL attributes, all seven relevant table-column layouts and constraints. Guards run before DML and before commit. Schema or trigger changes abort; concurrent migrations/DDL must be excluded during application. Metadata checks do not provide a guarantee against hostile privileged operators or external nontransactional side effects.

After the update, the script verifies the sole permitted owner/version/time delta and exact normal history/feed counterparts. The batch receipt records actual database maintenance identity and full before/after rows inside the database. A retry must prove its original receipt, every frozen before fingerprint, exact allowed delta, current full after images and existing history/feed counterparts; it performs no new product/audit/feed writes. A changed or fabricated receipt fails closed.

The private PostgreSQL fixture preserves captured CRLF function bodies and real trigger definitions. Only product rows and their manifest fingerprints are synthetic; production schema/trigger/function pins are unchanged. The realtime provider is a synthetic transactional sink; the actual captured wake function runs unchanged. This verifies its deduplication and rollback behavior, not live socket delivery.

Preparation verification: **21 PGlite scenarios and 22 actual native PostgreSQL scenarios passed**, plus both focused CI contract tests and scoped lint. Tests include unchanged unrelated stock/SKU/sales, exact retry with no writes, fabricated receipt/changed row denial, missing records, foreign sales, changed branch, altered schema/function/trigger, injected transaction rollback and real independent parent-lock contention. A non-UTC caller test verifies the artifact temporarily uses UTC fingerprints and restores the caller's timezone. Disposable native fixtures were cleaned, including final `owned-d6M9iK`; no operator database was used for these tests.

## Application and rollback boundary

Before application: complete independent review and isolated tests, commit the exact artifact for review, identify its SHA256 and target, recheck current evidence/metadata read-only, and obtain separate owner approval for those exact bytes. Keep the private before-image capture recoverable. Do not execute this file against another project or silently refresh its fingerprints when facts change.

After application: verify 22 owners, unchanged full product fields except owner/version/time, one batch receipt, 22 matching history rows, 23 matching feed rows, same-cluster visibility and continued foreign-cluster isolation. Then observe normal device sync without clearing or resetting it.

Rollback must be separately designed and approved against the saved before/after rows, rejecting any subsequent legitimate edits and retaining append-only history. Do not blindly restore a backup or replay the old 594-product repair.

Other sales/count mismatches and future synchronization correctness remain separately tracked; this repair alone is not proof that all counts or installed clients are correct.

## 4 November applied readback

Exact artifact SHA256 above was applied after fresh full-row and metadata preflight. Independent cloud readback found one durable receipt, 22 STR1 owners, all 22 visible in the STR1 catalogue, 22 unchanged zero-stock maps, 22 unchanged remaining product fields apart from normal version/time, and 22 matching history records. Global and authorized STR1 catalogue counts are both 2,169; this repair did not create products. Local normal adoption and installed checkout remain unverified. Do not replay the SQL or force local quantities/checkpoints.
