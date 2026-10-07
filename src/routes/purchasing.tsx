import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FilePlus2,
  FileSpreadsheet,
  Download,
  PackagePlus,
  Pencil,
  Lock,
  Save,
  ScanBarcode,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useManagerGate } from "@/lib/manager-gate";
import {
  beginPostedEdit,
  continuePostedEdit,
  myServerId,
  saveRecordEditHistory,
  withdrawPostedEdit,
  type EditGrant,
} from "@/lib/record-edit-flow";
import { notifyError } from "@/lib/notify";
import * as XLSX from "xlsx";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import {
  db,
  invoiceNumberTaken,
  loadReceivingDrafts,
  loadReceivingInvoices,
  type ReceivingInvoice,
} from "@/core/api/pos-db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { money, stockAt, usePos } from "@/lib/pos-store";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import {
  groupList,
  selectableCategories,
  subCategoryList,
  topCategories,
  useCategories,
} from "@/lib/catalog-meta";
import { resolveByBarcode } from "@/lib/product-lookup";
import { centralHub, locationPath, primarySub, routingTargets } from "@/lib/locations";
import { Badge } from "@/components/ui/badge";
import { canEditPosted, nextStockRef } from "@/lib/stock-ref";
import { ReceivingRecordView } from "@/platforms/web/components/pos/ReceivingRecordView";
import { BulkImportDialog } from "@/platforms/web/components/pos/BulkImportDialog";
import { subscribeDataChange } from "@/lib/sync-engine";
import { TablePagination, usePagination } from "@/platforms/web/components/pos/TablePagination";
import { IMPORT_HEADERS } from "@/lib/product-import";

/** Sentinel for "no value picked" — Radix selects cannot hold an empty value. */
const PO_NONE = "__none";

/** List options plus a blank choice, keeping any legacy value that is off-list. */
const poOptions = (names: string[], current?: string) => [
  { value: PO_NONE, label: "— none —" },
  ...[...new Set([...names, ...(current ? [current] : [])])]
    .sort()
    .map((n) => ({ value: n, label: n })),
];
import { useAuth } from "@/lib/pos-auth";
import { logger } from "@/lib/audit-log";
import { logSystemAction } from "@/lib/system-audit";
import { activeBranchId } from "@/lib/active-branch";
import { cachedSuppliers, loadSuppliers, type Supplier } from "@/lib/suppliers";
import type { Product } from "@/core/types/pos-types";
import { recordActivity } from "@/lib/activity-events";

export const Route = createFileRoute("/purchasing")({
  head: () => ({
    meta: [
      { title: "Receiving Orders & Stock Entry — Retail" },
      {
        name: "description",
        content:
          "Scan supplier invoices line by line, edit cost and quantity received, create missing items inline and post stock into the branch.",
      },
      { property: "og:title", content: "Receiving Orders & Stock Entry — Retail" },
      {
        property: "og:description",
        content: "Barcode-driven receiving invoices with inline product creation and audit trail.",
      },
    ],
  }),
  component: Purchasing,
});

type Line = {
  id: string;
  productId: string;
  barcode: string;
  name: string;
  cost: number;
  price: number;
  qty: number;
};

/** A received line still sitting in the hub, waiting to be routed onward. */
type PutAwayLine = {
  id: string;
  productId: string;
  name: string;
  qty: number;
  invoiceNo: string;
  targetId: string;
};

const today = () => new Date().toISOString().slice(0, 10);
const localDateTime = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const units = (inv: ReceivingInvoice) => inv.lines.reduce((a, l) => a + l.qty, 0);

