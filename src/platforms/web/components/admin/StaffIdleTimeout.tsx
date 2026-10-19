import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PresetNumber } from "@/components/ui/preset-number";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import { posFetch } from "@/lib/server-origin";

export function StaffIdleTimeout({
  person,
}: {
  person: { key: string; name: string; kind: "account" | "cashier" };
}) {
  const [minutes, setMinutes] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useCallback(
    async (value?: number) => {
      const { accessToken } = await getPosCallerAuth();
      const response = await posFetch("/api/public/staff-idle-timeout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken, kind: person.kind, key: person.key, minutes: value }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Timeout request failed");
      return result as { minutes: number };
    },
    [person.key, person.kind],
  );
  useEffect(() => {
    let cancelled = false;
    void request()
      .then((result) => {
        if (!cancelled) {
          setMinutes(result.minutes);
          setLoaded(true);
        }
      })
      .catch((failure) => {
        if (!cancelled) setError((failure as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [request]);
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await request(minutes);
      toast.success("Idle limit saved for this person's new sign-ins");
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-2 rounded-lg border border-border p-3" aria-label="Personal idle limit">
      <p className="text-xs text-muted-foreground">Applies to new sign-ins. Your limit can shorten the branch default.</p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <PresetNumber
          label="Personal idle limit"
          value={minutes}
          onChange={setMinutes}
          min={0}
          max={1440}
          disabled={!loaded || busy}
          options={[0, 1, 5, 10, 15, 30, 60, 120, 240, 480, 1440].map((value) => ({
            value,
            label: value ? `${value} minutes` : "Use branch default",
          }))}
        />
        <Button size="sm" variant="outline" disabled={!loaded || busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save idle limit"}
        </Button>
    </section>
  );
}
