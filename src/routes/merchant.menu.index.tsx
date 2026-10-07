import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { GripVertical, Plus, Search, Sparkles, Trash2, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ItemEditor } from "@/components/merchant/ItemEditor";
import { useMenuItems, useMerchant, useRefreshMerchant } from "@/components/merchant/context";
import { supabase } from "@/lib/supabase";
import { errMsg, usd } from "@/lib/format";
import { clean, type MenuItem } from "@/lib/vendor";
import { useL } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/merchant/menu/")({
  head: () => ({
    meta: [{ title: "Menu — Alo King Merchant" }, { name: "robots", content: "noindex" }],
  }),
  component: MenuManager,
});

const FILTERS: { k: string; en: string; ar: string; test: (i: MenuItem) => boolean }[] = [
  { k: "photo", en: "Missing photo", ar: "بلا صورة", test: (i) => !clean(i.image_url) },
  { k: "ingr", en: "Missing ingredients", ar: "بلا مكونات", test: (i) => !i.ingredients?.length },
  {
    k: "allergens",
    en: "Allergens unreviewed",
    ar: "حساسية غير مراجعة",
    test: (i) => !i.allergens_reviewed,
  },
  { k: "macros", en: "Macros unverified", ar: "قيم غير مؤكدة", test: (i) => !i.nutrition_verified },
  { k: "hidden", en: "Hidden", ar: "مخفي", test: (i) => i.available === false },
];

