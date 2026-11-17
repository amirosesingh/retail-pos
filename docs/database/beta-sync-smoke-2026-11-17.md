# Beta Electron save and synchronization smoke evidence

The catalogue round trip below passed on 17 November 2026. This report records
observations for the named build, databases and synthetic record. It does not
certify every POS workflow or an internet-disconnected installation.

## Source and targets

| Item | Verified value |
| --- | --- |
| Reviewed source | `ddff344f239f5dfa6980f4a93e463c426ab0e1d5`; all required PR checks passed |
| Beta integration | PR #472, `efe0d948badcecc73bcadc635367afe7087e66ac`; merged tree equals tested tree |
| Installed Electron | `Retail Beta.exe`, FileVersion `1.4.84-beta.10` |
| Local SQL | `localhost\LCRPOS`, `POS_Local_Beta`; GUID `a7b2a70f-6637-4040-a028-51f6def5f908` |
| Hosted SQL | Retail POS Beta, `irjkmhgrjgcaoixcixut`; system identifier `7703759698107299042` |
| Branch | Beta Demo Shop, `codex-beta-demo-shop` |

The installed binary was not replaced during this test. PR #472's native
sale-item comparison/guard changes still need an updated installer and installed
acceptance. The public beta Worker build passed for the merged commit. Its page
returned HTTP 200 and its public POS URL matched Retail POS Beta. No production
database queries or changes were used.

## Electron to local SQL to hosted SQL

Before the save, read-only queries found no product with the exact synthetic
name in either database. Through the existing signed-in beta Electron inventory
form, create `Beta Sync Smoke 472 20261117` with zero price, purchase cost, stock
and reorder level. Let the existing SKU allocator assign its code; do not
override or reuse another product's identity.

| Evidence | Observation |
| --- | --- |
| Product identity | MD5 of lowercase UUID `39a65829589eaa4e6e078f716137d954`, identical in both databases |
| Assigned SKU | `SKU-000008`, one record matching this SKU/name |
| Scope and values | Owner `codex-beta-demo-shop`; selling/cost prices and all stock quantities zero |
| Local durable journal | Event `29`, `products/update`, aggregate `4f41aa1d-8656-4370-8d67-cc9df86409ae`, entity version 1 |
| Local journal creation time | `2026-11-17T06:18:33.676Z` |
| Hosted apply window | One branch-bound `__aggregate__` receipt, applied count 1, at `2026-11-17T06:18:34.711511Z` |
| Native acknowledgement | `2026-11-17T06:18:35.454Z`, retry count 0, no recorded error |
| Hosted feed | Product insert, cursor 2429, version 1, same hosted transaction timestamp |

The UI's zero-stock catalogue view showed the saved product and SKU. No stock
receipt, sale, payment or shift closing was performed. The synthetic product is
retained for the owner to inspect.

For an owner read-only check in SSMS on the configured local instance:

```sql
SELECT name, sku, owner_store_id, brand, row_version
FROM POS_Local_Beta.dbo.products
WHERE sku = N'SKU-000008';

SELECT change_id, entity_type, branch_id, created_at,
       acknowledged_at, retry_count, last_error
FROM POS_Local_Beta.dbo.sync_change_journal
WHERE change_id = 29 AND entity_type = N'products';
```

These queries inspect existing records; they do not create or acknowledge them.

Ordering is established by the existing writer/coordinator contract and actual
durable rows, not by comparing clocks alone. `upsertProduct` awaits
`db.commitProduct`; `commitOpsInternal` awaits the selected native writer
(`commitAggregate` when available, otherwise `writeBatch`) while local SQL is
ready and returns its local commit target. The native writer commits the product
mutation and journal in one transaction. The exact IPC variant was not
instrumented in this installed run. The uploader validates its batch
acknowledgement before acknowledging that journal.

The native aggregate UUID is not the derived upload batch UUID. The bounded
hosted receipt's batch fingerprint is `b4bcdedf2a888ab7b0cc1bb50a55afea`.
Its exact payload/batch derivation was not independently reconstructed during
this smoke test. Do not relabel this catalogue evidence as a payload-bound
financial receipt test.

## Hosted SQL to local SQL

On the same synthetic product only, a guarded Beta SQL update changed `brand`
from NULL/version 1 to `BETA SYNC VERIFIED`/version 2. It checked the exact
project system, product identity, SKU, owner and prior revision. No financial,
stock or permission fields were changed.

The hosted feed recorded update cursor 2482/version 2. Without manually copying
rows, changing cursors or restarting the app, the existing native downloader
placed that brand and version in `POS_Local_Beta`. The local product identity,
SKU, owner and zero values remained unchanged. Product journal event 29 remained
the only event for this product and stayed acknowledged: no upload echo or
duplicate product was observed.

The product feed uses the existing `global` catalogue hint. Its `owner_store_id`
remains `codex-beta-demo-shop`; that hint is not evidence of authorization to
view the product across branches. This does not make nullable
`sale_items.branch_id` global; PR #472 resolves sale items through their sales
parent instead. Cross-branch catalogue visibility was not exercised here.

## Independent checks and limits

Two agents independently performed read-only checks. The local agent verified
the pinned physical database, one matching product, the single acknowledged
journal entry and the downloaded version 2. The hosted agent independently
verified the Beta project identity, one matching product/SKU, both feed events,
the bounded receipt and exact values. Those two independent read-only checks
performed no writes.

Existing counts remained 5 sales, 6 sale items and 1 shift. Two other waiting
records seen in the UI subsequently drained to zero. The latest failure in the
inspected local log tail preceded the hosted repair; no later failure appeared
in that bounded tail. These observations do not guarantee that every historical
log or every possible action is error-free.

The network remained connected. Local SQL is the offline-capable database, but
this run did not test an internet-disconnected save, shutdown/restart while
disconnected, a second till, financial checkout/refund/transfer/booking actions,
or installation of the new native code. Keep those acceptance scopes separate.
The native fixture and CI results for PR #472 are documented in that PR; they
are not installed acceptance of those workflows. No new installer publication
was requested or performed by this rules/evidence update.
