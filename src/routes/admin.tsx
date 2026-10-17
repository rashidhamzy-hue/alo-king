import { useState } from "react";
import { PrivateShell } from "@/components/private/PrivateShell";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bike, Check, FileText, LogOut, Phone, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Crown } from "@/design/Crown";
import { StaffGate, signOut } from "@/components/staff/StaffGate";
import { LangToggle } from "@/components/landing/SiteHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Team console — Alo King" },
      { name: "description", content: "Review claims and driver applications for Alo King." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AdminRoute,
});

function AdminRoute() {
  return (
    <PrivateShell>
      <StaffGate roles={["admin"]} title={["Alo King team", "فريق ألو كينغ", "Équipe Alo King"]}>
        {() => <Console />}
      </StaffGate>
    </PrivateShell>
  );
}

// ---- Claims (DECISIONS §18.1): the rebuilt `vendor_claims`, decided with `claim_decide` --------------------------------
type Doc = { kind: string; ref: string; mime?: string; at?: string };
type Claim = {
  id: string;
  vendor_id: string;
  claimant_phone: string;
  claimant_name: string | null;
  claim_case: string;
  status: string;
  contested: boolean;
  home_kitchen: boolean;
  brand_wide: boolean;
  documents: Doc[] | null;
  decision_note: string | null;
  created_at: string;
  vendors?: { name_en: string | null; name_ar: string | null } | null;
};

const CLAIM_COLS =
  "id,vendor_id,claimant_phone,claimant_name,claim_case,status,contested,home_kitchen,brand_wide,documents,decision_note,created_at,vendors(name_en,name_ar)";
const PREFIX = "storage:claim-documents/";

const CLAIM_TABS = [
  {
    v: "review",
    en: "To review",
    ar: "للمراجعة",
    fr: "À examiner",
    match: (s: string) => s === "pending_review",
  },
  {
    v: "waiting",
    en: "Waiting for papers",
    ar: "بانتظار الأوراق",
    fr: "En attente de documents",
    match: (s: string) => ["code_sent", "awaiting_documents", "awaiting_member"].includes(s),
  },
  {
    v: "done",
    en: "Decided",
    ar: "تم البت",
    fr: "Décidées",
    match: (s: string) =>
      ["approved", "rejected", "objection_window", "waitlist", "expired", "cancelled"].includes(s),
  },
] as const;

