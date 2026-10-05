import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { supabase } from "@/lib/supabase";
import { useL } from "@/lib/i18n";

export function VendorPicker({ value, label, onChange }: { value: string; label: string; onChange: (id: string) => void }) {
  const L = useL();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDq(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);
  const res = useQuery({
    queryKey: ["vendor-pick", dq],
    enabled: open,
    queryFn: async () => {
      let req = supabase.from("vendors").select("vendor_id,name_en,village_canonical").order("name_en").limit(30);
      if (dq) req = req.ilike("name_en", `%${dq}%`);
      const { data, error } = await req;
      if (error) throw error;
      return (data ?? []) as { vendor_id: string; name_en: string | null; village_canonical: string | null }[];
    },
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="hairline" size="sm" className="max-w-56 justify-between" aria-label={L("Pick a vendor", "اختر محل")}>
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <Command shouldFilter={false}>
          <CommandInput placeholder={L("Search vendors…", "فتّش عن محل…")} value={q} onValueChange={setQ} />
          <CommandList>
            <CommandEmpty>{res.isLoading ? L("Searching…", "عم فتّش…") : L("No vendors", "ما في محلات")}</CommandEmpty>
            {(res.data ?? []).map((v) => (
              <CommandItem key={v.vendor_id} value={v.vendor_id} onSelect={() => { onChange(v.vendor_id); setOpen(false); }}>
                <span className={v.vendor_id === value ? "text-gold" : ""}>{v.name_en ?? v.vendor_id}</span>
                <span className="ms-auto text-xs text-muted-foreground">{v.village_canonical}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
