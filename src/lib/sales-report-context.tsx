import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type SetStateAction,
  type RefObject,
} from "react";
import type { useReportSales } from "./use-report-sales";

export type SalesReportFilters = {
  from: string;
  to: string;
  storeId: string;
  cashier: string;
  q: string;
  tender: string;
  setFrom: Dispatch<SetStateAction<string>>;
  setTo: Dispatch<SetStateAction<string>>;
  setStoreId: Dispatch<SetStateAction<string>>;
  setCashier: Dispatch<SetStateAction<string>>;
  setQ: Dispatch<SetStateAction<string>>;
  setTender: Dispatch<SetStateAction<string>>;
};
export const SalesReportContext = createContext<
  | (SalesReportFilters & {
      history: ReturnType<typeof useReportSales>;
      exportAction?: RefObject<(() => void) | undefined>;
    })
  | null
>(null);
export const useSalesReportContext = () => useContext(SalesReportContext);
export function useSalesReportFilters(initial: { from: string; to: string }): SalesReportFilters {
  const shared = useSalesReportContext();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [storeId, setStoreId] = useState("all");
  const [cashier, setCashier] = useState("all");
  const [q, setQ] = useState("");
  const [tender, setTender] = useState("all");
  return (
    shared ?? {
      from,
      setFrom,
      to,
      setTo,
      storeId,
      setStoreId,
      cashier,
      setCashier,
      q,
      setQ,
      tender,
      setTender,
    }
  );
}