function MenuManager() {
  const L = useL();
  const { vendorId } = useMerchant();
  const q = useMenuItems(vendorId);
  const refresh = useRefreshMerchant();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<MenuItem | "new" | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [local, setLocal] = useState<MenuItem[] | null>(null);
  const items = local ?? q.data ?? [];

  const sections = useMemo(() => {
    const m = new Map<string, MenuItem[]>();
    items.forEach((i) => {
      const s = clean(i.section) || "Other";
      m.set(s, [...(m.get(s) ?? []), i]);
    });
    return [...m.entries()].sort(
      (a, b) =>
        Math.min(...a[1].map((x) => x.sort_order ?? 1e9)) -
          Math.min(...b[1].map((x) => x.sort_order ?? 1e9)) || a[0].localeCompare(b[0]),
    );
  }, [items]);
  const sectionNames = sections.map(([s]) => s);
  const f = FILTERS.find((x) => x.k === filter);
  const visible = (i: MenuItem) =>
    (!f || f.test(i)) &&
    (!search || `${i.item_name_en} ${i.item_name_ar}`.toLowerCase().includes(search.toLowerCase()));
  const reload = async () => {
    setLocal(null);
    await refresh(vendorId, ["items", "completeness"]);
  };

  async function toggleAvail(i: MenuItem, v: boolean) {
    setLocal(items.map((x) => (x.item_id === i.item_id ? { ...x, available: v } : x)));
    const { error } = await supabase
      .from("menu_items")
      .update({ available: v })
      .eq("item_id", i.item_id);
    if (error) toast.error(errMsg(error));
    await reload();
  }

  async function drop(section: string, targetId: string) {
    if (!drag || drag === targetId) return;
    const list = sections.find(([s]) => s === section)?.[1] ?? [];
    const from = list.findIndex((x) => x.item_id === drag);
    const to = list.findIndex((x) => x.item_id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    const ordered = sections.flatMap(([s, l]) => (s === section ? next : l));
    const updates = ordered
      .map((x, idx) => ({ id: x.item_id, so: (idx + 1) * 10 }))
      .filter((u, idx) => ordered[idx]!.sort_order !== u.so);
    setLocal(ordered.map((x, idx) => ({ ...x, sort_order: (idx + 1) * 10 })));
    setDrag(null);
    const res = await Promise.all(
      updates.map((u) =>
        supabase.from("menu_items").update({ sort_order: u.so }).eq("item_id", u.id),
      ),
    );
    const err = res.find((r) => r.error)?.error;
    if (err) toast.error(errMsg(err));
    await reload();
  }

  async function bulk(patch: Partial<MenuItem> | "delete") {
    const ids = [...sel];
    if (!ids.length) return;
    if (patch === "delete" && !confirm(L(`Delete ${ids.length} items?`, `حذف ${ids.length} صنف؟`)))
      return;
    const { error } =
      patch === "delete"
        ? await supabase.from("menu_items").delete().in("item_id", ids)
        : await supabase.from("menu_items").update(patch).in("item_id", ids);
    if (error) return toast.error(errMsg(error));
    toast.success(L("Updated", "تم التحديث"));
    setSel(new Set());
    await reload();
  }

  const chips = (i: MenuItem) =>
    [
      [!!clean(i.image_url), L("Photo", "صورة")],
      [!!clean(i.description_en), L("Desc", "وصف")],
      [!!i.ingredients?.length, L("Ingr.", "مكونات")],
      [!!i.allergens_reviewed, L("Allergens", "حساسية")],
      [!!i.nutrition_verified, L("Macros", "قيم")],
    ] as const;

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold">
          {L("Menu", "المنيو")}{" "}
          <span className="text-base text-muted-foreground">{items.length}</span>
        </h1>
        <div className="flex gap-2">
          <Button variant="hairline" asChild>
            <Link to="/merchant/menu/import">
              <Sparkles /> {L("Import menu with AI", "استورد المنيو بالذكاء")}
            </Link>
          </Button>
          <Button variant="gold" onClick={() => setEditing("new")}>
            <Plus /> {L("Add item", "أضف صنف")}
          </Button>
        </div>
      </div>
      <div className="relative">
        <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={L("Search items", "ابحث بالأصناف")}
          className="ps-9"
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((x) => {
          const n = items.filter(x.test).length;
          return (
            <button
              key={x.k}
              aria-pressed={filter === x.k}
              onClick={() => setFilter(filter === x.k ? null : x.k)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                filter === x.k
                  ? "border-gold bg-gold/15 text-gold"
                  : "border-border text-muted-foreground",
              )}
            >
              {L(x.en, x.ar)} · {n}
            </button>
          );
        })}
      </div>
      {sel.size > 0 && (
        <div className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-gold/40 bg-card p-3">
          <span className="text-sm">
            {sel.size} {L("selected", "محدد")}
          </span>
          <Input
            list="bulk-sections"
            placeholder={L("Set section…", "حدد القسم…")}
            className="h-8 w-44"
            onKeyDown={(e) => {
              if (e.key === "Enter") void bulk({ section: (e.target as HTMLInputElement).value });
            }}
          />
          <datalist id="bulk-sections">
            {sectionNames.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <Button size="sm" variant="hairline" onClick={() => bulk({ available: true })}>
            {L("Mark available", "متوفر")}
          </Button>
          <Button size="sm" variant="hairline" onClick={() => bulk({ available: false })}>
            {L("Mark unavailable", "غير متوفر")}
          </Button>
          <Button size="sm" variant="destructive" onClick={() => bulk("delete")}>
            <Trash2 /> {L("Delete", "حذف")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>
            {L("Clear", "مسح")}
          </Button>
        </div>
      )}

      {q.isLoading && <Skeleton className="h-64 rounded-xl" />}
      {!q.isLoading && items.length === 0 && (
        <div className="lux-card p-10 text-center">
          <UtensilsCrossed className="mx-auto size-10 text-gold" />
          <p className="mt-3 text-lg">{L("No items yet", "ما في أصناف بعد")}</p>
          <p className="text-sm text-muted-foreground">
            {L(
              "Snap your paper menu and let the AI type it for you.",
              "صوّر المنيو الورقي وخلّي الذكاء يكتبه.",
            )}
          </p>
          <Button variant="gold" className="mt-4" asChild>
            <Link to="/merchant/menu/import">
              <Sparkles /> {L("Import menu with AI", "استورد المنيو")}
            </Link>
          </Button>
        </div>
      )}

      {sections.map(([s, list]) => {
        const shown = list.filter(visible);
        if (!shown.length) return null;
        return (
          <section key={s}>
            <div className="mb-2 flex items-center gap-2">
              <Checkbox
                checked={shown.every((i) => sel.has(i.item_id))}
                onCheckedChange={(c) => {
                  const n = new Set(sel);
                  shown.forEach((i) => (c ? n.add(i.item_id) : n.delete(i.item_id)));
                  setSel(n);
                }}
                aria-label={`Select ${s}`}
              />
              <h2 className="text-xl font-semibold">{s}</h2>
              <span className="text-sm text-muted-foreground">{shown.length}</span>
            </div>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {shown.map((i) => (
                <li
                  key={i.item_id}
                  draggable={!f && !search}
                  onDragStart={() => setDrag(i.item_id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => drop(s, i.item_id)}
                  className={cn("flex items-center gap-3 p-3", drag === i.item_id && "opacity-50")}
                >
                  <Checkbox
                    checked={sel.has(i.item_id)}
                    onCheckedChange={(c) => {
                      const n = new Set(sel);
                      if (c) n.add(i.item_id);
                      else n.delete(i.item_id);
                      setSel(n);
                    }}
                    aria-label="Select item"
                  />
                  {!f && !search && (
                    <GripVertical
                      className="size-4 shrink-0 cursor-grab text-muted-foreground"
                      aria-hidden
                    />
                  )}
                  <div className="size-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {clean(i.image_url) && (
                      <img src={i.image_url!} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <button className="min-w-0 flex-1 text-start" onClick={() => setEditing(i)}>
                    <p className="truncate font-medium">
                      {clean(i.item_name_en) || clean(i.item_name_ar) || L("Untitled", "بلا اسم")}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {chips(i).map(([ok, label]) => (
                        <span
                          key={label}
                          className={cn(
                            "rounded px-1.5 text-[10px]",
                            ok ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
                          )}
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  </button>
                  <span className="hidden text-sm text-gold sm:inline">
                    {i.price_usd != null ? usd(i.price_usd) : "—"}
                  </span>
                  <Switch
                    checked={i.available !== false}
                    onCheckedChange={(v) => toggleAvail(i, v)}
                    aria-label={L("Available", "متوفر")}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <ItemEditor
        vendorId={vendorId}
        item={editing}
        sections={sectionNames}
        onClose={() => setEditing(null)}
        onSaved={reload}
      />
    </div>
  );
}
