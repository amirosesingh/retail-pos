import { formatDateTime as posDisplayDateTime } from "@/lib/time-zone";
/**
 * Item activity: when the record was created, every stock movement recorded
 * against it, and the transfer lines it appeared on. Read-only history.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { dbRouter, type ReadSource } from "@/core/api/db-router";
import { OfflineDataNotice } from "@/platforms/web/components/pos/OfflineDataNotice";
import { money } from "@/lib/pos-store";
import type { Product } from "@/core/types/pos-types";

type Movement = {
  id: string;
  at: string;
  kind: string;
  detail: string;
  delta: number;
  impact: number;
  by: string;
};

type LooseRow = Record<string, unknown>;
const text = (v: unknown) => (v == null ? "" : String(v));

/** Plain wording for the movement kinds written across the app. */
const MOVEMENT_LABELS: Record<string, string> = {
  sale: "Sold",
  return: "Returned",
  receive: "Goods received",
  transfer_out: "Transferred out",
  transfer_in: "Transferred in",
};


export function ItemActivityDrawer({
  product,
  onClose,
}: {
  product: Product | null;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [source, setSource] = useState<ReadSource>("cloud");

  useEffect(() => {
    if (!product) return;
    let live = true;
    setLoading(true);
    setRows([]);
    void (async () => {
      // Every read goes through the router: live when the line is up, this
      // terminal's copy when it is not, so history still opens offline.
      const ask = async (table: string, options: Parameters<typeof dbRouter.queryWithSource>[1]) => {
        try {
          return await dbRouter.queryWithSource(table, options);
        } catch {
          return { rows: [] as LooseRow[], source: "cloud" as ReadSource };
        }
      };
      const [adjustments, transfers, meta, merges, movements] = await Promise.all([
        ask("stock_adjustments", {
          columns: "id,created_at,reason,note,delta,cost_impact,staff_name,store_id",
          match: { product_id: product.id },
          orderBy: { column: "created_at", ascending: false },
          limit: 100,
        }),
        ask("stock_transfer_items", {
          columns: "id,created_at,quantity,quantity_received,transfer_id",
          match: { product_id: product.id },
          orderBy: { column: "created_at", ascending: false },
          limit: 50,
        }),
        ask("products", { columns: "id,created_at,updated_at", match: { id: product.id }, limit: 1 }),
        ask("audit_logs", {
          columns: "id,created_at,user_name,details,action_name",
          match: { action_name: "Products merged" },
          orderBy: { column: "created_at", ascending: false },
          limit: 100,
        }),
        // Sales, goods received and transfers all write here, so this is the
        // one list that shows stock arriving as well as leaving.
        ask("item_activity_logs", {
          columns:
            "id,created_at,activity_type,reference,quantity_delta,stock_before,stock_after,unit_cost,staff_name,note,store_id",
          match: { product_id: product.id },
          orderBy: { column: "created_at", ascending: false },
          limit: 200,
        }),
      ]);

      if (!live) return;
      setSource(
        [adjustments, transfers, meta, merges, movements].some((result) => result.source === "local")
          ? "local"
          : "cloud",
      );
      const list: Movement[] = [
        ...(movements.rows as LooseRow[]).map((r) => ({
          id: `mov-${r.id}`,
          at: text(r["created_at"]),
          kind: MOVEMENT_LABELS[text(r["activity_type"])] ?? text(r["activity_type"]),
          detail: [
            r["reference"] ? text(r["reference"]) : "",
            r["store_id"] ? text(r["store_id"]) : "",
            r["stock_after"] != null ? `stock now ${Number(r["stock_after"])}` : "",
            r["note"] ? text(r["note"]) : "",
          ]
            .filter(Boolean)
            .join(" · "),
          delta: Number(r["quantity_delta"] ?? 0),
          impact: 0,
          by: text(r["staff_name"]) || "—",
        })),
        ...(adjustments.rows as LooseRow[]).map((r) => ({

          id: `adj-${r.id}`,
          at: text(r["created_at"]),
          kind: "Stock adjustment",
          detail: `${text(r["reason"]).replace(/_/g, " ")}${r["note"] ? ` — ${text(r["note"])}` : ""}${
            r["store_id"] ? ` · ${text(r["store_id"])}` : ""
          }`,
          delta: Number(r["delta"] ?? 0),
          impact: Number(r["cost_impact"] ?? 0),
          by: text(r["staff_name"]) || "—",
        })),
        ...(transfers.rows as LooseRow[]).map((r) => ({
          id: `trf-${r.id}`,
          at: text(r["created_at"]),
          kind: "Transfer line",
          detail: `Transfer ${text(r["transfer_id"]).slice(0, 8)} · received ${Number(r["quantity_received"] ?? 0)}`,
          delta: Number(r["quantity"] ?? 0),
          impact: 0,
          by: "—",
        })),
        ...(merges.rows as LooseRow[])
          .filter((r) => {
            const d = (r["details"] ?? {}) as {
              masterId?: string;
              merged?: { id?: string }[];
            };
            return (
              d.masterId === product.id || (d.merged ?? []).some((m) => m?.id === product.id)
            );
          })
          .map((r) => {
            const d = (r["details"] ?? {}) as {
              masterId?: string;
              merged?: { name?: string; barcode?: string }[];
              aliasBarcodes?: string[];
            };
            return {
              id: `mrg-${r.id}`,
              at: text(r["created_at"]),
              kind: "Products merged",
              detail:
                d.masterId === product.id
                  ? `Folded in ${(d.merged ?? []).map((m) => m?.name).filter(Boolean).join(", ") || "—"} · barcodes ${(d.aliasBarcodes ?? []).join(", ") || "—"}`
                  : "This record was folded into another product",
              delta: 0,
              impact: 0,
              by: text(r["user_name"]) || "—",
            };
          }),
      ].sort((a, b) => b.at.localeCompare(a.at));
      setRows(list);
      setCreated(text((meta.rows as LooseRow[])[0]?.["created_at"]) || null);
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [product]);

  return (
    <Sheet open={!!product} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Activity · {product?.name}</SheetTitle>
        </SheetHeader>
        {product && (
          <div className="mt-4 space-y-4 text-sm">
            <OfflineDataNotice source={source} what="history" />
            <div className="rounded-lg border border-border p-3">
              <p className="numeric text-xs text-muted-foreground">
                {product.sku} · {product.barcode}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Created {created ? posDisplayDateTime(new Date(created)) : "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {product.category}
                {product.subCategory ? ` › ${product.subCategory}` : ""}
              </p>
            </div>

            {loading ? (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading history…
              </p>
            ) : rows.length ? (
              <ul className="space-y-2">
                {rows.map((r) => (
                  <li key={r.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{r.kind}</span>
                      <Badge
                        variant="outline"
                        className={`numeric ${
                          r.delta > 0
                            ? "border-success/40 text-success"
                            : r.delta < 0
                              ? "border-destructive/40 text-destructive"
                              : "text-muted-foreground"
                        }`}
                      >
                        {r.delta > 0 ? `+${r.delta}` : r.delta}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{r.detail}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {posDisplayDateTime(new Date(r.at))} · {r.by}
                      {r.impact ? ` · ${money(r.impact)}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">No movements recorded for this item yet.</p>
            )}
            <p className="text-[11px] text-muted-foreground">
              Goods received and branch transfers appear here from this release onwards; stock
              taken in before that shows only as sales and adjustments.
            </p>

          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
