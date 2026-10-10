import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, SkipBack, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const PAGE_SIZES = [10, 25, 50, 100];

/** Client-side pagination that keeps its place while filters change. */
export function usePagination<T>(items: T[], initialSize = 25) {
  const [pageSize, setPageSize] = useState(initialSize);
  const [page, setPage] = useState(1);

  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // Only clamp when the current page falls off the end — never reset to 1 on
  // every filter keystroke.
  useEffect(() => {
    setPage((p) => Math.min(p, pageCount));
  }, [pageCount]);

  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const pageItems = useMemo(
    () => items.slice(start, start + pageSize),
    [items, start, pageSize],
  );

  return {
    page: safePage,
    pageCount,
    pageSize,
    total,
    from: total === 0 ? 0 : start + 1,
    to: Math.min(start + pageSize, total),
    pageItems,
    setPage,
    setPageSize: (n: number) => {
      setPageSize(n);
      setPage(1);
    },
  };
}

type Props = {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  from: number;
  to: number;
  label?: string;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
};

export function TablePagination({
  page,
  pageCount,
  pageSize,
  total,
  from,
  to,
  label = "items",
  onPage,
  onPageSize,
}: Props) {
  const fmt = (n: number) => n.toLocaleString();
  return (
    <div className="flex flex-col items-stretch gap-3 border-t border-border/60 bg-category-2/5 px-3 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Rows per page</span>
        <Select value={String(pageSize)} onValueChange={(v) => onPageSize(Number(v))}>
          <SelectTrigger className="h-8 w-20" aria-label="Items per page">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="numeric text-center text-sm text-muted-foreground">
        Showing {fmt(from)}–{fmt(to)} of {fmt(total)} {label}
      </p>

      <div className="flex items-center justify-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          className="size-9 rounded-lg text-category-1 hover:bg-category-1/10"
          aria-label="First page"
          disabled={page <= 1}
          onClick={() => onPage(1)}
        >
          <SkipBack strokeWidth={1.75} className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-9 rounded-lg text-category-1 hover:bg-category-1/10"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ArrowLeft strokeWidth={1.75} className="size-4" />
        </Button>
        <span className="numeric px-2 text-sm">
          Page {page} of {pageCount}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="size-9 rounded-lg text-category-1 hover:bg-category-1/10"
          aria-label="Next page"
          disabled={page >= pageCount}
          onClick={() => onPage(page + 1)}
        >
          <ArrowRight strokeWidth={1.75} className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-9 rounded-lg text-category-1 hover:bg-category-1/10"
          aria-label="Last page"
          disabled={page >= pageCount}
          onClick={() => onPage(pageCount)}
        >
          <SkipForward strokeWidth={1.75} className="size-4" />
        </Button>
      </div>
    </div>
  );
}
