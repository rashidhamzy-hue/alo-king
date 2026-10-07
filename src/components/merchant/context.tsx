import { createContext, useContext } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { StaffProfile } from "@/components/staff/StaffGate";
import { supabase } from "@/lib/supabase";
import { VENDOR_COLUMNS } from "@/lib/config";
import type { Vendor } from "@/lib/types";
import type { MenuItem, VendorPrivate, VendorProfile } from "@/lib/vendor";

export type ChatMsg = { role: "user" | "assistant"; content: string };

export type MerchantCtxValue = {
  profile: StaffProfile;
  vendorId: string;
  openAssistant: (prompt?: string) => void;
};

export const MerchantCtx = createContext<MerchantCtxValue | null>(null);
export function useMerchant() {
  const c = useContext(MerchantCtx);
  if (!c) throw new Error("useMerchant outside merchant layout");
  return c;
}

export const mk = {
  vendor: (id: string) => ["m-vendor", id] as const,
  profile: (id: string) => ["m-profile", id] as const,
  priv: (id: string) => ["m-private", id] as const,
  items: (id: string) => ["m-items", id] as const,
  completeness: (id: string) => ["m-completeness", id] as const,
};

export function useVendorRow(id: string) {
  return useQuery({
    queryKey: mk.vendor(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendors")
        .select(VENDOR_COLUMNS)
        .eq("vendor_id", id)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as Vendor | null;
    },
  });
}

export function useVendorProfile(id: string) {
  return useQuery({
    queryKey: mk.profile(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendor_profiles")
        .select("*")
        .eq("vendor_id", id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? { vendor_id: id }) as VendorProfile;
    },
  });
}

export function useVendorPrivate(id: string) {
  return useQuery({
    queryKey: mk.priv(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendor_private")
        .select("*")
        .eq("vendor_id", id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? { vendor_id: id }) as VendorPrivate;
    },
  });
}

export function useMenuItems(id: string) {
  return useQuery({
    queryKey: mk.items(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("menu_items")
        .select("*")
        .eq("vendor_id", id)
        .order("sort_order", { ascending: true, nullsFirst: false })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as MenuItem[];
    },
  });
}

export type Completeness = {
  profile_score: number;
  menu_score: number;
  overall: number;
  missing_profile: string[];
  menu: {
    items: number;
    with_description: number;
    with_photo: number;
    with_ingredients: number;
    allergens_reviewed: number;
    macros_verified: number;
    with_prep_time: number;
  };
};

export function useCompleteness(id: string) {
  return useQuery({
    queryKey: mk.completeness(id),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("vendor_completeness", { p_vendor_id: id });
      if (error) throw error;
      return data as Completeness;
    },
  });
}

export function useRefreshMerchant() {
  const qc = useQueryClient();
  return (
    id: string,
    which: ("vendor" | "profile" | "priv" | "items" | "completeness")[] = [
      "profile",
      "priv",
      "items",
      "completeness",
      "vendor",
    ],
  ) => Promise.all(which.map((w) => qc.invalidateQueries({ queryKey: mk[w](id) })));
}

export async function saveProfile(vendorId: string, patch: Partial<VendorProfile>) {
  const { error } = await supabase
    .from("vendor_profiles")
    .upsert({ ...patch, vendor_id: vendorId }, { onConflict: "vendor_id" });
  if (error) throw error;
}
export async function savePrivate(vendorId: string, patch: Partial<VendorPrivate>) {
  const { error } = await supabase
    .from("vendor_private")
    .upsert({ ...patch, vendor_id: vendorId }, { onConflict: "vendor_id" });
  if (error) throw error;
}
export async function updateItem(itemId: string, patch: Partial<MenuItem>) {
  const { error } = await supabase.from("menu_items").update(patch).eq("item_id", itemId);
  if (error) throw error;
}

/** Calls merchant-ai; passes vendor_id (needed for admins, harmless for owners). */
export { invokeFn } from "@/lib/edge";
