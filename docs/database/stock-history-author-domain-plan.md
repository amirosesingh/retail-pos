# STOCK401 original-author evidence — preparation requiring scope approval

This document is a proposal, not an implemented signer or a live database change.
The existing report approval covers accepted-effect capture and durable metadata.
It does not authorize expanding the existing protected key API. Preserve every
existing shift/financial domain, enrollment, key file and permission check.

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
