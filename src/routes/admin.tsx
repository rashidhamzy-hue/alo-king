import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Crown, LogOut, Phone, X } from "lucide-react";
import { toast } from "sonner";
import { StaffGate, signOut } from "@/components/staff/StaffGate";
import { LangToggle } from "@/components/landing/SiteHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/lib/supabase";
import { errMsg, ageLabel } from "@/lib/format";
import { useL } from "@/lib/i18n";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin · Claims queue — Alo King" },
      { name: "description", content: "Review merchant ownership claims for Alo King." },
      { property: "og:title", content: "Admin — Alo King" },
      { property: "og:description", content: "Alo King team console." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <StaffGate roles={["admin"]} title="Alo King Admin">
      {() => <ClaimsQueue />}
    </StaffGate>
  ),
});

type Claim = {
  id: string;
  vendor_id: string;
  contact_name?: string | null;
  contact_phone?: string | null;
  evidence_note?: string | null;
  status: string;
  created_at: string;
  vendors?: { name_en: string | null; village_canonical: string | null } | null;
};

const TABS = [
  {
    v: "pending",
    en: "Pending",
    ar: "قيد المراجعة",
    match: (s: string) => !["approved", "verified", "rejected"].includes(s),
  },
  {
    v: "approved",
    en: "Approved",
    ar: "مقبول",
    match: (s: string) => s === "approved" || s === "verified",
  },
  { v: "rejected", en: "Rejected", ar: "مرفوض", match: (s: string) => s === "rejected" },
];

function ClaimsQueue() {
  const L = useL();
  const qc = useQueryClient();
  const [tab, setTab] = useState("pending");
  const [confirm, setConfirm] = useState<{ c: Claim; approve: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["claims"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendor_claims")
        .select("*, vendors(name_en,village_canonical)")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Claim[];
    },
  });
  const t = TABS.find((x) => x.v === tab)!;
  const list = (q.data ?? []).filter((c) => t.match(c.status));
  const now = Date.now();

  async function review() {
    if (!confirm) return;
    setBusy(true);
    const { error } = await supabase.rpc("review_claim", {
      p_claim_id: confirm.c.id,
      p_approve: confirm.approve,
    });
    setBusy(false);
    if (error) return toast.error(errMsg(error));
    toast.success(
      confirm.approve ? L("Claim approved", "تم القبول") : L("Claim rejected", "تم الرفض"),
    );
    setConfirm(null);
    void qc.invalidateQueries({ queryKey: ["claims"] });
  }

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <Crown className="size-5 text-gold" />
          <h1 className="text-2xl font-semibold">{L("Claims queue", "طلبات الاستلام")}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/merchant">{L("Merchant", "التاجر")}</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/driver">{L("Driver", "السائق")}</Link>
          </Button>
          <LangToggle />
          <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
            <LogOut />
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-5 py-8">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            {TABS.map((x) => (
              <TabsTrigger key={x.v} value={x.v}>
                {L(x.en, x.ar)} ({(q.data ?? []).filter((c) => x.match(c.status)).length})
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="mt-6 space-y-3">
          {q.isLoading &&
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          {q.isError && <p className="text-destructive">{errMsg(q.error)}</p>}
          {!q.isLoading && list.length === 0 && (
            <p className="py-16 text-center text-muted-foreground">
              {L("Nothing here.", "ما في شي.")}
            </p>
          )}
          {list.map((c) => (
            <div
              key={c.id}
              className="lux-card flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0">
                <p className="text-lg font-semibold">
                  {c.vendors?.name_en ?? c.vendor_id}{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    · {c.vendors?.village_canonical}
                  </span>
                </p>
                <p className="text-sm">
                  {c.contact_name ?? "—"}{" "}
                  {c.contact_phone && (
                    <a
                      className="ms-2 inline-flex items-center gap-1 text-gold"
                      href={`tel:${c.contact_phone}`}
                    >
                      <Phone className="size-3" />
                      {c.contact_phone}
                    </a>
                  )}
                </p>
                {c.evidence_note && (
                  <p className="mt-1 text-sm text-muted-foreground">{c.evidence_note}</p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {c.status} · {ageLabel(c.created_at, now)} {L("ago", "مضت")}
                </p>
              </div>
              {tab === "pending" && (
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="hairline"
                    size="sm"
                    onClick={() => setConfirm({ c, approve: false })}
                  >
                    <X /> {L("Reject", "رفض")}
                  </Button>
                  <Button variant="gold" size="sm" onClick={() => setConfirm({ c, approve: true })}>
                    <Check /> {L("Approve", "قبول")}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </main>
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.approve
                ? L("Approve this claim?", "قبول الطلب؟")
                : L("Reject this claim?", "رفض الطلب؟")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.c.vendors?.name_en} · {confirm?.c.contact_name}.{" "}
              {confirm?.approve
                ? L("They will get owner access to this page.", "رح ياخد صلاحية المالك على الصفحة.")
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{L("Cancel", "إلغاء")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void review();
              }}
            >
              {L("Confirm", "تأكيد")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
