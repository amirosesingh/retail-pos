import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { BadgeCheck, History, Plus, Printer, Search, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { notifyError } from "@/lib/notify";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { money, usePos } from "@/lib/pos-store";
import type { Member } from "@/core/types/pos-types";
import { printMemberStatement } from "@/lib/pos-print";
import { MemberHistoryDialog } from "@/platforms/web/components/pos/MemberHistoryDialog";
import { OtpVerificationModal } from "@/platforms/web/components/pos/OtpVerificationModal";
import { useVerificationGateway } from "@/lib/verification-gateway";

export const Route = createFileRoute("/members")({
  head: () => ({
    meta: [
      { title: "Members — Retail" },
      {
        name: "description",
        content:
          "Central membership register with tiers, loyalty point balances, lifetime spend and printable statements.",
      },
      { property: "og:title", content: "Members — Retail" },
      { property: "og:description", content: "Loyalty tiers, points and member statements." },
    ],
  }),
  component: Members,
});

const blank = (n: number): Member => ({
  id: crypto.randomUUID(),
  code: `MB-${1000 + n + 1}`,
  name: "",
  phone: "",
  email: "",
  tier: "Bronze",
  points: 0,
  totalSpend: 0,
  joinedAt: new Date().toISOString().slice(0, 10),
});

function Members() {
  const { state, upsertMember, removeMember } = usePos();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Member | null>(null);
  const [historyMember, setHistoryMember] = useState<Member | null>(null);
  const [verifyMember, setVerifyMember] = useState<Member | null>(null);
  const gateway = useVerificationGateway();

  const rows = state.members.filter((m) =>
    `${m.name} ${m.code} ${m.phone} ${m.email}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <AppShell>
      <div className="space-y-5 p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Central membership</h1>
            <p className="text-sm text-muted-foreground">
              {state.members.length} members · {state.members.reduce((a, m) => a + m.points, 0)}{" "}
              points outstanding
            </p>
          </div>
          <div className="flex gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search members"
                className="w-56 pl-9"
              />
            </div>
            <Button onClick={() => setDraft(blank(state.members.length))}>
              <Plus className="size-4" /> Enroll member
            </Button>
          </div>
        </header>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((m) => {
            const visits = state.sales.filter((s) => s.memberId === m.id && !s.refunded).length;
            return (
              <article key={m.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <button
                      className="text-base font-semibold hover:text-primary"
                      onClick={() => setDraft(m)}
                    >
                      {m.name}
                    </button>
                    <p className="numeric text-[11px] text-muted-foreground">
                      {m.code} · joined {m.joinedAt}
                    </p>
                    {m.verified && (
                      <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary">
                        <BadgeCheck className="size-3.5" /> Verified
                        {m.verifiedChannel ? ` · ${m.verifiedChannel}` : ""}
                      </span>
                    )}
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      m.tier === "Gold"
                        ? "border-primary/50 text-primary"
                        : m.tier === "Silver"
                          ? "border-accent/50 text-accent"
                          : "text-muted-foreground"
                    }
                  >
                    {m.tier}
                  </Badge>
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <Stat label="Points" value={String(m.points)} />
                  <Stat label="Spend" value={money(m.totalSpend)} />
                  <Stat label="Visits" value={String(visits)} />
                </dl>
                <p className="mt-3 text-xs text-muted-foreground">
                  {m.phone} · {m.email}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setHistoryMember(m)}>
                    <History className="size-4" /> History
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => printMemberStatement(m, state.sales)}
                  >
                    <Printer className="size-4" /> Statement
                  </Button>
                  {gateway?.active && !m.verified && (
                    <Button size="sm" variant="outline" onClick={() => setVerifyMember(m)}>
                      <ShieldCheck className="size-4" /> Verify
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await removeMember(m.id);
                        toast.success("Member removed");
                      } catch (e) {
                        notifyError(e, "Removing the member");
                      }
                    }}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <MemberHistoryDialog
        member={historyMember}
        onOpenChange={(o) => !o && setHistoryMember(null)}
      />

      {verifyMember && (
        <OtpVerificationModal
          open
          onOpenChange={(o) => !o && setVerifyMember(null)}
          member={{
            id: verifyMember.id,
            name: verifyMember.name,
            phone: verifyMember.phone,
            email: verifyMember.email,
          }}
          onVerified={async () => {
            try {
              await upsertMember({ ...verifyMember, verified: true });
              setVerifyMember(null);
            } catch (e) {
              notifyError(e, "Saving member verification");
            }
          }}
        />
      )}

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.name ? "Edit member" : "Enroll member"}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1">
                <Label className="text-xs text-muted-foreground">Full name</Label>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Phone</Label>
                <Input
                  value={draft.phone}
                  onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Email</Label>
                <Input
                  value={draft.email}
                  readOnly
                  aria-readonly="true"
                  placeholder="Managed in the member portal"
                  className="bg-muted/40"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Tier</Label>
                <ThemedSelect
                  ariaLabel="Tier"
                  value={draft.tier}
                  onChange={(v) => setDraft({ ...draft, tier: v as Member["tier"] })}
                  options={[
                    { value: "Bronze", label: "Bronze" },
                    { value: "Silver", label: "Silver" },
                    { value: "Gold", label: "Gold" },
                  ]}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Points</Label>
                <Input
                  className="numeric"
                  value={draft.points}
                  onChange={(e) => setDraft({ ...draft, points: Number(e.target.value) || 0 })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Date of birth</Label>
                <Input
                  type="date"
                  value={draft.birthday ?? ""}
                  readOnly
                  aria-readonly="true"
                  className="bg-muted/40"
                />
              </div>
              <p className="col-span-2 text-xs text-muted-foreground">
                Email and date of birth are verified profile details. Members manage them securely
                through the membership portal.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button
              onClick={async () => {
                if (!draft?.name.trim()) {
                  toast.error("Member name is required");
                  return;
                }
                try {
                  await upsertMember(draft);
                  setDraft(null);
                  toast.success("Member saved");
                } catch (e) {
                  notifyError(e, "Saving the member");
                }
              }}
            >
              Save member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface-2 py-2">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="numeric text-sm font-semibold">{value}</dd>
    </div>
  );
}
