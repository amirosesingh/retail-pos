import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Archive, ArchiveRestore, Layers, Plus, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { SettingsShell } from "@/platforms/web/components/pos/settings/SettingsShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/pos-auth";
import { usePos } from "@/lib/pos-store";
import {
  archiveStoreGroup,
  groupCodeFrom,
  restoreStoreGroup,
  saveStoreGroup,
  useStoreGroups,
  type StoreGroup,
} from "@/lib/store-groups";

export const Route = createFileRoute("/settings/groups")({
  head: () => ({
    meta: [
      { title: "Groups & Clusters — Retail" },
      {
        name: "description",
        content:
          "Create the groups your branches and warehouses belong to, keep them active or archived, and see which locations sit in each one.",
      },
      { property: "og:title", content: "Groups & Clusters — Retail" },
      {
        property: "og:description",
        content: "One list of company groups, used everywhere a branch is assigned.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GroupSettings,
});

function GroupSettings() {
  const { can, isAdmin } = useAuth();
  const { allStores } = usePos();
  const groups = useStoreGroups();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Record<string, string>>({});

  const branchCount = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of allStores) if (s.groupId) counts[s.groupId] = (counts[s.groupId] ?? 0) + 1;
    return counts;
  }, [allStores]);

  const active = groups.filter((g) => !g.archivedAt);
  const archived = groups.filter((g) => g.archivedAt);

  if (!isAdmin && !can("can_manage_locations")) {
    return (
      <SettingsShell>
        <div className="mx-auto w-full max-w-7xl p-6">
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-center">
            <ShieldAlert className="mx-auto size-6 text-destructive" />
            <p className="mt-2 font-semibold">Permission required</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Your role does not allow location and warehouse management.
            </p>
          </div>
        </div>
      </SettingsShell>
    );
  }

  async function run(job: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await job();
      toast.success(ok);
    } catch (e) {
      toast.error((e as Error).message || "Could not save the group");
    } finally {
      setBusy(false);
    }
  }

  function create() {
    const clean = name.trim();
    if (!clean) return toast.error("Give the group a name");
    if (groups.some((g) => g.name.toLowerCase() === clean.toLowerCase()))
      return toast.error("A group with that name already exists");
    const id = clean
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    void run(
      () =>
        saveStoreGroup({
          id: id || crypto.randomUUID(),
          code: groupCodeFrom(clean, groups),
          name: clean,
          isActive: true,
          archivedAt: null,
        }),
      `${clean} created`,
    ).then(() => setName(""));
  }

  function rename(group: StoreGroup) {
    const next = (editing[group.id] ?? group.name).trim();
    if (!next || next === group.name) return setEditing((e) => ({ ...e, [group.id]: "" }));
    void run(() => saveStoreGroup({ ...group, name: next }), "Group renamed");
  }

  return (
    <SettingsShell>
      <div className="mx-auto w-full max-w-7xl space-y-5 p-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Groups &amp; clusters</h1>
          <p className="text-sm text-muted-foreground">
            Branches and warehouses belong to a group. A transfer between two different groups
            always needs approval.
          </p>
        </header>
        <section className="rounded-lg border border-border p-4">
          <Label htmlFor="new-group" className="text-sm font-medium">
            New group
          </Label>
          <div className="mt-2 flex gap-2">
            <Input
              id="new-group"
              value={name}
              placeholder="Apparel Group"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
            <Button onClick={create} disabled={busy}>
              <Plus className="size-4" /> Add
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Groups are never deleted, so past transfers and reports keep their meaning. Archive one
            you no longer use instead.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">In use</h2>
          {active.length === 0 && (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No groups yet. Add the first one above.
            </p>
          )}
          {active.map((g) => (
            <div
              key={g.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
            >
              <Layers className="size-4 shrink-0 text-muted-foreground" />
              <Input
                aria-label={`Name of ${g.name}`}
                className="h-9 w-52"
                value={editing[g.id] ?? g.name}
                onChange={(e) => setEditing((s) => ({ ...s, [g.id]: e.target.value }))}
                onBlur={() => rename(g)}
                onKeyDown={(e) => e.key === "Enter" && rename(g)}
              />
              <Badge variant="secondary">{g.code}</Badge>
              <span className="text-xs text-muted-foreground">
                <span className="numeric">{branchCount[g.id] ?? 0}</span> location
                {(branchCount[g.id] ?? 0) === 1 ? "" : "s"}
              </span>
              <div className="ms-auto flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch
                    checked={g.isActive}
                    disabled={busy}
                    onCheckedChange={(v) =>
                      void run(
                        () => saveStoreGroup({ ...g, isActive: v }),
                        v ? "Group is selectable again" : "Group can no longer be chosen",
                      )
                    }
                    aria-label={`${g.name} selectable`}
                  />
                  Selectable
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || (branchCount[g.id] ?? 0) > 0}
                  title={
                    (branchCount[g.id] ?? 0) > 0
                      ? "Move its locations to another group first"
                      : "Archive this group"
                  }
                  onClick={() => void run(() => archiveStoreGroup(g), `${g.name} archived`)}
                >
                  <Archive className="size-4" /> Archive
                </Button>
              </div>
            </div>
          ))}
        </section>

        {archived.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground">Archived</h2>
            {archived.map((g) => (
              <div
                key={g.id}
                className="flex items-center gap-3 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground"
              >
                <Layers className="size-4" />
                {g.name}
                <Button
                  variant="ghost"
                  size="sm"
                  className="ms-auto"
                  disabled={busy}
                  onClick={() => void run(() => restoreStoreGroup(g), `${g.name} restored`)}
                >
                  <ArchiveRestore className="size-4" /> Restore
                </Button>
              </div>
            ))}
          </section>
        )}
      </div>
    </SettingsShell>
  );
}
