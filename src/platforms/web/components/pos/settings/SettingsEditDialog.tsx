import { useRef, useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { usePos } from "@/lib/pos-store";

/** Edits use the page draft; closing this editor never publishes settings. */
export function SettingsEditDialog({ title, description, summary, children, initialOpen = false }: { title: string; description?: string; summary?: string; children: ReactNode; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const { settingsScopeLoading } = usePos();
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><button type="button" className="flex min-h-16 w-full min-w-0 items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60" aria-label={`Edit ${title}`}>
      <span className="min-w-0"><span className="block text-sm font-semibold sm:text-base">{title}</span>{summary && <span className="mt-1 block break-words text-sm text-muted-foreground">{summary}</span>}</span>
      <Pencil aria-hidden="true" className="size-4 shrink-0 text-primary" />
    </button></DialogTrigger>
    <DialogContent onOpenAutoFocus={event => { event.preventDefault(); titleRef.current?.focus(); }} className="settings-workspace flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-xl">
      <DialogHeader><DialogTitle ref={titleRef} tabIndex={-1} className="outline-none">{title}</DialogTitle><DialogDescription>{description || "Edit the options below."}</DialogDescription></DialogHeader>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-0.5"><fieldset disabled={settingsScopeLoading} className="settings-form min-w-0 space-y-4 border-0 p-0 disabled:opacity-60">{children}</fieldset></div>
      <DialogFooter className="shrink-0 items-center border-t"><p className="mr-auto text-xs text-muted-foreground">Draft only. Use Save settings on the page to apply.</p><DialogClose asChild><Button type="button" size="sm">Done</Button></DialogClose></DialogFooter>
    </DialogContent>
  </Dialog>;
}
