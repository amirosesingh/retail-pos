import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import { listMemberVerifications } from "@/lib/verification.functions";

export const Route = createFileRoute("/verifications")({
  head: () => ({
    meta: [
      { title: "Member Verification Log — Retail" },
      {
        name: "description",
        content:
          "Every one-time verification code sent to a member: channel, outcome, attempts and the staff member who sent it.",
      },
      { property: "og:title", content: "Member Verification Log — Retail" },
      {
        property: "og:description",
        content: "Outcome of every member verification code sent from the till.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Verifications,
});

type Row = {
  id: string;
  member_id: string | null;
  phone: string | null;
  email: string | null;
  channel: string;
  status: string;
  attempts: number;
  sent_by: string | null;
  store_id: string | null;
  created_at: string;
  verified_at: string | null;
};

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "Email",
};

function statusTone(status: string) {
  if (status === "verified") return "border-primary/50 text-primary";
  if (status === "failed") return "border-destructive/50 text-destructive";
  return "text-muted-foreground";
}

function Verifications() {
  const [rows, setRows] = useState<Row[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => {
    setBusy(true);
    try {
      const { accessToken, cashierToken } = await getPosCallerAuth();
      const res = await listMemberVerifications({data:{accessToken,cashierToken,limit:300}});
      if (!res.ok) { setError(res.error ?? "Could not read the log"); return; }
      setError(""); setRows(res.items as Row[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the log");
    } finally { setBusy(false); }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const filtered = rows.filter((r) =>
    `${r.phone ?? ""} ${r.email ?? ""} ${r.channel} ${r.status} ${r.sent_by ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  return (
    <AppShell>
      <div className="space-y-5 p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <ShieldCheck className="size-5 text-primary" /> Member verification log
            </h1>
            <p className="text-sm text-muted-foreground">
              Every code sent and what happened to it. The codes themselves are never stored in a
              readable form, so only the outcome is shown here.
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search number, email or staff"
              className="w-64"
            />
            <Button variant="outline" disabled={busy} onClick={() => void refresh()}>
              <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </header>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Sent</th>
                <th className="px-3 py-2">Sent to</th>
                <th className="px-3 py-2">Channel</th>
                <th className="px-3 py-2">Outcome</th>
                <th className="px-3 py-2">Attempts</th>
                <th className="px-3 py-2">By</th>
                <th className="px-3 py-2">Confirmed</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="numeric px-3 py-2">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-3 py-2">{r.phone || r.email || "—"}</td>
                  <td className="px-3 py-2">{CHANNEL_LABEL[r.channel] ?? r.channel}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className={statusTone(r.status)}>
                      {r.status}
                    </Badge>
                  </td>
                  <td className="numeric px-3 py-2">{r.attempts}</td>
                  <td className="px-3 py-2">{r.sent_by ?? "—"}</td>
                  <td className="numeric px-3 py-2">
                    {r.verified_at ? new Date(r.verified_at).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td className="px-3 py-6 text-center text-muted-foreground" colSpan={7}>
                    {busy ? "Loading…" : "No verification codes have been sent yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