function Console() {
  const L = useL();
  const [section, setSection] = useState<"claims" | "drivers">("claims");
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b border-tone-line bg-[color-mix(in_srgb,var(--ink)_90%,transparent)] px-4 py-3 backdrop-blur-xl sm:px-6">
        <div className="flex items-center gap-3">
          <Crown className="h-7 w-9 text-gold" />
          <h1 className="text-xl font-extrabold">
            {L("Team console", "لوحة الفريق", "Console de l'équipe")}
          </h1>
        </div>
        <nav
          className="flex flex-wrap items-center gap-1"
          aria-label={L("Sections", "الأقسام", "Sections")}
        >
          {(
            [
              ["claims", ShieldCheck, L("Claims", "طلبات الاستلام", "Revendications")],
              ["drivers", Bike, L("Drivers", "السواقين", "Livreurs")],
            ] as const
          ).map(([k, I, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={section === k}
              onClick={() => setSection(k)}
              className="inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-bold text-tone-mute hover:text-tone-fg aria-pressed:bg-gold aria-pressed:text-ink"
            >
              <I className="size-4" aria-hidden="true" /> {label}
            </button>
          ))}
        </nav>
        {/* Wraps at 360 px in French rather than push the page sideways (§39.15.5). */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/merchant">{L("Merchant view", "واجهة التاجر", "Vue commerçant")}</Link>
          </Button>
          <LangToggle />
          <Button
            variant="ghost"
            size="icon"
            onClick={signOut}
            aria-label={L("Sign out", "خروج", "Se déconnecter")}
          >
            <LogOut />
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {section === "claims" ? <ClaimsQueue /> : <DriverQueue />}
      </main>
    </div>
  );
}

const STATUS: Record<string, [string, string, string]> = {
  pending_review: ["to review", "للمراجعة", "à examiner"],
  code_sent: ["code sent", "الرمز أُرسل", "code envoyé"],
  awaiting_documents: ["waiting for papers", "بانتظار الأوراق", "documents attendus"],
  awaiting_member: [
    "waiting for the other owner",
    "بانتظار المالك الآخر",
    "en attente de l'autre propriétaire",
  ],
  approved: ["approved", "مقبول", "approuvée"],
  rejected: ["rejected", "مرفوض", "refusée"],
  objection_window: ["objection window", "فترة الاعتراض", "délai d'opposition"],
  waitlist: ["waiting list", "لائحة الانتظار", "liste d'attente"],
  expired: ["expired", "منتهي", "expirée"],
  cancelled: ["cancelled", "ملغى", "annulée"],
};
const DOC: Record<string, [string, string, string]> = {
  registration: ["Registration", "السجل التجاري", "Registre"],
  permit: ["Permit", "رخصة", "Autorisation"],
  company: ["Company document", "مستند الشركة", "Document société"],
  sign_photo: ["Sign photo", "صورة اللافتة", "Photo de l'enseigne"],
  id: ["ID", "هوية", "Identité"],
  other: ["Other", "آخر", "Autre"],
};

function Chip({ children, tone }: { children: React.ReactNode; tone?: "gold" | "warn" }) {
  return (
    <span
      className={cn(
        "ak-chip !py-0.5 text-xs",
        tone === "gold" && "ak-chip-gold",
        tone === "warn" && "!border-warning !text-warning",
      )}
    >
      {children}
    </span>
  );
}

function ClaimsQueue() {
  const L = useL();
  const qc = useQueryClient();
  const [tab, setTab] = useState<(typeof CLAIM_TABS)[number]["v"]>("review");
  const [confirm, setConfirm] = useState<{ c: Claim; approve: boolean } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["claims"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendor_claims")
        .select(CLAIM_COLS)
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as unknown as Claim[];
    },
  });
  const current = CLAIM_TABS.find((x) => x.v === tab)!;
  const list = (q.data ?? []).filter((c) => current.match(c.status));
  const now = Date.now();

  async function decide() {
    if (!confirm) return;
    setBusy(true);
    const { error } = await supabase.rpc("claim_decide", {
      p_claim_id: confirm.c.id,
      p_approve: confirm.approve,
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (error) return toast.error(errMsg(error));
    toast.success(
      confirm.approve
        ? L("Claim approved", "تم القبول", "Revendication approuvée")
        : L("Claim rejected", "تم الرفض", "Revendication refusée"),
    );
    setConfirm(null);
    setNote("");
    void qc.invalidateQueries({ queryKey: ["claims"] });
  }

  async function openDoc(d: Doc) {
    if (!d.ref.startsWith(PREFIX))
      return toast.error(
        L(
          "This file is not in storage.",
          "هالملف مش بالتخزين.",
          "Ce fichier n'est pas dans le stockage.",
        ),
      );
    const { data, error } = await supabase.storage
      .from("claim-documents")
      .createSignedUrl(d.ref.slice(PREFIX.length), 300);
    if (error || !data) return toast.error(errMsg(error));
    window.open(data.signedUrl, "_blank", "noopener");
  }

  return (
    <>
      <div role="tablist" className="flex flex-wrap gap-2">
        {CLAIM_TABS.map((x) => (
          <button
            key={x.v}
            role="tab"
            aria-selected={tab === x.v}
            onClick={() => setTab(x.v)}
            className="min-h-10 rounded-full border border-tone-line px-4 text-sm font-bold text-tone-mute aria-selected:border-gold aria-selected:bg-gold aria-selected:text-ink"
          >
            {L(x.en, x.ar, x.fr)} ({(q.data ?? []).filter((c) => x.match(c.status)).length})
          </button>
        ))}
      </div>
      <div className="mt-6 space-y-3">
        {q.isLoading &&
          Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-[1.25rem]" />
          ))}
        {q.isError && <p className="text-destructive">{errMsg(q.error)}</p>}
        {!q.isLoading && !q.isError && list.length === 0 && (
          <p className="py-16 text-center text-tone-mute">
            {L("Nothing here.", "ما في شي.", "Rien ici.")}
          </p>
        )}
        {list.map((c) => (
          <article
            key={c.id}
            className="ak-card flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0 space-y-2">
              <p className="text-lg font-extrabold">
                {c.vendors?.name_en ?? c.vendors?.name_ar ?? c.vendor_id}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Chip tone="gold">
                  {L("Case", "حالة", "Cas")} {c.claim_case}
                </Chip>
                {c.contested && (
                  <Chip tone="warn">{L("Contested", "متنازَع عليه", "Contesté")}</Chip>
                )}
                {c.brand_wide && <Chip>{L("Chain", "سلسلة", "Chaîne")}</Chip>}
                {c.home_kitchen && (
                  <Chip>{L("Home kitchen", "مطبخ منزلي", "Cuisine à domicile")}</Chip>
                )}
                <Chip>{STATUS[c.status] ? L(...STATUS[c.status]!) : c.status}</Chip>
              </div>
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span>{c.claimant_name ?? "—"}</span>
                <a
                  className="inline-flex items-center gap-1 font-semibold text-gold"
                  href={`tel:${c.claimant_phone}`}
                  dir="ltr"
                >
                  <Phone className="size-3.5" aria-hidden="true" />
                  {c.claimant_phone}
                </a>
              </p>
              {(c.documents ?? []).length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {(c.documents ?? []).map((d, i) => (
                    <li key={`${d.ref}-${i}`}>
                      <button
                        type="button"
                        onClick={() => void openDoc(d)}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-tone-line px-3 text-sm font-semibold hover:border-gold"
                      >
                        <FileText className="size-4" aria-hidden="true" />{" "}
                        {DOC[d.kind] ? L(...DOC[d.kind]!) : d.kind}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {c.decision_note && <p className="text-sm text-tone-mute">“{c.decision_note}”</p>}
              <p className="text-xs text-tone-mute">
                {ageLabel(c.created_at, now)} {L("ago", "مضت", "écoulé")}
              </p>
            </div>
            {tab === "review" && (
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="hairline"
                  size="sm"
                  onClick={() => setConfirm({ c, approve: false })}
                >
                  <X /> {L("Reject", "رفض", "Refuser")}
                </Button>
                <Button variant="gold" size="sm" onClick={() => setConfirm({ c, approve: true })}>
                  <Check /> {L("Approve", "قبول", "Approuver")}
                </Button>
              </div>
            )}
          </article>
        ))}
      </div>
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.approve
                ? L("Approve this claim?", "قبول الطلب؟", "Approuver cette revendication ?")
                : L("Reject this claim?", "رفض الطلب؟", "Refuser cette revendication ?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.c.vendors?.name_en ?? confirm?.c.vendors?.name_ar} ·{" "}
              {confirm?.c.claimant_name}.{" "}
              {confirm?.approve
                ? L(
                    "They become the owner of this business.",
                    "رح يصير مالك هالنشاط.",
                    "Cette personne devient propriétaire de l'activité.",
                  )
                : L(
                    "The decision is recorded in the audit log.",
                    "القرار بينسجّل بسجل التدقيق.",
                    "La décision est enregistrée dans le journal d'audit.",
                  )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="ak-label" htmlFor="note">
            {L("Note (optional)", "ملاحظة (اختياري)", "Note (facultatif)")}
          </label>
          <textarea
            id="note"
            className="ak-input"
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>{L("Cancel", "إلغاء", "Annuler")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void decide();
              }}
            >
              {L("Confirm", "تأكيد", "Confirmer")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ---- Driver applications (session 6b: the sign-up page's queue) -------------------------------------------------------
type Application = {
  id: string;
  full_name: string;
  phone_e164: string;
  place: string;
  vehicle: string;
  has_licence: boolean;
  languages: string[];
  availability: string[];
  note: string | null;
  status: "new" | "contacted" | "approved" | "rejected";
  created_at: string;
};
const APP_STATUS: Application["status"][] = ["new", "contacted", "approved", "rejected"];

function DriverQueue() {
  const L = useL();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Application["status"] | "open">("open");
  const q = useQuery({
    queryKey: ["driver-applications"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("driver_applications")
        .select(
          "id,full_name,phone_e164,place,vehicle,has_licence,languages,availability,note,status,created_at",
        )
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as Application[];
    },
  });
  const now = Date.now();
  const list = (q.data ?? []).filter((a) =>
    filter === "open" ? a.status === "new" || a.status === "contacted" : a.status === filter,
  );

  async function setStatus(a: Application, status: Application["status"]) {
    const { error } = await supabase.rpc("driver_application_set_status", {
      p_id: a.id,
      p_status: status,
    });
    if (error) return toast.error(errMsg(error));
    void qc.invalidateQueries({ queryKey: ["driver-applications"] });
  }
  const label = (s: string) =>
    ({
      open: L("Open", "مفتوحة", "Ouvertes"),
      new: L("New", "جديدة", "Nouvelles"),
      contacted: L("Contacted", "تم التواصل", "Contactés"),
      approved: L("Approved", "مقبولة", "Approuvés"),
      rejected: L("Rejected", "مرفوضة", "Refusés"),
    })[s] ?? s;

  return (
    <>
      <div role="tablist" className="flex flex-wrap gap-2">
        {(["open", "approved", "rejected"] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={filter === k}
            onClick={() => setFilter(k)}
            className="min-h-10 rounded-full border border-tone-line px-4 text-sm font-bold text-tone-mute aria-selected:border-gold aria-selected:bg-gold aria-selected:text-ink"
          >
            {label(k)}
          </button>
        ))}
      </div>
      <div className="mt-6 space-y-3">
        {q.isLoading &&
          Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-[1.25rem]" />
          ))}
        {q.isError && <p className="text-destructive">{errMsg(q.error)}</p>}
        {!q.isLoading && !q.isError && list.length === 0 && (
          <p className="py-16 text-center text-tone-mute">
            {L("Nothing here.", "ما في شي.", "Rien ici.")}
          </p>
        )}
        {list.map((a) => (
          <article
            key={a.id}
            className="ak-card flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0 space-y-2">
              <p className="text-lg font-extrabold">
                {a.full_name}{" "}
                <span className="text-sm font-normal text-tone-mute">· {a.place}</span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Chip tone="gold">{a.vehicle}</Chip>
                <Chip>
                  {a.has_licence
                    ? L("Licence", "رخصة", "Permis")
                    : L("No licence", "بلا رخصة", "Sans permis")}
                </Chip>
                {a.languages.map((l) => (
                  <Chip key={l}>{l.toUpperCase()}</Chip>
                ))}
                {a.availability.map((t) => (
                  <Chip key={t}>{t}</Chip>
                ))}
              </div>
              <a
                className="inline-flex items-center gap-1 text-sm font-semibold text-gold"
                href={`https://wa.me/${a.phone_e164.replace(/\D/g, "")}`}
                target="_blank"
                rel="noreferrer"
                dir="ltr"
              >
                <Phone className="size-3.5" aria-hidden="true" /> {a.phone_e164}
              </a>
              {a.note && <p className="text-sm text-tone-mute">“{a.note}”</p>}
              <p className="text-xs text-tone-mute">
                {label(a.status)} · {ageLabel(a.created_at, now)} {L("ago", "مضت", "écoulé")}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {APP_STATUS.filter((s) => s !== a.status && s !== "new").map((s) => (
                <Button
                  key={s}
                  variant={s === "approved" ? "gold" : "hairline"}
                  size="sm"
                  onClick={() => void setStatus(a, s)}
                >
                  {label(s)}
                </Button>
              ))}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
