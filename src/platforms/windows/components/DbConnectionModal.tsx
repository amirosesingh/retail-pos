import { useEffect, useState } from "react";
import { DatabaseZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LOCAL_DATABASE_SETTINGS_REQUEST, unreachableMessage } from "@/core/local-db/db-mode";
import { CLEAR_EVENT } from "@/lib/notification-guard";

/**
 * Shown only when a change could not be stored on this terminal *or* in the
 * central database. Nothing was written, so the action is halted until the
 * operator sorts the connection out.
 */
export function DbConnectionModal() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const onFail = (e: Event) => {
      const detail = (e as CustomEvent<{ message?: string }>).detail;
      setMessage(detail?.message ?? unreachableMessage());
    };
    window.addEventListener("pos:db-unreachable", onFail);
    // A database came back: the warning is no longer true, so drop it.
    const onClear = () => setMessage(null);
    window.addEventListener(CLEAR_EVENT, onClear);
    return () => {
      window.removeEventListener("pos:db-unreachable", onFail);
      window.removeEventListener(CLEAR_EVENT, onClear);
    };
  }, []);

  return (
    <Dialog open={message !== null} onOpenChange={(o) => !o && setMessage(null)}>
      <DialogContent className="max-h-[calc(100vh-24px)] w-[calc(100vw-24px)] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DatabaseZap className="size-4 text-destructive" /> Database connection required
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{message}</p>
        <p className="text-xs text-muted-foreground">
          Nothing was saved, so you can safely try again once the connection is back.
        </p>
        <div className="sticky bottom-0 flex gap-2 bg-background pt-2">
          <Button className="flex-1" variant="outline" onClick={() => setMessage(null)}>Close</Button>
          <Button className="flex-1" onClick={() => {
            setMessage(null);
            window.sessionStorage.setItem(LOCAL_DATABASE_SETTINGS_REQUEST, "1");
            window.location.assign("/database-startup");
          }}>Local database settings</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
