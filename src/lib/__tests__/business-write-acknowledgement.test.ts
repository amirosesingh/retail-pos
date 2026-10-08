import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(path, "utf8");

describe("business UI persistence acknowledgements", () => {
  it("awaits financial mutations before receipt or refund success", () => {
    const store = source("src/lib/pos-store.tsx");
    const receipts = source("src/routes/receipts.tsx");
    const shifts = source("src/routes/shifts.tsx");
    expect(store).toContain("await db.refundSale(saleId, `refund:${saleId}`)");
    expect(store.indexOf("await db.refundSale")).toBeLessThan(
      store.indexOf("sales: s.sales.map((x) => (x.id === saleId"),
    );
    expect(receipts).toContain("await refundSale(selected.id, grant.grantToken, selected)");
    expect(receipts).toContain('actionKey: "SALE_CORRECTION_STARTED"');
    expect(receipts).toContain('actionKey: "SALE_REVERSED_FOR_CORRECTION"');
    expect(receipts).toContain("if (!auditReady)");
    expect(receipts).toContain("if (!reversed)");
    expect(receipts).toContain("if (!auditSaved)");
    expect(receipts).toContain("setPendingCorrectionAudit({ input: completedAudit");
    expect(receipts).toContain("rememberPendingRecordEditHistory(completedAudit)");
    expect(receipts).toContain("historyId: crypto.randomUUID()");
    expect(receipts).toContain("loadPendingRecordEditHistory(selected.id)");
    expect(receipts).toContain("Retry saving correction audit");
    expect(receipts).toContain("pendingCorrectionAudit && retryingCorrectionAudit");
    expect(receipts).toContain("pendingCorrectionAudit?.input.recordId === selected?.id");
    expect(receipts.indexOf('actionKey: "SALE_CORRECTION_STARTED"')).toBeLessThan(
      receipts.indexOf("await refundSale(selected.id"),
    );
    expect(receipts.indexOf("await refundSale(selected.id")).toBeLessThan(
      receipts.indexOf('actionKey: "SALE_REVERSED_FOR_CORRECTION"'),
    );
    expect(receipts).toContain("await changeSalePayment(selected.id");
    expect(shifts).toContain("await refundSale(s.id, grant.grantToken)");
  });

  it("awaits product and member acceptance before changing business state", () => {
    const store = source("src/lib/pos-store.tsx");
    const inventory = source("src/routes/inventory.tsx");
    const quickMember = source("src/platforms/web/components/pos/QuickMemberDialog.tsx");
    expect(store).toContain("const target = await db.commitProduct(stored)");
    expect(store).toContain("const target = await db.commitProducts(updated)");
    expect(store).toContain("await db.commitProduct(merged)");
    expect(store).toContain("const target = await db.commitMember(member)");
    expect(store).toContain("await db.deleteMember(id)");
    expect(quickMember).toContain("await upsertMember(member)");
    expect(quickMember).toContain("await upsertMember({ ...verifying, verified: true })");
    expect(inventory).toContain('notifyError(error, "Updating product categories")');
    expect(inventory).toContain('notifyError(error, "Archiving selected products")');
    expect(inventory).toContain("notifyError(error, `Archiving ${p.name}`)");
    expect(inventory).toContain("disabled={bulkSaving}");
  });

  it("commits bulk-import stock as an idempotent audited movement", () => {
    const store = source("src/lib/pos-store.tsx");
    const db = source("src/core/api/pos-db.ts");
    expect(store).toContain('id: stableChildId(importId, "6", entry.row.line)');
    expect(store).toContain("const target = await db.commitProducts(");
    expect(store).toContain('if (target === "offline")');
    expect(db).toContain('table: "item_activity_logs"');
    expect(db).toContain('activity_type: "adjustment"');
    expect(db).toContain('note: "Bulk inventory import"');
  });

  it("makes stock count draft and posting states acknowledgement-driven", () => {
    const dialog = source("src/platforms/web/components/pos/StockCountDialog.tsx");
    const store = source("src/lib/pos-store.tsx");
    expect(dialog).toContain("await db.saveStockCountDraft");
    expect(dialog).toContain("await persistDraft()");
    expect(dialog).toContain("await applyStockCount(");
    expect(dialog).toContain("postingAttemptRef.current ??=");
    expect(dialog).toContain("await saveRecordEditHistory({");
    expect(dialog).toContain("const run = saveTailRef.current");
    expect(dialog).toContain(".catch(() => undefined)");
    expect(dialog).toContain(".then(() => onOpenChange(false))");
    expect(dialog).toContain("if (postingRef.current) return");
    expect(dialog).toContain("postingRef.current = true");
    expect(dialog).toContain("postingRef.current = false");
    expect(store).toContain(".commitStockAdjustments(");
    expect(store).toContain('stableChildId(adjustmentAttemptId, "7", index)');
    expect(store).toContain(
      "draftId\n            ? {\n                id: draftId,\n                by: postedBy,",
    );
    expect(store).toContain("record: record ? { ...record, reason, note } : undefined");
    expect(dialog).toContain('draft?.status === "posted" ? null : await persistDraft()');
  });

  it("removes the detached purchase-order writer and preserves atomic receiving", () => {
    const db = source("src/core/api/pos-db.ts");
    const purchasing = source("src/routes/purchasing.tsx");
    expect(db).not.toContain("recordPurchaseOrder(");
    expect(db).toContain('commitOps("Saving receiving invoice"');
    expect(purchasing).toContain(
      "await db.commitReceivingInvoice(invoice, hubId, mayUpdateCataloguePrices)",
    );
    expect(purchasing).toContain("await saveRecordEditHistory({");
    expect(purchasing).toContain("await db.updateReceivingInvoice(");
  });

  it("waits for each transfer transition before success UI", () => {
    const transfer = source("src/routes/transfers.$id.tsx");
    const request = source("src/routes/requests.$id.tsx");
    const store = source("src/lib/pos-store.tsx");
    expect(transfer).toContain("await approveTransfer(transfer.id, lines)");
    expect(transfer).toContain("await dispatchTransfer(transfer.id, lines)");
    expect(transfer).toContain("await receiveTransfer(transfer.id)");
    expect(transfer).toContain("await rejectTransfer(transfer.id, reason)");
    expect(request).toContain("await approveTransfer(transfer.id, lines)");
    expect(store).toContain("await saveTransfer({");
    expect(store).not.toContain("void dispatchTransferInDb");
    expect(store).not.toContain("void receiveTransferInDb");
    const dialog = source("src/platforms/web/components/pos/TransferStepDialog.tsx");
    expect(dialog).toContain("if (busy || needsReason) return");
    expect(dialog).toContain("await onConfirm(");
    expect(dialog).toContain("disabled={needsReason || busy}");
    expect(store).toContain('type: "stock_request_received"');
    expect(store).toContain('type: "transfer_sent"');
    expect(store).toContain('type: "transfer_received"');
  });

  it("keeps receiving records visible and opens stock entry in one Add New dialog", () => {
    const purchasing = source("src/routes/purchasing.tsx");
    expect(purchasing).toContain("<PackagePlus");
    expect(purchasing).toContain("Add new stock");
    expect(purchasing).toContain("open={entryOpen}");
    expect(purchasing).toContain('type: "po_finalised"');
    expect(purchasing).toContain('<h2 className="text-sm font-semibold">Receiving records</h2>');
  });

  it("retains only explicitly soft or post-commit asynchronous work", () => {
    const db = source("src/core/api/pos-db.ts");
    expect(db).toContain("const queueSoft");
    expect(db).toContain("void commitOps(context, [op]).catch(note)");
    expect(db).not.toContain("void commitOps(context, [op]).catch((e) => dbError");
  });

  it("persists a no-sale audit before opening the cash drawer", () => {
    const ledger = source("src/lib/drawer-events.ts");
    const register = source("src/routes/index.tsx");
    expect(ledger).toContain("await db.commitDrawerEvent({");
    expect(register).toContain("await recordNoSale({");
    const noSale = register.slice(register.indexOf("await recordNoSale({"));
    expect(noSale.indexOf("await recordNoSale({")).toBeLessThan(noSale.indexOf("openCashDrawer()"));
  });

  it("verifies a saved shift without querying the protected table directly", () => {
    const db = source("src/core/api/pos-db.ts");
    const lookup = db.slice(db.indexOf("async shiftExists"), db.indexOf("commitDrawerEvent"));
    expect(lookup).toContain('routedQuery("shifts"');
    expect(lookup).toContain('"shift_list_secure"');
    expect(lookup).toContain(': "unknown"');
    expect(lookup).not.toContain('.from("shifts"');
    expect(source("src/lib/pos-store.tsx")).toContain("db.shiftExists(shift.id, shift.storeId)");
  });
});
