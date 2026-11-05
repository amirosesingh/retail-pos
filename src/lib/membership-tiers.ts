import { useEffect } from "react";
import { subscribeDataChange } from "./sync-engine";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { routedQuery } from "@/core/api/db-query";
import { registerMembershipTierNames } from "@/core/api/pos-db";
export type MembershipTier = { id: string; name: string; discount: number; multiplier: number };
export function useMembershipTiers() {
  const client = useQueryClient();
  useEffect(() => subscribeDataChange(change => { if (change.table === "membership_tiers") void client.invalidateQueries({queryKey:["membership-tiers"]}); }), [client]);
  return useQuery({ queryKey: ["membership-tiers"], staleTime: 60_000, queryFn: async () => {
    const rows = await routedQuery("membership_tiers", { match: { deleted_at: null }, orderBy: { column: "name" } });
    const tiers: MembershipTier[] = rows.map(row => ({ id: String(row.id), name: String(row.name), discount: Number(row.discount_percentage) || 0, multiplier: Number(row.points_multiplier ?? 1) }));
    registerMembershipTierNames(tiers);
    return tiers;
  } });
}
