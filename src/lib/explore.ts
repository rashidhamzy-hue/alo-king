import { supabase } from "./supabase";
import type { ExploreRow } from "./vendor";

export type ExploreFilters = {
  q: string;
  category: string | null;
  village: string | null;
  open_now: boolean;
  has_menu: boolean;
  claimed: boolean;
  vegan: boolean;
  gluten_free: boolean;
  keto: boolean;
  sort: "relevance" | "name";
};

export const DEFAULT_FILTERS: ExploreFilters = {
  q: "",
  category: null,
  village: null,
  open_now: false,
  has_menu: false,
  claimed: false,
  vegan: false,
  gluten_free: false,
  keto: false,
  sort: "relevance",
};

export async function exploreVendors(
  f: Partial<ExploreFilters>,
  limit = 24,
  offset = 0,
): Promise<ExploreRow[]> {
  const { data, error } = await supabase.rpc("explore_vendors", {
    p_q: f.q?.trim() || null,
    p_village: f.village ?? null,
    p_category: f.category ?? null,
    p_cuisine: null,
    p_open_now: f.open_now || null,
    p_claimed: f.claimed || null,
    p_has_menu: f.has_menu || null,
    p_vegan: f.vegan || null,
    p_gluten_free: f.gluten_free || null,
    p_keto: f.keto || null,
    p_sort: f.sort ?? "relevance",
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  return (data ?? []) as ExploreRow[];
}
