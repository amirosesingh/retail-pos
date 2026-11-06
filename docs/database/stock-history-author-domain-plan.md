# STOCK401 original-author evidence — approved implementation, 6 November

The owner approved this exact dedicated-domain implementation and isolated tests
on 6 November. This supersedes the earlier preparation-only boundary; live
database application, enrollment, activation and deployment remain excluded.
Preserve every existing shift/financial domain, enrollment, key file and
permission check. Source completion and verification are recorded separately.

## Why this boundary exists

A terminal proof authenticates the paired device at upload. It does not prove
which cashier originally recorded a stock event, or that an explicit earlier
goods-arrival time was authorized. A delayed background upload may run while a
different cashier is signed in. Its actor cannot be substituted for the original
one. An accepted stock delta can independently prove quantity; its receipt alone
cannot prove the original effective time or author.

## Minimal proposed extension

1. Add `electron/security/stock-event-author-protocol.cjs` plus its declaration.
   Its dedicated `retail-pos.stock-event.v1` message binds project, terminal,
   branch, stable author/subject, existing key ID, operation ID, exact immutable
   movement-payload hash and a concrete source action. It cannot sign a shift,
   financial operation, arbitrary bytes or another project/branch.
2. Add only `signStockEvent` to `electron/security/shift-author-key.cjs`.
   It requires the exact existing enrolled key ID and uses the current Main-only
   OS-vault material. No generic signing/export API, key generation during
   signing, new credential store, rotation or enrollment endpoint is added.
3. Add a separate `electron/stock-event-authority.cjs` capture/prepare helper,
   reusing the existing authority's enrollment and stable Main identity. A small
   Main factory hook passes a bounded signer to stock-history capture only.
   Freeze/recheck session epoch, author, canonical subject, branch, terminal,
   project and SQL pool before committing. The renderer supplies none of these.
4. Add stock verification functions in a separate server helper, with a narrow
   shared registry-verification adapter from
   `src/lib/shift-author-verification.server.ts`. Verify exact domain/signature,
   proof hash and paired branch before reading the actual accepted source effect.
   A new metadata claim needs the original author's current domain permission;
   an exact already-accepted receipt may be acknowledged without rewriting it.
5. Store the frozen proof with the existing SQL movement metadata and journal in
   the original transaction. Upload/ACK uses the existing single request lane.
   Missing enrollment/key/revoked authority retains report evidence for review;
   it does not block offline checkout or fabricate a different author.

The action map delegates to the existing actual business-writer admission:
sale=`can_process_sale`, refund=`can_process_refund`, count/absolute stock edit
=`can_adjust_stock`, receiving=`can_receive_purchase_order`, product creation
=`can_add_new_product`, transfer legs use their existing create/approve/receive
action checks. Merge/import/missed-bill effects must reuse their existing exact
workflow checks rather than infer permission from a broad `stock` label. The
server must still validate the accepted source document and effect; a signature
or this map alone authorizes no stock write and grants no new permission.

Affected integration files: `electron/db/stock-history.cjs`, prepared local031,
the draft stock cloud migration, existing capture factory/stock upload adapter,
and focused protocol/key/Main/server/SQL tests. Existing shift and financial
protocol message bytes remain unchanged. No live enrollment, migration,
permission changes or deployment is covered by preparation approval.

## Time and coverage remain truthful

A signature proves who recorded the claim and protects its bytes. It does not
prove the PC's physical clock or when goods actually arrived. Keep original
effective time, local recording time and cloud acceptance time separate.
Unverified clock bounds, unsupported old data and missing source effects keep
the report incomplete. An explicit arrival time needs the existing receiving
authority plus its recorded reason; it must not become a fabricated verified
clock. Trusted cloud effects can support accepted quantity/provisional evidence
without this extension, but cannot certify exact actual-time historical stock
while original timing/author evidence is missing.

## Required isolated checks

Implemented source checkpoint (6 November): the dedicated wire domain,
existing-enrolled-key-only signer, Main capture/context rechecks and current
server original-author verifier are present. Frozen original proof bytes now
persist with the optional SQL movement and journal in the original transaction
and travel through the existing bounded lane/ACK. Missing vault material or
stock-evidence signing authority retains unsigned review evidence without
changing the actual business writer's admission or rolling back its stock.
Inventory/report/export permissions are not required to record a permitted sale.
The signature proves authorship and exact bytes, never physical clock time.

