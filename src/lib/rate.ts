import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

/**
 * The USD to LBP rate in force, from the database (the dated `usd_lbp_rate` table, DECISIONS §1, §6, §13). The staff pages never
 * carry a rate of their own: until it arrives, a pound amount is simply not shown.
 */
export function useRate() {
  return useQuery({
    queryKey: ["usd_lbp_rate"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("usd_lbp_rate");
      if (error) throw error;
      const n = Number(data);
      return Number.isFinite(n) && n > 0 ? n : null;
    },
  });
}

/** Formats a dollar amount in Lebanese pounds at the live rate, or "" while the rate is not known. */
export function useLbp() {
  const rate = useRate().data;
  return (usd: number | null | undefined) =>
    rate ? `${Math.round((Number(usd) || 0) * rate).toLocaleString("en-US")} LBP` : "";
}
