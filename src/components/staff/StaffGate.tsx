import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { Crown } from "@/design/Crown";
import { LangToggle } from "@/components/landing/SiteHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/lib/supabase";
import { errMsg } from "@/lib/format";
import { useL } from "@/lib/i18n";

/** What a signed-in person may open: an operator (admin), a member of a business, or a driver member. */
export type StaffRole = "merchant" | "driver" | "admin";
export type StaffProfile = {
  user_id: string;
  role: StaffRole;
  vendor_id: string | null;
  display_name: string | null;
};

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  return { session, ready };
}

export const signOut = () => supabase.auth.signOut();

/**
 * Who this person is, from the rebuilt schema (DECISIONS §18.1 H, §32): an operator (`operators`, read through its own-row
 * policy) is an admin; otherwise the first active `vendor_members` row decides: a driver member is a driver, anyone else a
 * merchant of that business.
 */
async function loadProfile(uid: string): Promise<StaffProfile | null> {
  const op = await supabase
    .from("operators")
    .select("user_id,display_name,active")
    .eq("user_id", uid)
    .maybeSingle();
  // A failed read must not look like "not an operator".
  if (op.error) throw op.error;
  if (op.data && (op.data as { active: boolean }).active)
    return {
      user_id: uid,
      role: "admin",
      vendor_id: null,
      display_name: (op.data as { display_name: string }).display_name,
    };
  const m = await supabase
    .from("vendor_members")
    .select("vendor_id,role,display_name")
    .eq("user_id", uid)
    .eq("status", "active")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (m.error) throw m.error;
  const row = m.data as { vendor_id: string; role: string; display_name: string | null } | null;
  if (!row) return null;
  return {
    user_id: uid,
    role: row.role === "driver" ? "driver" : "merchant",
    vendor_id: row.vendor_id,
    display_name: row.display_name,
  };
}

export function StaffGate({
  roles,
  title,
  children,
}: {
  roles: StaffRole[];
  /** The page name in English, Arabic and French. */
  title: [string, string, string];
  children: (p: StaffProfile, session: Session) => ReactNode;
}) {
  const L = useL();
  const { session, ready } = useSession();
  const uid = session?.user.id;
  const profileQ = useQuery({
    queryKey: ["staff_profile", uid],
    enabled: !!uid,
    queryFn: () => loadProfile(uid!),
  });

  if (!ready || (uid && profileQ.isLoading))
    return (
      <Shell>
        <Skeleton className="h-64 w-full max-w-sm rounded-[1.25rem]" />
      </Shell>
    );
  if (uid && profileQ.isError)
    return (
      <Shell>
        <div className="ak-card max-w-md p-8 text-center">
          <h1 className="ak-h3">
            {L(
              "We couldn't check your account",
              "ما قدرنا نتأكد من حسابك",
              "Nous n'avons pas pu vérifier votre compte",
            )}
          </h1>
          <p className="mt-3 text-tone-mute">
            {L("Try again in a moment.", "جرّب مرة تانية بعد شوي.", "Réessayez dans un instant.")}
          </p>
          <Button variant="gold" className="mt-6" onClick={() => void profileQ.refetch()}>
            {L("Try again", "جرّب مجدداً", "Réessayer")}
          </Button>
        </div>
      </Shell>
    );
  if (!session)
    return (
      <AuthForms title={L(...title)} operatorOnly={roles.length === 1 && roles[0] === "admin"} />
    );
  const p = profileQ.data;
  if (!p || !roles.includes(p.role))
    return (
      <Shell>
        <div className="ak-card max-w-md p-8 text-center">
          <Crown className="mx-auto h-9 w-12 text-gold" />
          <h1 className="ak-h3 mt-4">{L("Almost there", "قربنا", "Presque là")}</h1>
          <p className="mt-3 text-tone-mute">
            {roles.includes("admin") && roles.length === 1
              ? L(
                  "This page is for the Alo King team.",
                  "هالصفحة لفريق ألو كينغ.",
                  "Cette page est réservée à l'équipe Alo King.",
                )
              : L(
                  "Your account isn't linked to a business yet. Claim your shop from the For merchants page, or write to us on WhatsApp.",
                  "حسابك مش مربوط بنشاط بعد. استلم محلك من صفحة لأصحاب المحلات، أو راسلنا عالواتساب.",
                  "Votre compte n'est pas encore lié à une activité. Revendiquez votre commerce depuis la page Pour les commerçants, ou écrivez-nous sur WhatsApp.",
                )}
          </p>
          <p className="mt-2 text-xs text-tone-mute" dir="ltr">
            {session.user.email ?? session.user.phone}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button variant="gold" asChild>
              <a href="/for-business">
                {L("For merchants", "لأصحاب المحلات", "Pour les commerçants")}
              </a>
            </Button>
            <Button variant="hairline" onClick={signOut}>
              <LogOut /> {L("Sign out", "خروج", "Se déconnecter")}
            </Button>
          </div>
        </div>
      </Shell>
    );
  return <>{children(p, session)}</>;
}

/** A centred panel on the night background, with the language choice in the corner. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="ak-glow relative isolate flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="absolute end-4 top-4">
        <LangToggle />
      </div>
      {children}
    </div>
  );
}

export function AuthForms({
  title,
  operatorOnly,
}: {
  title: string;
  /** The team console has no sign-up. */
  operatorOnly?: boolean;
}) {
  const L = useL();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <form onSubmit={submit} className="ak-card w-full max-w-sm space-y-5 p-8">
        <div className="text-center">
          <Crown className="mx-auto h-9 w-12 text-gold" />
          <h1 className="ak-h3 mt-3">{title}</h1>
          <p className="mt-1 text-sm text-tone-mute">
            {L("Sign in to continue", "سجّل دخولك للمتابعة", "Connectez-vous pour continuer")}
          </p>
        </div>
        <div>
          <label className="ak-label" htmlFor="email">
            {L("Email", "البريد الإلكتروني", "E-mail")}
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="username"
            dir="ltr"
            className="ak-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="ak-label" htmlFor="pw">
            {L("Password", "كلمة السر", "Mot de passe")}
          </label>
          <input
            id="pw"
            type="password"
            required
            minLength={6}
            autoComplete="current-password"
            dir="ltr"
            className="ak-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Button type="submit" variant="gold" size="lg" className="w-full" disabled={busy}>
          {busy ? L("Please wait…", "لحظة…", "Un instant…") : L("Sign in", "دخول", "Se connecter")}
        </Button>
        {!operatorOnly && (
          <p className="text-center text-sm text-tone-mute">
            {L(
              "Sign-in with your phone number is coming. Until then, run your shop on WhatsApp.",
              "الدخول برقم الهاتف جاي قريباً. لحدّ هلّق دير محلك عالواتساب.",
              "La connexion avec votre numéro arrive. D'ici là, gérez votre commerce sur WhatsApp.",
            )}
          </p>
        )}
      </form>
    </Shell>
  );
}
