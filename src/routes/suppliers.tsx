import { notifyError } from "@/lib/notify";
import { TablePagination, usePagination } from "@/platforms/web/components/pos/TablePagination";
import { subscribeDataChange } from "@/lib/sync-engine";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2, Truck } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
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
import { useAuth } from "@/lib/pos-auth";
import {
  cachedSuppliers,
  deleteSupplier,
  loadSuppliers,
  newSupplier,
  saveSupplier,
  type Supplier,
} from "@/lib/suppliers";

export const Route = createFileRoute("/suppliers")({
  head: () => ({
    meta: [
      { title: "Suppliers — Retail" },
      {
        name: "description",
        content:
          "Keep every supplier's contact, tax number and terms in one central directory used by purchasing and goods receiving.",
      },
      { property: "og:title", content: "Suppliers — Retail" },
      {
        property: "og:description",
        content: "Central supplier directory for purchasing and receiving.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Suppliers,
});

function Suppliers() {
  const { can, isAdmin } = useAuth();
  const allowed = isAdmin || can("can_receive_purchase_order");
  const [list, setList] = useState<Supplier[]>(cachedSuppliers());
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Supplier | null>(null);

  useEffect(() => {
    let active = true;
    const reload = () => { void loadSuppliers().then(list => { if (active) setList(list); }).catch(cause => { if (active) notifyError(cause, "Loading suppliers"); }); };
    reload();
    const off = subscribeDataChange(change => { if (change.table === "suppliers") reload(); });
    return () => { active = false; off(); };
  }, []);

  const rows = useMemo(
    () =>
      list.filter((s) =>
        `${s.name} ${s.contactName} ${s.phone} ${s.email}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [list, query],
  );

  const pager = usePagination(rows);

  async function commit() {
    if (!draft) return;
    if (!draft.name.trim()) return toast.error("Supplier name is required");
    try {
      await saveSupplier({ ...draft, name: draft.name.trim() });
      setList((l) =>
        [...l.filter((x) => x.id !== draft.id), draft].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setDraft(null);
      toast.success("Supplier saved");
    } catch (cause) {
      notifyError(cause, "Saving supplier");
    }
  }

  if (!allowed)
    return (
      <AppShell>
        <div className="p-6 text-sm text-muted-foreground">
          You do not have permission to manage suppliers.
        </div>
      </AppShell>
    );

  return (
    <AppShell>
      <div className="space-y-5 p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Suppliers</h1>
            <p className="text-sm text-muted-foreground">
              One central directory — purchasing and goods receiving pick from this list.
            </p>
          </div>
          <Button onClick={() => setDraft(newSupplier())}>
            <Plus className="size-4" /> Add supplier
          </Button>
        </header>

        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search suppliers"
          className="max-w-sm"
        />

        <div className="overflow-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Tax no.</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pager.pageItems.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      <Truck className="size-4 text-muted-foreground" />
                      {s.name}
                      {!s.active && <Badge variant="outline">Inactive</Badge>}
                    </span>
                  </TableCell>
                  <TableCell>{s.contactName}</TableCell>
                  <TableCell className="numeric">{s.phone}</TableCell>
                  <TableCell>{s.email}</TableCell>
                  <TableCell className="numeric">{s.taxNumber}</TableCell>
                  <TableCell>
                    <Switch
                      aria-label={`${s.name} active`}
                      checked={s.active}
                      onCheckedChange={async (v) => {
                        const next = { ...s, active: v };
                        try {
                          await saveSupplier(next);
                          setList((l) => l.map((x) => (x.id === s.id ? next : x)));
                          toast.success(`${s.name} ${v ? "switched on" : "switched off"}`);
                        } catch {
                          setList(await loadSuppliers());
                          toast.error("Supplier could not be updated");
                        }
                      }}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${s.name}`}
                      onClick={() => setDraft(s)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${s.name}`}
                      onClick={async () => {
                        try {
                          await deleteSupplier(s.id);
                          setList((l) => l.filter((x) => x.id !== s.id));
                          toast.success("Supplier removed");
                        } catch {
                          setList(await loadSuppliers());
                          toast.error("Supplier could not be removed");
                        }
                      }}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!rows.length && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No suppliers yet — add your first one.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <TablePagination {...pager} onPage={pager.setPage} onPageSize={pager.setPageSize} label="suppliers" />
        </div>
      </div>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft?.name ? "Edit supplier" : "New supplier"}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Supplier name *">
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <Field label="Contact person">
                <Input
                  value={draft.contactName ?? ""}
                  onChange={(e) => setDraft({ ...draft, contactName: e.target.value })}
                />
              </Field>
              <Field label="Phone">
                <Input
                  className="numeric"
                  value={draft.phone ?? ""}
                  onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                />
              </Field>
              <Field label="Email">
                <Input
                  type="email"
                  value={draft.email ?? ""}
                  onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                />
              </Field>
              <Field label="Tax number">
                <Input
                  className="numeric"
                  value={draft.taxNumber ?? ""}
                  onChange={(e) => setDraft({ ...draft, taxNumber: e.target.value })}
                />
              </Field>
              <Field label="Address">
                <Input
                  value={draft.address ?? ""}
                  onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                />
              </Field>
              <Field label="Notes">
                <Input
                  value={draft.notes ?? ""}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                />
              </Field>
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <Label className="text-xs">Active</Label>
                <Switch
                  checked={draft.active}
                  onCheckedChange={(v) => setDraft({ ...draft, active: v })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button onClick={commit}>Save supplier</Button>
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
