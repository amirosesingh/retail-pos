import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PresetNumber } from "@/components/ui/preset-number";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import { posFetch } from "@/lib/server-origin";

export function StaffIdleTimeout({
  person,
  onClose,
}: {
  person: { key: string; name: string; kind: "account" | "cashier" };
  onClose: () => void;
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
      onClose();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Idle limit — {person.name}</DialogTitle>
          <DialogDescription>
            Applies to new sessions on every platform. Zero uses the branch default. A personal
            value may shorten that default but cannot extend it.
          </DialogDescription>
        </DialogHeader>
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
        <Button disabled={!loaded || busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save idle limit"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