Independent author/helper review passed 243 cases. One new-domain branch-code
case-equivalence issue was corrected without changing existing author domains;
UUID normalization is preserved. 33 actual disposable LocalDB groups passed,
including proof/restart persistence, byte-immutable acknowledgements and missing
key/authority retention. Hosted accepted-effect admission, exclusive consumption,
Main activation and complete opening/cohort coverage remain pending. Draft031
still stays outside the installer/consolidated update and is not a final file.

Further isolated checkpoint (6 November): 45 actual disposable SQL Server groups
now pass, including immutable dedicated upload identity, restart/lost ACK,
eight-plus-two bounded pages and strict final-barrier review classification.
The final barrier may finish an otherwise accepted shift while reporting
`allUploaded:false`, exact pending/failed counts and `reportHistoryPending`.
Unknown, mixed, legacy and all financial rows remain critical. The optional
metadata hold changes no acknowledgement, queue, checkpoint or closing proof.
Independent review reproduced and corrected two narrow issues before this
checkpoint: the classifier now rechecks all queue totals in its serializable
transaction, and the exemption uses exact branch/terminal/table/kind bytes under
case-insensitive SQL defaults. Changed core queues and differently cased branch
codes therefore remain critical. New zero products, deletion and owner-only
changes invalidate old cohort coverage and retain historical identity.

Five actual protected-sale cloud fixture groups exercise the existing enrolled
author, financial opening/event, actual sale/item/activity writer, same-transaction
stock effect/publication and exact stock metadata receipt. This is stronger than
the separate minimal-origin unit fixtures; neither is production acceptance or
complete source/cohort coverage. Request-local read coalescing preserves every
signature check and fresh current-author checks on the next request.

The dedicated stock signature also binds an optional canonical original source
manifest. No-manifest stock messages and existing financial/shift domains retain
their exact bytes. Main and server match original action, operation, author,
terminal, branch, product, quantity, original times and source references. This
protects a claim's integrity only. The server still requires the actual accepted
workflow/effect; a signature alone never creates a report movement or certifies
clock/coverage. Posted receiving reads the real `purchase_orders` storage and its
saved activity; invoice dates are not substituted for physical movement time.
Ambiguous or unsupported source paths remain held, and no Main factory is active.

Current source verification: 561 focused stock/author/shift/sync tests in 25 suites,
TypeScript and scoped lint pass. The independent reviewer separately reran 216
tests, all 45 actual disposable SQL Server groups and all five genuine protected
SALE groups with no remaining blocker in the reviewed delta. Nonfinancial cloud
origin admission, Main activation, complete opening/cohort/prefix publication,
hosted CPU and installed end-to-end acceptance remain outstanding. No draft SQL
was applied to a real database or included as final upgrade bytes.

- Cross-domain, wrong branch/terminal/project/author/key, changed hash/arrival
  time, malformed/oversized proof and signer injection are denied.
- Existing enrolled key is reused unchanged; missing/unreadable/revoked key
  never rotates, enrolls or replaces material during a save/upload.
- Cashier A saves offline, cashier B later uploads, restart/lost ACK/retry and
  original-author permission revocation retain the correct author and evidence.
- A valid signature with no accepted stock effect, changed quantity or different
  document cannot create report movements; duplicate effect representations
  count once. Negative/zero stock and other branches' data remain isolated.
- Checkout, refund, transfer and all existing author-domain/permission tests pass;
  key fixtures are disposable and never use real credentials or business data.

Original nonfinancial source acceptance uses a small optional signed cohort header on the existing ordinary aggregate request. A service-only wrapper delegates the exact unchanged operations and batch identity to the current writer, then records an append-only private witness of the original header, accepted operation bytes and actual same-transaction effect IDs. Missing/invalid metadata or old accepted receipts must retain an explicit hold; they cannot change the business ACK or reconstruct original evidence from later mutable rows. Each later bounded membership claim must match its signed original member, this immutable witness and the real accepted effect/source. Prefix acceptance is distinct from completeness publication. Existing financial/shift paths stay unchanged. No live application is authorized.

Refined witness semantics: the accepted business batch owns one bounded private witness, independent of unverified header claims. Current author-registry outage must not lose the original accepted operation/effect evidence. The raw header remains UNVERIFIED and grants nothing. Full signature/current-permission/source validation happens before report movement admission, through an append-only verification receipt. Exact replay is keyed by actual accepted batch plus unchanged operations/header hashes; changed headers or old receipts lacking original evidence stay held. No original author, database generation or native operation identity is trusted merely because it appears in the raw header.