function Purchasing() {
  const { authorize } = useManagerGate();
  const [editGrant, setEditGrant] = useState<EditGrant | null>(null);
  const [busyRow, setBusyRow] = useState("");
  const [meId, setMeId] = useState("");

  useEffect(() => {
    void myServerId().then(setMeId);
  }, []);
  const { state, currentStore, allStores, upsertProduct, moveStock, syncProducts } = usePos();
  const { can, user, isAdmin, isSupervisor } = useAuth();
  const [invoiceNo, setInvoiceNo] = useState("");
  const [supplier, setSupplier] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(today());
  const [entryDate, setEntryDate] = useState(() => localDateTime(new Date().toISOString()));
  const [scan, setScan] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [history, setHistory] = useState<ReceivingInvoice[]>([]);
  const [masterView, setMasterView] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [editing, setEditing] = useState<ReceivingInvoice | null>(null);
  const [removedLineIds, setRemovedLineIds] = useState<string[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const editAttempt = useRef(crypto.randomUUID());
  const finalizeAttempt = useRef<string | null>(null);
  const [draft, setDraft] = useState<Product | null>(null);
  const [draftQty, setDraftQty] = useState("1");
  /*
    Draft receiving orders. The entry is written to the database as soon as the
    first line lands, and every later change updates that same row, so a part-
    entered delivery survives navigating away, logging out or a restart. A
    draft never touches stock — only Finalize does.
  */
  const [openDraftId, setOpenDraftId] = useState<string | null>(null);
  /** Our own goods-received number, minted once when the draft row is created. */
  const [reference, setReference] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "posted" | "cancelled">("all");
  const [viewing, setViewing] = useState<ReceivingInvoice | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [draftLineRemovals, setDraftLineRemovals] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<ReceivingInvoice[]>([]);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [discardId, setDiscardId] = useState<string | null>(null);
  const catalogLists = useCategories();
  const scanRef = useRef<HTMLInputElement>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>(cachedSuppliers());
  const [importOpen, setImportOpen] = useState(false);
  /*
    Central-first receiving. Every delivery lands in the hub, and only a
    deliberate put-away moves it onto a shop floor or sub-warehouse, so stock
    is never in two places at once and nothing is silently absorbed.
  */
  const hub = useMemo(() => centralHub(allStores) ?? currentStore, [allStores, currentStore]);
  const putAwayTargets = useMemo(
    () => routingTargets(allStores, currentStore.id).filter((s) => s.id !== hub.id),
    [allStores, currentStore.id, hub.id],
  );
  const [pending, setPending] = useState<PutAwayLine[]>([]);
  /** Levels default to the warehouse's primary pick location when there is one. */
  const defaultPutAwayId = useMemo(() => {
    const primary = primarySub(allStores, hub.id) ?? primarySub(allStores, currentStore.id);
    if (primary && putAwayTargets.some((s) => s.id === primary.id)) return primary.id;
    return putAwayTargets[0]?.id ?? "";
  }, [allStores, hub.id, currentStore.id, putAwayTargets]);

  const totals = useMemo(
    () => ({
      units: lines.reduce((a, l) => a + l.qty, 0),
      cost: Number(lines.reduce((a, l) => a + l.cost * l.qty, 0).toFixed(2)),
    }),
    [lines],
  );

  useEffect(() => {
    scanRef.current?.focus();
  }, []);

  useEffect(() => {
    void loadSuppliers().then(setSuppliers);
  }, []);

  /** Invoice history is a database read, so it survives reloads and restarts. */
  /** Reopening a received entry always goes through the configured authorisation. */
  const openForEdit = (h: ReceivingInvoice, grant: EditGrant | null) => {
    editAttempt.current = crypto.randomUUID();
    setEditGrant(grant);
    setRemovedLineIds([]);
    setEditing(structuredClone(h));
  };

  const editReceived = async (h: ReceivingInvoice) => {
    setBusyRow(h.id);
    try {
      const outcome = await beginPostedEdit(authorize, {
        action: "edit_posted_purchase",
        recordKind: "purchase_order",
        recordId: h.id,
        reference: h.reference ?? h.invoiceNo ?? h.id,
        title: "Edit a received purchase",
        storeId: h.storeId ?? currentStore.id,
        detail: `${h.reference ?? h.id} · ${h.supplier ?? ""}`.trim(),
      });
      if (outcome.kind === "open") openForEdit(h, outcome.grant);
      else if (outcome.kind === "queued") await refreshHistory();
    } finally {
      setBusyRow("");
    }
  };

  /** Come back to an entry whose edit was sent for approval. */
  const continueEdit = async (h: ReceivingInvoice) => {
    setBusyRow(h.id);
    try {
      const res = await continuePostedEdit("purchase_order", h.id);
      if (res.open) openForEdit(h, res.grant ?? null);
      await refreshHistory();
    } finally {
      setBusyRow("");
    }
  };

  const withdrawEdit = async (h: ReceivingInvoice) => {
    setBusyRow(h.id);
    try {
      if (await withdrawPostedEdit("purchase_order", h.id)) await refreshHistory();
    } finally {
      setBusyRow("");
    }
  };

  /** True when this record was entered on a branch the user is not on. */
  const otherBranch = (h: ReceivingInvoice) =>
    !isAdmin && !!h.storeId && h.storeId !== currentStore.id;

  const refreshHistory = async (): Promise<ReceivingInvoice[] | null> => {
    try {
      const rows = await loadReceivingInvoices(currentStore.id, 100, masterView, "any");
      setHistory(rows);
      setHistoryError(null);
      return rows;
    } catch (e) {
      setHistoryError((e as Error).message || "Could not read the invoice history");
      return null;
    }
  };

  /** Unfinished entries for this branch, so nothing half-typed gets lost. */
  const refreshDrafts = async () => {
    try {
      setDrafts(await loadReceivingDrafts(currentStore.id, masterView));
      setDraftError(null);
    } catch (error) {
      setDraftError((error as Error).message || "Could not read receiving drafts");
    }
  };

  /**
   * Show the result of a finalize the moment it is stored, the way a posted
   * stock count does: the entry moves into history and out of the drafts list
   * from what we already know, without waiting for the central copy.
   */
  const showAsPosted = (inv: ReceivingInvoice) => {
    setHistory((h) => [inv, ...h.filter((x) => x.id !== inv.id)]);
    setDrafts((d) => d.filter((x) => x.id !== inv.id));
  };

  /**
   * Bring the lists back in line with what is stored, and only pull server
   * quantities once that copy actually shows the posted entry. Reading them
   * earlier would hand back pre-receipt figures and undo the numbers on
   * screen, which is exactly what forced a manual reload before.
   */
  const reconcileAfterPost = async (inv: ReceivingInvoice, productIds: string[]) => {
    try {
      const rows = await refreshHistory();
      await refreshDrafts();
      const stored = rows?.find((r) => r.id === inv.id);
      if (stored && stored.status === "posted") await syncProducts(productIds);
    } catch {
      toast.info("Receiving was saved; the lists will refresh when the connection settles.");
    }
  };

  useEffect(() => {
    void refreshHistory();
    void refreshDrafts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStore.id, masterView]);

  useEffect(() => {
    let timer: number | undefined;
    const unsubscribe = subscribeDataChange((change) => {
      if (change.table !== "purchase_orders" && change.table !== "purchase_order_items") return;
      if (!masterView && change.storeId && change.storeId !== currentStore.id) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void refreshHistory();
        void refreshDrafts();
      }, 250);
    });
    return () => {
      if (timer) window.clearTimeout(timer);
      unsubscribe();
    };
    // refresh functions intentionally read the latest branch and master-view state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStore.id, masterView]);

  /** The entry as it stands right now, in the shape the database stores. */
  const visibleHistory = useMemo(
    () => (statusFilter === "all" ? history : history.filter((h) => h.status === statusFilter)),
    [history, statusFilter],
  );
  const historyPagination = usePagination(visibleHistory);

  const buildInvoice = (
    status: "draft" | "posted",
    id: string,
    ref: string | null = reference,
  ): ReceivingInvoice => ({
    id,
    reference: ref,
    invoiceNo: invoiceNo.trim(),
    supplier: supplier.trim(),
    supplierId: suppliers.find((s) => s.name === supplier.trim())?.id ?? null,
    operator: user?.name ?? "—",
    storeId: currentStore.id || activeBranchId(currentStore.id),
    storeCode: currentStore.code,
    invoiceDate,
    entryDate: new Date(entryDate).toISOString(),
    totalCost: totals.cost,
    itemCount: lines.length,
    createdAt: new Date().toISOString(),
    status,
    pendingEditRequestId: null,
    pendingEditBy: null,
    lines: lines.map((l) => ({
      // The queue line id *is* the stored line id, so autosaves update rows
      // in place instead of piling up duplicates.
      id: l.id,
      productId: l.productId,
      barcode: l.barcode,
      sku: l.barcode,
      name: l.name,
      cost: l.cost,
      price: l.price,
      qty: l.qty,
    })),
  });

  /*
    The one and only way an unfinished entry reaches the database. The timer
    below and the Save draft button both call this, so a click during an
    autosave cannot write the same entry twice or mint a second draft.
  */
  type SavedDraftIdentity = { id: string; reference: string };
  const draftSavePromiseRef = useRef<Promise<SavedDraftIdentity | null> | null>(null);
  const finalizingRef = useRef(false);
  async function persistDraft(): Promise<SavedDraftIdentity | null> {
    if (!lines.length || finalizingRef.current) return null;
    if (draftSavePromiseRef.current) return draftSavePromiseRef.current;
    const id = openDraftId ?? crypto.randomUUID();
    // The reference is minted with the draft row and never regenerated.
    const ref =
      reference ??
      nextStockRef(
        state.settings.integrations.receivingNumbering ?? {},
        currentStore.code || currentStore.id,
        "receiving",
      );
    const removals = draftLineRemovals;
    const save = (async () => {
      try {
        await db.saveReceivingDraft(buildInvoice("draft", id, ref), removals);
        setOpenDraftId(id);
        setReference(ref);
        setDraftLineRemovals((r) => r.filter((x) => !removals.includes(x)));
        setDraftSavedAt(new Date().toISOString());
        return { id, reference: ref };
      } catch (error) {
        setDraftError((error as Error).message || "Could not save receiving draft");
        return null;
      }
    })();
    draftSavePromiseRef.current = save;
    try {
      return await save;
    } finally {
      if (draftSavePromiseRef.current === save) draftSavePromiseRef.current = null;
    }
  }

  // Debounced autosave: fast scanning must not hammer the database.
  useEffect(() => {
    if (!lines.length) return;
    const t = setTimeout(() => void persistDraft(), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, invoiceNo, supplier, invoiceDate, entryDate, openDraftId, draftLineRemovals]);

  /** Save draft button: the same save, on demand, with a word of feedback. */
  async function saveDraftNow() {
    if (!lines.length) return toast.error("Scan at least one item before saving a draft");
    setSavingDraft(true);
    try {
      const saved = await persistDraft();
      if (saved) {
        toast.success("Draft saved");
        await refreshDrafts();
      } else toast.error("Draft was not saved", { description: "Check the error above and try again." });
    } finally {
      setSavingDraft(false);
    }
  }

  /** Load a saved draft back into the form for more items or invoices. */
  function resumeDraft(inv: ReceivingInvoice) {
    setEntryOpen(true);
    setOpenDraftId(inv.id);
    setReference(inv.reference);
    setDraftLineRemovals([]);
    setInvoiceNo(inv.invoiceNo);
    setSupplier(inv.supplier);
    setInvoiceDate(inv.invoiceDate ?? today());
    setEntryDate(localDateTime(inv.entryDate));
    setLines(
      inv.lines.map((l) => ({
        id: l.id,
        productId: l.productId ?? "",
        barcode: l.barcode ?? "",
        name: l.name,
        cost: l.cost,
        price: l.price,
        qty: l.qty,
      })),
    );
    setDraftSavedAt(inv.entryDate);
    toast.success(`Draft ${inv.invoiceNo || "(no number yet)"} reopened`);
    scanRef.current?.focus();
  }

  /** Clear the form back to a fresh entry without touching what is stored. */
  function clearForm() {
    finalizeAttempt.current = null;
    setOpenDraftId(null);
    setReference(null);
    setDraftLineRemovals([]);
    setDraftSavedAt(null);
    setInvoiceNo("");
    setSupplier("");
    setInvoiceDate(today());
    setEntryDate(localDateTime(new Date().toISOString()));
    setLines([]);
  }

  /** Abandon a draft. The row is kept as cancelled for audit, never deleted. */
  async function discardDraft(id: string) {
    try {
      await db.discardReceivingDraft(id);
      if (openDraftId === id) clearForm();
      toast.success("Draft discarded");
      await refreshDrafts();
    } catch (e) {
      notifyError(e, "The draft was not discarded");
    } finally {
      setDiscardId(null);
    }
  }

  if (!can("can_receive_purchase_order")) {
    return (
      <AppShell>
        <div className="flex min-h-screen items-center justify-center p-6">
          <div className="max-w-sm rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-center">
            <ShieldAlert className="mx-auto size-6 text-destructive" />
            <p className="mt-2 font-semibold">Permission required</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Your profile does not have “Can Create New Products / Access PO Engine”.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  const findProduct = (code: string) => resolveByBarcode(state.products, code);

  const patch = (id: string, next: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...next } : l)));

  const addLine = (p: Product, qty = 1) =>
    setLines((ls) => {
      const existing = ls.find((l) => l.productId === p.id);
      if (existing) return ls.map((l) => (l.id === existing.id ? { ...l, qty: l.qty + qty } : l));
      return [
        ...ls,
        {
          id: crypto.randomUUID(),
          productId: p.id,
          barcode: p.barcode,
          name: p.name,
          cost: p.cost,
          price: p.price,
          qty,
        },
      ];
    });

  function submitScan() {
    const code = scan.trim();
    if (!code) return;
    const hit = findProduct(code);
    setScan("");
    if (hit) {
      addLine(hit);
      logger.log("inventory_edit", "Receiving line scanned", "purchasing", {
        barcode: code,
        productId: hit.id,
        name: hit.name,
        matched: true,
      });
      toast.success(`${hit.name} added to invoice`);
      return;
    }
    logger.log("inventory_edit", "Unknown barcode scanned", "purchasing", {
      barcode: code,
      matched: false,
    });
    if (!can("can_add_new_product")) {
      toast.error("This barcode is not in the catalogue", {
        description: "Add new products permission is required to create it during receiving.",
      });
      return;
    }
    setDraftQty("1");
    setDraft({
      id: crypto.randomUUID(),
      name: "",
      sku: code,
      barcode: code,
      category: "General",
      price: 0,
      cost: 0,
      ecomPrice: 0,
      ecomVisible: false,
      stockByStore: Object.fromEntries(state.stores.map((s) => [s.id, 0])),
      reorderLevel: 10,
      taxRate: state.settings.tax.enabled ? state.settings.tax.rate / 100 : 0,
    });
  }

  async function saveDraft() {
    try {
      await saveDraftInner();
    } catch (error) {
      notifyError(error, "Saving the product");
    }
  }

  /** Download a receiving template the buyer can fill in and upload back. */
  function downloadTemplate() {
    const sheet = XLSX.utils.aoa_to_sheet([
      [...IMPORT_HEADERS],
      ["8901234567890", "Sample item", 7.9, 4.5, "General", "pcs", 12, 0, 0],
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Receiving");
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ["Field", "Required", "What to enter"],
        ["barcode", "Yes", "Unique barcode or SKU"],
        ["name", "Yes", "Product name"],
        ["price", "Yes", "Selling price greater than zero"],
        ["cost", "No", "Cost price; blank becomes 0"],
        ["category", "No", "Product category"],
        ["unit", "No", "Unit of measure"],
        ["stock_quantity", "Yes", "Quantity received; must be greater than zero"],
        ["custom_points", "No", "Loyalty points; blank becomes 0"],
        ["tax_rate_percent", "No", "0 to 100; blank uses enabled Tax Settings, otherwise 0"],
      ]),
      "Instructions",
    );
    XLSX.writeFile(book, "receiving-template.xlsx");
  }

  /** Moves one received line out of the hub onto its final location. */
  async function movePutAway(row: PutAwayLine) {
    const target = putAwayTargets.find((s) => s.id === row.targetId);
    if (!target) return toast.error("Pick a destination first");
    try {
      await moveStock(row.productId, row.qty, hub.id, target.id);
    } catch (error) {
      notifyError(error, "Moving received stock");
      return;
    }
    logger.log("inventory_edit", "Received stock put away", "purchasing", {
      invoiceNo: row.invoiceNo,
      productId: row.productId,
      name: row.name,
      qty: row.qty,
      from: hub.name,
      to: locationPath(allStores, target.id),
    });
    setPending((q) => q.filter((r) => r.id !== row.id));
    toast.success(`${row.qty} × ${row.name} moved to ${target.name}`);
  }

  async function saveDraftInner() {
    if (!draft) return;
    if (!can("can_add_new_product")) {
      return toast.error("Add new products permission is required");
    }
    if (!draft.name.trim()) return toast.error("Item name is required");
    if (!draft.price) return toast.error("Selling price is required");
    const qty = Math.max(1, Number(draftQty) || 1);
    await upsertProduct({ ...draft, ecomPrice: draft.ecomPrice || draft.price });
    addLine(draft, qty);
    toast.success(`“${draft.name}” created and added to the invoice`);
    setDraft(null);
    scanRef.current?.focus();
  }

  /**
   * Finalize the invoice.
   *
   * The invoice is stored (cloud, local database or the durable outbox) BEFORE
   * the form is cleared, so a receiving order can never be lost. Stock is
   * posted once per line, and any cost change is merged into the product as it
   * stands after that posting — writing back a pre-adjustment snapshot is what
   * used to silently undo the quantity that had just been received.
   */
  async function finalize() {
    const ref = invoiceNo.trim();
    if (!ref) return toast.error("Invoice number is required");
    if (!supplier.trim()) return toast.error("Supplier name is required");
    if (!lines.length) return toast.error("Scan at least one item into the invoice");
    if (saving) return;

    finalizingRef.current = true;
    setSaving(true);
    try {
      // Finish any autosave that already started, then block later draft saves.
      // Otherwise a slow draft write can arrive after the posted write and
      // incorrectly put a finalized receiving order back into Draft.
      const savedDraft = await draftSavePromiseRef.current;
      const attemptId =
        savedDraft?.id ?? openDraftId ?? finalizeAttempt.current ?? crypto.randomUUID();
      finalizeAttempt.current = attemptId;
      if (await invoiceNumberTaken(ref, attemptId)) {
        toast.error(`Invoice ${ref} already exists`, {
          description: "Open it in the history below to correct it, or use a different number.",
        });
        return;
      }

      // A receiving order must never land without a branch: fall back to the
      // branch this terminal is bound to when the view has not resolved one.
      // Stock itself is always posted into the hub, never straight to a floor.
      const storeId = currentStore.id || activeBranchId(currentStore.id);
      if (!storeId) {
        toast.error("This terminal has no branch yet", {
          description: "Activate the terminal or pick a branch before receiving stock.",
        });
        return;
      }
      const hubId = hub.id || storeId;
      // Finalizing a resumed draft posts the very same record, so the entry
      // keeps its id and can never be posted twice as two invoices.
      const wasDraft = savedDraft?.id ?? openDraftId;
      // A never-autosaved entry still needs its own goods-received number.
      const grn =
        savedDraft?.reference ??
        reference ??
        nextStockRef(
          state.settings.integrations.receivingNumbering ?? {},
          currentStore.code || currentStore.id,
          "receiving",
        );
      const invoice: ReceivingInvoice = {
        ...buildInvoice("posted", attemptId, grn),
        invoiceNo: ref,
        storeId,
      };

      // The hub is where the stock actually lands, so the movement rows are
      // stamped with it and committed alongside the invoice.
      if (wasDraft) await db.updateReceivingInvoice(invoice, draftLineRemovals, hubId);
      else await db.commitReceivingInvoice(invoice, hubId);

      const movements = [];
      for (const l of lines) {
        const previousStock = stockAt(
          state.products.find((p) => p.id === l.productId) ?? ({ stockByStore: {} } as Product),
          hubId,
        );
        // The receiving commit has already applied this movement exactly once.
        movements.push({
          productId: l.productId,
          barcode: l.barcode,
          name: l.name,
          qty: l.qty,
          unitCost: l.cost,
          lineCost: Number((l.cost * l.qty).toFixed(2)),
          previousStock,
          updatedStock: previousStock + l.qty,
          storeId: hubId,
        });
      }

      logger.log("inventory_edit", "Receiving order finalized", "purchasing", {
        invoiceNo: ref,
        supplier: invoice.supplier,
        invoiceDate,
        entryDate: invoice.entryDate,
        uniqueItems: lines.length,
        totalUnits: totals.units,
        totalCost: totals.cost,
        operator: invoice.operator,
        storeCode: currentStore.code,
        receivedInto: hub.name,
        stockMovements: movements,
      });
      recordActivity({
        type: "po_finalised",
        title: `Goods received · ${grn}`,
        message: `${invoice.supplier} · invoice ${ref} · ${totals.units} unit(s) received into ${hub.name}.`,
        actorName: invoice.operator,
        storeId,
        entityType: "receiving_order",
        entityId: invoice.id,
        meta: {
          route: "/purchasing",
          audience: "receiving_branch",
          audience_roles: ["admin", "manager", "supervisor", "warehouse", "cashier"],
          invoice_no: ref,
          supplier: invoice.supplier,
          reference: grn,
        },
      });

      toast.success(`Invoice ${ref} received into ${hub.name}`, {
        description: `${totals.units} units · ${money(totals.cost)}`,
      });
      // Queue put-away when this branch has somewhere else the stock can go.
      if (putAwayTargets.length)
        setPending((q) => [
          ...q,
          ...lines.map((l) => ({
            id: crypto.randomUUID(),
            productId: l.productId,
            name: l.name,
            qty: l.qty,
            invoiceNo: ref,
            targetId: defaultPutAwayId,
          })),
        ]);
      const postedIds = lines.map((l) => l.productId);
      showAsPosted(invoice);
      clearForm();
      setEntryOpen(false);
      void reconcileAfterPost(invoice, postedIds);
      scanRef.current?.focus();
    } catch (e) {
      notifyError(e, "The invoice was not saved");
    } finally {
      finalizingRef.current = false;
      setSaving(false);
      scanRef.current?.focus();
    }
  }

  /** Save corrections to an already-received invoice, applying stock deltas. */
  // Line-level corrections are a supervisor action; anyone may fix the header.
  const mayEditLines = isAdmin || isSupervisor;

  function patchEditLine(index: number, patch: Partial<ReceivingInvoice["lines"][number]>) {
    setEditing((inv) =>
      inv
        ? { ...inv, lines: inv.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) }
        : inv,
    );
  }

  async function saveEdit() {
    if (!editing) return;
    const ref = editing.invoiceNo.trim();
    if (!ref) return toast.error("Invoice number is required");
    if (!editing.supplier.trim()) return toast.error("Supplier name is required");
    setSavingEdit(true);
    try {
      if (await invoiceNumberTaken(ref, editing.id)) {
        toast.error(`Invoice ${ref} is already used by another receiving order`);
        return;
      }
      const original = history.find((h) => h.id === editing.id);
      const cost = Number(editing.lines.reduce((a, l) => a + l.cost * l.qty, 0).toFixed(2));
      const next: ReceivingInvoice = {
        ...editing,
        invoiceNo: ref,
        supplier: editing.supplier.trim(),
        supplierId: suppliers.find((s) => s.name === editing.supplier.trim())?.id ?? null,
        totalCost: cost,
        itemCount: editing.lines.length,
      };
      // Corrections append only the quantity difference under stable retry IDs.
      if (!original) throw new Error("Reload the invoice before editing it");
      await db.updateReceivingInvoice(next, removedLineIds, next.storeId, {
        previous: original,
        attemptId: editAttempt.current,
      });

      // Deltas only: nothing is removed and re-added, so history stays intact.
      const deltas: Record<string, number> = {};
      for (const l of original?.lines ?? []) {
        if (l.productId) deltas[l.productId] = (deltas[l.productId] ?? 0) - l.qty;
      }
      for (const l of next.lines) {
        if (l.productId) deltas[l.productId] = (deltas[l.productId] ?? 0) + l.qty;
      }
      // Retain the movement difference for the audit record.
      const auditDeltas: Record<string, number> = { ...deltas };
      // Stock and pricing were committed above; do not apply a second adjustment.
      await syncProducts([
        ...new Set(
          [...next.lines, ...original.lines].map((line) => line.productId ?? "").filter(Boolean),
        ),
      ]);

      logger.log("inventory_edit", "Receiving invoice corrected", "purchasing", {
        invoiceId: next.id,
        invoiceNo: next.invoiceNo,
        supplier: next.supplier,
        entryDate: next.entryDate,
        removedLines: removedLineIds.length,
        stockDeltas: deltas,
        storeCode: currentStore.code,
      });

      // Immutable edit history: who changed what, with before and after values.
      const snapshot = (inv: ReceivingInvoice | undefined) =>
        inv
          ? {
              invoiceNo: inv.invoiceNo,
              supplier: inv.supplier,
              invoiceDate: inv.invoiceDate,
              entryDate: inv.entryDate,
              totalCost: inv.totalCost,
              lines: inv.lines.map((l) => ({
                id: l.id,
                name: l.name,
                qty: l.qty,
                cost: l.cost,
                price: l.price,
              })),
            }
          : null;
      logSystemAction({
        actorId: user?.staffId ?? null,
        actorName: user?.name ?? null,
        actorRole: user?.metaRole ?? user?.role ?? null,
        actionType: "purchase_order_edit",
        entityAffected: "purchase_orders",
        entityId: next.id,
        oldValue: snapshot(original),
        newValue: snapshot(next),
        storeId: next.storeId,
        note: `Invoice ${next.invoiceNo} corrected`,
      });

      // The same before/after, in the authorisation record book, with who
      // allowed the change and how it was allowed.
      void saveRecordEditHistory({
        kind: "purchase_order",
        recordId: next.id,
        ...(next.reference ? { reference: next.reference } : {}),
        storeId: next.storeId,
        actionKey: "edit_posted_purchase",
        grant: editGrant,
        before: snapshot(original),
        after: snapshot(next),
        stockDeltas: auditDeltas,
        note: `Invoice ${next.invoiceNo} corrected`,
      });

      toast.success(`Invoice ${next.invoiceNo} updated`);
      setEditing(null);
      setEditGrant(null);
      setRemovedLineIds([]);
      showAsPosted(next);
      void reconcileAfterPost(next, next.lines.map((l) => l.productId ?? "").filter(Boolean));
    } catch (e) {
      notifyError(e, "The correction was not saved");
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-5 p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Receiving order &amp; stock entry</h1>
            <p className="text-sm text-muted-foreground">
              Receiving into {currentStore.name} · operator {user?.name}
            </p>
          </div>
          <Button
            onClick={() => {
              void (async () => {
                if (lines.length && !(await persistDraft())) {
                  toast.error("The current receiving draft could not be saved");
                  return;
                }
                clearForm();
                setEntryOpen(true);
              })();
            }}
          >
            <PackagePlus className="size-4" /> Add new stock
          </Button>
        </header>

        <Dialog open={entryOpen} onOpenChange={setEntryOpen}>
          <DialogContent className="max-h-[92vh] w-[min(96vw,1200px)] max-w-none overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{openDraftId ? "Resume receiving order" : "Add new stock"}</DialogTitle>
              <DialogDescription>
                Enter the supplier and invoice first, then scan or add the stock lines. Saving a
                draft never changes stock; finalizing posts it once.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Invoice number *</Label>
                  <Input
                    value={invoiceNo}
                    onChange={(e) => setInvoiceNo(e.target.value)}
                    placeholder="e.g. INV-2026-0417"
                    className="numeric h-11"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Supplier name *</Label>
                  <div className="flex gap-2">
                    <select
                      value={suppliers.some((s) => s.name === supplier) ? supplier : ""}
                      onChange={(e) => setSupplier(e.target.value)}
                      aria-label="Supplier"
                      className="h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm"
                    >
                      <option value="">Pick a supplier…</option>
                      {suppliers
                        .filter((s) => s.active)
                        .map((s) => (
                          <option key={s.id} value={s.name}>
                            {s.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <Input
                    value={supplier}
                    onChange={(e) => setSupplier(e.target.value)}
                    placeholder="or type a supplier name"
                    className="h-9"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Invoice date</Label>
                  <Input
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    className="numeric h-11"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Entry date &amp; time (defaults to now)
                  </Label>
                  <Input
                    type="datetime-local"
                    value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value)}
                    className="numeric h-11"
                  />
                </div>
              </div>

              <Separator />

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Scan or search barcode</Label>
                <div className="flex gap-2">
                  <Input
                    ref={scanRef}
                    value={scan}
                    onChange={(e) => setScan(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submitScan()}
                    placeholder="Scan a barcode and press Enter"
                    className="numeric h-11 max-w-md"
                  />
                  <Button className="h-11" onClick={submitScan}>
                    <ScanBarcode className="size-4" /> Add to invoice
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border p-3">
                <FileSpreadsheet className="size-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  Received a supplier spreadsheet? Import the purchased products straight into this
                  invoice.
                </span>
                <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                  <FileSpreadsheet className="size-4" /> Import Excel / CSV
                </Button>
                <Button variant="ghost" size="sm" onClick={downloadTemplate}>
                  <Download className="size-4" /> Template
                </Button>
              </div>

              <BulkImportDialog
                open={importOpen}
                onOpenChange={setImportOpen}
                mode="receiving"
                onReceivingRows={(imported) => {
                  for (const row of imported) {
                    addLine(
                      {
                        ...row.product,
                        cost: row.cost || row.product.cost,
                        price: row.price || row.product.price,
                      },
                      Math.max(1, row.quantity),
                    );
                  }
                  logger.log("inventory_edit", "Receiving lines imported from file", "purchasing", {
                    rows: imported.length,
                    created: imported.filter(
                      (row) => !state.products.some((p) => p.id === row.product.id),
                    ).length,
                  });
                  toast.success(`${imported.length} validated lines added to this invoice`);
                }}
              />

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Barcode</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="w-32 text-right">Cost price</TableHead>
                    <TableHead className="text-right">Selling price</TableHead>
                    <TableHead className="w-28 text-right">Qty received</TableHead>
                    <TableHead className="text-right">Subtotal cost</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="numeric">{l.barcode}</TableCell>
                      <TableCell className="font-medium">{l.name}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          className="numeric h-9 text-right"
                          value={l.cost}
                          onChange={(e) => patch(l.id, { cost: Number(e.target.value) || 0 })}
                        />
                      </TableCell>
                      <TableCell className="numeric text-right text-muted-foreground">
                        {money(l.price)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          className="numeric h-9 text-right"
                          value={l.qty}
                          onChange={(e) =>
                            patch(l.id, { qty: Math.max(0, Number(e.target.value) || 0) })
                          }
                        />
                      </TableCell>
                      <TableCell className="numeric text-right font-medium">
                        {money(l.cost * l.qty)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Remove line"
                          onClick={() => {
                            setLines((ls) => ls.filter((x) => x.id !== l.id));
                            // Already autosaved into the draft? Delete that row too.
                            if (openDraftId) setDraftLineRemovals((r) => [...r, l.id]);
                          }}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!lines.length && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                        Scan a barcode to start this receiving invoice.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>

              <Separator />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">
                  <span className="numeric font-semibold text-foreground">{lines.length}</span>{" "}
                  unique items ·{" "}
                  <span className="numeric font-semibold text-foreground">{totals.units}</span>{" "}
                  units · total cost{" "}
                  <span className="numeric font-semibold text-foreground">
                    {money(totals.cost)}
                  </span>
                  {draftSavedAt && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      · Draft saved {new Date(draftSavedAt).toLocaleTimeString()}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    className="h-11"
                    disabled={savingDraft || !lines.length}
                    onClick={() => void saveDraftNow()}
                  >
                    <Save className="size-4" /> {savingDraft ? "Saving…" : "Save draft"}
                  </Button>
                  {openDraftId && (
                    <Button
                      variant="outline"
                      className="h-11"
                      onClick={() => setDiscardId(openDraftId)}
                    >
                      <Trash2 className="size-4" /> Discard draft
                    </Button>
                  )}
                  <Button className="h-11" disabled={saving} onClick={() => void finalize()}>
                    <PackagePlus className="size-4" />{" "}
                    {saving ? "Saving invoice…" : "Finalize & receive stock"}
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {draftError && <p role="alert" className="text-sm text-destructive">Drafts: {draftError}</p>}
        {drafts.length > 0 && (
          <section className="rounded-lg border border-warning/40 bg-warning/5 p-5">
            <h2 className="text-sm font-semibold">Draft receiving orders</h2>
            <p className="text-xs text-muted-foreground">
              Unfinished entries. Nothing here has touched stock yet — reopen one to keep adding
              items, or discard it.
            </p>
            <div className="mt-3 space-y-2">
              {drafts.map((d) => (
                <div
                  key={d.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-2"
                >
                  <div className="min-w-[200px] flex-1">
                    <p className="truncate text-sm font-medium">
                      {d.invoiceNo || "(no invoice number yet)"} · {d.supplier || "no supplier"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {d.lines.length} items · {units(d)} units · {money(d.totalCost)} · saved{" "}
                      {new Date(d.entryDate).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={openDraftId === d.id ? "secondary" : "default"}
                    className="h-9"
                    disabled={openDraftId === d.id}
                    onClick={() => resumeDraft(d)}
                  >
                    {openDraftId === d.id ? "Open" : "Resume"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-9"
                    onClick={() => setDiscardId(d.id)}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </section>
        )}

        {pending.length > 0 && (
          <section className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-5">
            <div>
              <h2 className="text-sm font-semibold">Put-away from {hub.name}</h2>
              <p className="text-xs text-muted-foreground">
                These units are booked into the hub. Send each line on to the shelf, floor or
                sub-warehouse that will actually hold it.
              </p>
            </div>
            <div className="space-y-2">
              {pending.map((row) => (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-2"
                >
                  <div className="min-w-[180px] flex-1">
                    <p className="truncate text-sm font-medium">{row.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      Invoice {row.invoiceNo} · {row.qty} units
                    </p>
                  </div>
                  <div className="w-56">
                    <ThemedSelect
                      value={row.targetId}
                      onChange={(v: string) =>
                        setPending((q) =>
                          q.map((r) => (r.id === row.id ? { ...r, targetId: v } : r)),
                        )
                      }
                      options={putAwayTargets.map((s) => ({
                        value: s.id,
                        label: locationPath(allStores, s.id),
                      }))}
                    />
                  </div>
                  <Button size="sm" className="h-9" onClick={() => movePutAway(row)}>
                    Move
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-9"
                    onClick={() => setPending((q) => q.filter((r) => r.id !== row.id))}
                  >
                    Keep at hub
                  </Button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between px-5 py-3">
            <h2 className="text-sm font-semibold">Receiving records</h2>
            <div className="flex items-center gap-3">
              <div className="w-40">
                <ThemedSelect
                  value={statusFilter}
                  onChange={(v) => setStatusFilter(v as typeof statusFilter)}
                  options={[
                    { value: "all", label: "All statuses" },
                    { value: "draft", label: "Drafts" },
                    { value: "posted", label: "Received" },
                    { value: "cancelled", label: "Discarded" },
                  ]}
                  ariaLabel="Status filter"
                />
              </div>
              {historyError && (
                <span className="text-xs text-warning-foreground">
                  Offline — showing what this terminal could read
                </span>
              )}
              {isAdmin && (
                <div className="flex rounded-md border border-border p-0.5">
                  <Button
                    size="sm"
                    variant={masterView ? "ghost" : "secondary"}
                    className="h-7 px-3 text-xs"
                    onClick={() => setMasterView(false)}
                  >
                    Current branch
                  </Button>
                  <Button
                    size="sm"
                    variant={masterView ? "secondary" : "ghost"}
                    className="h-7 px-3 text-xs"
                    onClick={() => setMasterView(true)}
                  >
                    All branches
                  </Button>
                </div>
              )}
            </div>
          </div>
          <Separator />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Invoice no.</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Invoice date</TableHead>
                <TableHead>Entry date</TableHead>
                <TableHead className="text-right">Unique items</TableHead>
                <TableHead className="text-right">Total units</TableHead>
                <TableHead className="text-right">Total cost</TableHead>
                <TableHead>Operator</TableHead>
                <TableHead className="text-right">Branch</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {historyPagination.pageItems.map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="numeric font-medium">{h.reference ?? "—"}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        h.status === "posted"
                          ? "secondary"
                          : h.status === "draft"
                            ? "outline"
                            : "destructive"
                      }
                    >
                      {h.status === "posted"
                        ? "Received"
                        : h.status === "draft"
                          ? "Draft"
                          : "Discarded"}
                    </Badge>
                  </TableCell>
                  <TableCell className="numeric">{h.invoiceNo || "—"}</TableCell>
                  <TableCell>{h.supplier}</TableCell>
                  <TableCell className="numeric text-muted-foreground">
                    {h.invoiceDate ?? "—"}
                  </TableCell>
                  <TableCell className="numeric text-muted-foreground">
                    {new Date(h.entryDate).toLocaleString()}
                  </TableCell>
                  <TableCell className="numeric text-right">{h.lines.length}</TableCell>
                  <TableCell className="numeric text-right">{units(h)}</TableCell>
                  <TableCell className="numeric text-right">{money(h.totalCost)}</TableCell>
                  <TableCell>{h.operator}</TableCell>
                  <TableCell className="numeric text-right text-muted-foreground">
                    {h.storeCode ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setViewing(h)}>
                        View
                      </Button>
                      {h.status === "draft" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={otherBranch(h)}
                          onClick={() => resumeDraft(h)}
                        >
                          <Pencil className="size-3.5" /> Resume
                        </Button>
                      ) : h.status === "posted" && isAdmin ? (
                        h.pendingEditRequestId ? (
                          !!meId && (h.pendingEditBy ?? "").toLowerCase() === meId.toLowerCase() ? (
                            <>
                              <Button
                                size="sm"
                                disabled={busyRow === h.id}
                                onClick={() => void continueEdit(h)}
                              >
                                Continue edit
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busyRow === h.id}
                                onClick={() => void withdrawEdit(h)}
                              >
                                Withdraw
                              </Button>
                            </>
                          ) : (
                            <Badge variant="outline" className="border-primary/40 text-primary">
                              <Lock className="mr-1 size-3" /> Pending edit
                              {h.pendingEditBy ? ` · ${h.pendingEditBy}` : ""}
                            </Badge>
                          )
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={otherBranch(h) || busyRow === h.id}
                            title={
                              otherBranch(h)
                                ? "This entry belongs to another branch"
                                : canEditPosted()
                                  ? undefined
                                  : "Editing a received entry needs approval"
                            }
                            onClick={() => void editReceived(h)}
                          >
                            {canEditPosted() ? (
                              <Pencil className="size-3.5" />
                            ) : (
                              <Lock className="size-3.5" />
                            )}{" "}
                            Edit
                          </Button>
                        )
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!visibleHistory.length && (
                <TableRow>
                  <TableCell colSpan={12} className="py-10 text-center text-muted-foreground">
                    No receiving records yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <TablePagination
            page={historyPagination.page}
            pageCount={historyPagination.pageCount}
            pageSize={historyPagination.pageSize}
            total={historyPagination.total}
            from={historyPagination.from}
            to={historyPagination.to}
            label="receiving records"
            onPage={historyPagination.setPage}
            onPageSize={historyPagination.setPageSize}
          />
        </section>
      </div>

      <ReceivingRecordView record={viewing} onClose={() => setViewing(null)} />

      <Dialog
        open={!!editing}
        onOpenChange={(o) => {
          if (!o) {
            setEditing(null);
            setRemovedLineIds([]);
          }
        }}
      >
        <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Correct receiving invoice</DialogTitle>
            <DialogDescription>
              Changing a quantity moves stock by the difference only — nothing is deleted and
              re-added, so the history stays intact.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <Field label="Invoice number">
                  <Input
                    className="numeric"
                    value={editing.invoiceNo}
                    onChange={(e) => setEditing({ ...editing, invoiceNo: e.target.value })}
                  />
                </Field>
                <Field label="Supplier">
                  <Input
                    value={editing.supplier}
                    onChange={(e) => setEditing({ ...editing, supplier: e.target.value })}
                  />
                </Field>
                <Field label="Invoice date">
                  <Input
                    type="date"
                    className="numeric"
                    value={editing.invoiceDate ?? ""}
                    onChange={(e) => setEditing({ ...editing, invoiceDate: e.target.value })}
                  />
                </Field>
                <Field label="Entry date & time">
                  <Input
                    type="datetime-local"
                    className="numeric"
                    value={localDateTime(editing.entryDate)}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        entryDate: new Date(e.target.value).toISOString(),
                      })
                    }
                  />
                </Field>
              </div>

              {!mayEditLines && (
                <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning-foreground">
                  Only a manager or admin can change the lines of an invoice that has already been
                  received.
                </p>
              )}

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item number / SKU</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="w-28 text-right">Cost</TableHead>
                    <TableHead className="w-28 text-right">Selling</TableHead>
                    <TableHead className="w-24 text-right">Qty</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {editing.lines.map((l, i) => (
                    <TableRow key={l.id}>
                      <TableCell>
                        <Input
                          className="numeric h-9"
                          disabled={!mayEditLines}
                          value={l.sku}
                          onChange={(e) => patchEditLine(i, { sku: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-9"
                          disabled={!mayEditLines}
                          value={l.name}
                          onChange={(e) => patchEditLine(i, { name: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="numeric h-9 text-right"
                          disabled={!mayEditLines}
                          value={l.cost}
                          onChange={(e) => patchEditLine(i, { cost: Number(e.target.value) || 0 })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="numeric h-9 text-right"
                          disabled={!mayEditLines}
                          value={l.price}
                          onChange={(e) => patchEditLine(i, { price: Number(e.target.value) || 0 })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="numeric h-9 text-right"
                          disabled={!mayEditLines}
                          value={l.qty}
                          onChange={(e) =>
                            patchEditLine(i, { qty: Math.max(0, Number(e.target.value) || 0) })
                          }
                        />
                      </TableCell>
                      <TableCell className="numeric text-right font-medium">
                        {money(l.cost * l.qty)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Remove line"
                          disabled={!mayEditLines}
                          onClick={() => {
                            setRemovedLineIds((ids) => [...ids, l.id]);
                            setEditing({
                              ...editing,
                              lines: editing.lines.filter((x) => x.id !== l.id),
                            });
                          }}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditing(null);
                setRemovedLineIds([]);
              }}
            >
              Cancel
            </Button>
            <Button disabled={savingEdit} onClick={() => void saveEdit()}>
              {savingEdit ? "Saving…" : "Save corrections"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              <span className="flex items-center gap-2">
                <FilePlus2 className="size-4" /> Add new item to inventory
              </span>
            </DialogTitle>
            <DialogDescription>
              Barcode {draft?.barcode} is not in the catalog. Saving creates the product and adds it
              to this invoice in one step.
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="grid gap-3">
              <Field label="Barcode / SKU">
                <Input
                  className="numeric"
                  value={draft.barcode}
                  onChange={(e) =>
                    setDraft({ ...draft, barcode: e.target.value, sku: e.target.value })
                  }
                />
              </Field>
              <Field label="Item name *">
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <Field label="Category">
                <ThemedSelect
                  value={draft.category || PO_NONE}
                  ariaLabel="Category"
                  placeholder="Choose a category"
                  onChange={(v) => setDraft({ ...draft, category: v === PO_NONE ? "" : v })}
                  options={poOptions(
                    topCategories(selectableCategories(catalogLists)).map((c) => c.name),
                    draft.category,
                  )}
                />
              </Field>
              <Field label="Group">
                <ThemedSelect
                  value={draft.group || PO_NONE}
                  ariaLabel="Group"
                  placeholder="Choose a group"
                  onChange={(v) => setDraft({ ...draft, group: v === PO_NONE ? "" : v })}
                  options={poOptions(
                    groupList(selectableCategories(catalogLists)).map((c) => c.name),
                    draft.group,
                  )}
                />
              </Field>
              <Field label="Sub-category">
                <ThemedSelect
                  value={draft.subCategory || PO_NONE}
                  ariaLabel="Sub-category"
                  placeholder="Choose a sub-category"
                  onChange={(v) => setDraft({ ...draft, subCategory: v === PO_NONE ? "" : v })}
                  options={poOptions(
                    subCategoryList(selectableCategories(catalogLists)).map((c) => c.name),
                    draft.subCategory,
                  )}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Cost price">
                  <Input
                    className="numeric"
                    value={draft.cost}
                    onChange={(e) => setDraft({ ...draft, cost: Number(e.target.value) || 0 })}
                  />
                </Field>
                <Field label="Selling price *">
                  <Input
                    className="numeric"
                    value={draft.price}
                    onChange={(e) => setDraft({ ...draft, price: Number(e.target.value) || 0 })}
                  />
                </Field>
                <Field label="Initial quantity received">
                  <Input
                    className="numeric"
                    value={draftQty}
                    onChange={(e) => setDraftQty(e.target.value)}
                  />
                </Field>
                <Field label="Reorder level">
                  <Input
                    className="numeric"
                    value={draft.reorderLevel}
                    onChange={(e) =>
                      setDraft({ ...draft, reorderLevel: Number(e.target.value) || 0 })
                    }
                  />
                </Field>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button onClick={saveDraft}>Save &amp; add to invoice</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!discardId} onOpenChange={(o) => !o && setDiscardId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Discard this draft?</DialogTitle>
            <DialogDescription>
              The entry is removed from your drafts and kept only for audit. No stock is affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscardId(null)}>
              Keep draft
            </Button>
            <Button variant="destructive" onClick={() => discardId && void discardDraft(discardId)}>
              Discard draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
