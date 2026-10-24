import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./pos-auth";
import { getPosCallerAuth } from "./pos-caller-auth";
import { pageDataScope, PAGE_DATA_CACHE } from "./page-data-cache";
import { effectiveTimeZone } from "./time-zone";
import { loadSponsorshipDailyValues } from "./sponsorship-client";
import { subscribeBackgroundRefresh } from "./background-refresh";
export function useSponsorshipTotals(
  storeIds: string[],
  from: string,
  to: string,
  include: boolean,
) {
  const { user, ready, can } = useAuth();
  const client = useQueryClient();
  const zone = effectiveTimeZone();
  const stores = [...new Set(storeIds.filter(Boolean))].sort();
  const key = JSON.stringify([pageDataScope(user), stores, from, to, zone]);
  const enabled =
    include && ready && Boolean(user) && can("can_view_sales_reports") && stores.length > 0;
  const query = useQuery({
    queryKey: ["sponsorship-totals", key],
    enabled,
    meta: { tables: ["activity_events"] },
    ...PAGE_DATA_CACHE,
    queryFn: async () => {
      const proof = await getPosCallerAuth();
      const rows = (
        await Promise.all(
          stores.map((storeId) =>
            loadSponsorshipDailyValues({ data: { ...proof, storeId, from, to, zone } }),
          ),
        )
      ).flat();
      return rows;
    },
  });
  useEffect(() => {
    if (!enabled) return;
    return subscribeBackgroundRefresh(() => {
      void client.invalidateQueries({ queryKey: ["sponsorship-totals", key], exact: true });
    }, 60_000);
  }, [client, enabled, key]);
  const rows = enabled ? (query.data ?? []) : [];
  return {
    rows,
    total: rows.reduce((sum, row) => sum + Number(row.value), 0),
    loading: enabled && query.isPending,
    error: enabled && query.isError,
  };
}
