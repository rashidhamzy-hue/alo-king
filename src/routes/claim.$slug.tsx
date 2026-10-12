import { useEffect, useState } from "react";
import { PrivateShell } from "@/components/private/PrivateShell";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Clock, Crown, LogOut, MessageCircle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { AuthForms, signOut, useSession } from "@/components/staff/StaffGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/lib/supabase";
import { invokeFn, EdgeError } from "@/lib/edge";
import { vendorName, type VendorPage } from "@/lib/vendor";
import { useL } from "@/lib/i18n";

export const Route = createFileRoute("/claim/$slug")({
  head: () => ({
    meta: [
      { title: "Claim your business page — Alo King" },
      {
        name: "description",
        content: "Verify you own this Shouf business to manage its Alo King page, menu and orders.",
      },
      { property: "og:title", content: "Claim your business page — Alo King" },
      {
        property: "og:description",
        content: "Verify ownership on WhatsApp and take control of your page.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ClaimRoute,
});

type Step =
  | { s: "form" }
  | { s: "otp"; claim_id: string; sent_to: string }
  | { s: "pending"; claim_id?: string; note?: string }
  | { s: "verified" };

type ClaimStatus = {
  claim?: { id?: string; vendor_id?: string; status?: string; review_note?: string } | null;
};

function ClaimPage() {
  const { slug } = Route.useParams();
  const L = useL();
  const { session, ready } = useSession();
  const pageQ = useQuery({
    queryKey: ["vendor-page", slug],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_vendor_page", { p_slug: slug });
      if (error) throw error;
      return data as VendorPage | null;
    },
  });
  const v = pageQ.data?.vendor;

  return (
    <div className="min-h-screen bg-hero">
      <SiteHeader />
      <main className="mx-auto max-w-lg px-5 py-12">
        {pageQ.isLoading || !ready ? (
          <Skeleton className="h-80 rounded-xl" />
        ) : !v ? (
          <div className="lux-card p-8 text-center">
            <p>{L("We couldn't find this business.", "ما لقينا هالمحل.")}</p>
            <Button variant="gold" className="mt-4" asChild>
              <Link to="/for-business">{L("Search again", "فتّش من جديد")}</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-6 text-center">
              <Crown className="mx-auto size-8 text-gold" />
              <p className="mt-3 text-xs uppercase tracking-[0.3em] text-gold">
                {L("Claim your page", "استلم صفحتك")}
              </p>
              <h1 className="mt-2 text-4xl font-semibold">{vendorName(v)}</h1>
              <p className="text-muted-foreground">{v.village_canonical}</p>
            </div>
            {pageQ.data?.claimed ? (
              <div className="lux-card p-8 text-center">
                <BadgeCheck className="mx-auto size-10 text-gold" />
                <p className="mt-3">
                  {L("This page is already verified by its owner.", "هالصفحة موثّقة من مالكها.")}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {L(
                    "If you think this is a mistake, contact Alo King.",
                    "إذا في غلط، احكي مع ألو كينغ.",
                  )}
                </p>
              </div>
            ) : !session ? (
              <div className="space-y-3">
                <p className="text-center text-sm text-muted-foreground">
                  {L(
                    "Step 1 of 3 · Sign in or create an account",
                    "الخطوة ١ من ٣ · سجّل دخول أو أنشئ حساب",
                  )}
                </p>
                <AuthForms inline title={L("Your account", "حسابك")} />
              </div>
            ) : (
              <ClaimFlow vendorId={v.vendor_id} email={session.user.email ?? ""} />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function ClaimFlow({ vendorId, email }: { vendorId: string; email: string }) {
  const L = useL();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("owner");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [code, setCode] = useState("");
  const [attempts, setAttempts] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const checkStatus = async (quiet = false) => {
    try {
      const r = await invokeFn<ClaimStatus>("claim-vendor", { action: "status" });
      const c = r.claim;
      if (c && (!c.vendor_id || c.vendor_id === vendorId)) {
        if (c.status === "verified" || c.status === "approved") return setStep({ s: "verified" });
        if (c.status === "pending_review" || c.status === "pending")
          return setStep({ s: "pending", claim_id: c.id, note: c.review_note });
        if (c.status === "rejected" && !quiet)
          toast.error(
            L(
              "Your previous request was not approved. You can try again.",
              "طلبك السابق ما انقبل. فيك تجرّب مرة تانية.",
            ),
          );
      }
      setStep((s) => s ?? { s: "form" });
    } catch {
      setStep((s) => s ?? { s: "form" });
    }
  };
  useEffect(() => {
    void checkStatus(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await invokeFn<{
        status: string;
        claim_id: string;
        sent_to?: string;
        note?: string;
      }>("claim-vendor", {
        action: "start",
        vendor_id: vendorId,
        contact_name: name,
        contact_phone: phone,
        evidence_note: [`Role: ${role}`, note.trim()].filter(Boolean).join(". "),
      });
      if (r.status === "otp_sent")
        setStep({ s: "otp", claim_id: r.claim_id, sent_to: r.sent_to ?? phone });
      else setStep({ s: "pending", claim_id: r.claim_id, note: r.note });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (step?.s !== "otp") return;
    setBusy(true);
    setErr(null);
    try {
      await invokeFn("claim-vendor", { action: "verify", claim_id: step.claim_id, code });
      toast.success(L("Verified! Welcome to Alo King.", "تم التوثيق! أهلا فيك بألو كينغ."));
      navigate({ to: "/merchant/onboarding" });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      if (e instanceof EdgeError && typeof e.body.attempts_left === "number")
        setAttempts(e.body.attempts_left);
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  if (!step) return <Skeleton className="h-80 rounded-xl" />;

  if (step.s === "verified")
    return (
      <div className="lux-card p-8 text-center">
        <BadgeCheck className="mx-auto size-10 text-gold" />
        <p className="mt-3 text-xl font-semibold">{L("You're verified", "انت موثّق")}</p>
        <Button variant="gold" className="mt-5" asChild>
          <Link to="/merchant">{L("Open your dashboard", "افتح لوحة التحكم")}</Link>
        </Button>
      </div>
    );

  if (step.s === "pending")
    return (
      <div className="lux-card p-8 text-center">
        <Clock className="mx-auto size-10 text-gold" />
        <h2 className="mt-3 text-3xl font-semibold">{L("Request received", "وصلنا طلبك")}</h2>
        <p className="mt-2 text-muted-foreground">
          {L(
            "We'll review it shortly and confirm on WhatsApp. You can come back here anytime to check the status.",
            "رح نراجعه قريباً ونأكد على واتساب. فيك ترجع لهون أي وقت لتشوف الحالة.",
          )}
        </p>
        {step.note && <p className="mt-3 text-sm text-muted-foreground">{step.note}</p>}
        <Button
          variant="hairline"
          className="mt-5"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await checkStatus();
            setBusy(false);
          }}
        >
          <RotateCcw /> {L("Check status", "شوف الحالة")}
        </Button>
      </div>
    );

  if (step.s === "otp")
    return (
      <div className="lux-card space-y-5 p-8 text-center">
        <MessageCircle className="mx-auto size-10 text-gold" />
        <p className="text-sm text-muted-foreground">{L("Step 3 of 3", "الخطوة ٣ من ٣")}</p>
        <p>
          {L("We sent a 6-digit code to", "بعتنالك رمز من ٦ أرقام على")}{" "}
          <span className="font-semibold" dir="ltr">
            {step.sent_to}
          </span>{" "}
          {L("on WhatsApp", "على واتساب")}
        </p>
        <div className="flex justify-center" dir="ltr">
          <InputOTP
            maxLength={6}
            value={code}
            onChange={setCode}
            onComplete={() => undefined}
            aria-label="Verification code"
          >
            <InputOTPGroup>
              {Array.from({ length: 6 }).map((_, i) => (
                <InputOTPSlot key={i} index={i} className="size-12 text-lg" />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>
        {err && (
          <p className="text-sm text-destructive">
            {err}
            {attempts != null && ` · ${attempts} ${L("attempts left", "محاولات متبقية")}`}
          </p>
        )}
        <Button
          variant="gold"
          size="lg"
          className="w-full"
          disabled={busy || code.length !== 6}
          onClick={verify}
        >
          {busy ? L("Checking…", "عم نتحقق…") : L("Verify", "تحقق")}
        </Button>
        <button
          className="text-sm text-muted-foreground hover:text-gold"
          onClick={() => {
            setStep({ s: "form" });
            setErr(null);
            setCode("");
            setAttempts(null);
          }}
        >
          {L("Didn't get it? Start again", "ما وصلك؟ ابدأ من جديد")}
        </button>
      </div>
    );

  return (
    <form onSubmit={start} className="lux-card space-y-4 p-8">
      <p className="text-sm text-muted-foreground">
        {L("Step 2 of 3 · Tell us about you", "الخطوة ٢ من ٣ · عرّفنا عن حالك")}
      </p>
      <div className="space-y-2">
        <Label htmlFor="cn">{L("Your name", "اسمك")}</Label>
        <Input id="cn" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>{L("Your role", "دورك")}</Label>
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="owner">{L("Owner", "المالك")}</SelectItem>
            <SelectItem value="manager">{L("Manager", "المدير")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="cp">{L("Your phone (WhatsApp)", "رقمك (واتساب)")}</Label>
        <Input
          id="cp"
          required
          type="tel"
          dir="ltr"
          placeholder="+961 3 123 456"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="nt">{L("Note (optional)", "ملاحظة (اختياري)")}</Label>
        <Textarea
          id="nt"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={L("Anything that helps us verify you", "أي شي بيساعدنا نتحقق")}
        />
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <Button type="submit" variant="gold" size="lg" className="w-full" disabled={busy}>
        {busy ? L("Sending…", "عم نبعت…") : L("Send verification", "ابعت التحقق")}
      </Button>
      <p className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {L("Signed in as", "مسجّل كـ")} {email}
        </span>
        <button type="button" onClick={signOut} className="flex items-center gap-1 hover:text-gold">
          <LogOut className="size-3" />
          {L("Sign out", "خروج")}
        </button>
      </p>
    </form>
  );
}

function ClaimRoute() {
  return (
    <PrivateShell>
      <ClaimPage />
    </PrivateShell>
  );
}
