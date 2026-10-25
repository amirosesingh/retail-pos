import { useEffect, useState } from "react";
import { useAuth } from "@/lib/pos-auth";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import { getSponsorshipDirectPolicy, saveSponsorshipDirectPolicy } from "@/lib/sponsorship-client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { notifyError } from "@/lib/notify";
import { requestBackgroundRefresh } from "@/lib/background-refresh";
export function SponsorshipDirectIssuePolicy() {
  const { isAdmin } = useAuth();
  const [loaded, setLoaded] = useState<Awaited<
    ReturnType<typeof getSponsorshipDirectPolicy>
  > | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!isAdmin) return;
    let live = true;
    void (async () => {
      try {
        const value = await getSponsorshipDirectPolicy({ data: await getPosCallerAuth() });
        if (live) {
          setLoaded(value);
          setSelected(value.userIds);
        }
      } catch (cause) {
        if (live)
          setError(cause instanceof Error ? cause.message : "Could not load direct issue access");
      }
    })();
    return () => {
      live = false;
    };
  }, [isAdmin]);
  if (!isAdmin)
    return (
      <p className="rounded-lg border p-3 text-sm">
        Administrators can issue directly. Additional direct issuers are selected here by an
        administrator; everyone else needs approval under this rule.
      </p>
    );
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h3 className="font-medium">Issue sponsorship without approval</h3>
      <p className="text-sm text-muted-foreground">
        Administrators always issue directly. Only the named users selected below may also bypass
        approval. They still need Sponsorship page, Create and Hand over permissions and access to
        the source branch. Everyone else must obtain approval at every value.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!loaded && !error ? (
        <p role="status">Loading direct issuers…</p>
      ) : (
        loaded && (
          <>
            <div className="max-h-56 space-y-2 overflow-y-auto">
              {loaded.people.map((person) => (
                <label key={person.user_id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    aria-label={`Direct sponsorship issue: ${person.full_name}`}
                    checked={selected.includes(person.user_id)}
                    disabled={busy}
                    onCheckedChange={(checked) =>
                      setSelected((current) =>
                        checked
                          ? [...new Set([...current, person.user_id])]
                          : current.filter((id) => id !== person.user_id),
                      )
                    }
                  />
                  {person.full_name}{" "}
                  <span className="text-xs text-muted-foreground">{person.user_id}</span>
                </label>
              ))}
            </div>
            <Button
              type="button"
              disabled={
                busy ||
                JSON.stringify([...selected].sort()) === JSON.stringify([...loaded.userIds].sort())
              }
              onClick={() => {
                setBusy(true);
                void (async () => {
                  try {
                    const saved = await saveSponsorshipDirectPolicy({
                      data: {
                        ...(await getPosCallerAuth()),
                        userIds: selected,
                        version: loaded.version,
                      },
                    });
                    setLoaded({ ...loaded, ...saved });
                    setSelected(saved.userIds);
                    setError("");
                    requestBackgroundRefresh();
                    toast.success("Sponsorship direct issuers saved");
                  } catch (cause) {
                    notifyError(cause, "Could not save sponsorship direct issuers");
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              {busy ? "Saving…" : "Save direct issuers"}
            </Button>
          </>
        )
      )}
    </section>
  );
}
