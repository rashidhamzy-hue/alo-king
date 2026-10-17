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

/** The address a password-reset link brings the person back to: this page, marked so it asks for the new password. */
const RESET_MARK = "reset";
const resetRedirect = () => {
  const u = new URL(window.location.href);
  u.hash = "";
  u.search = "";
  u.searchParams.set(RESET_MARK, "1");
  return u.toString();
};

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  // Back from a reset link (§39.15.5): Supabase signs the person in from the link; they choose a new password first.
  const [recovery, setRecovery] = useState(false);
  // Back from a reset link that no longer works (used or expired): no session came with it; the sign-in says so.
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const marked = new URLSearchParams(window.location.search).get(RESET_MARK) === "1";
    if (marked) setRecovery(true);
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (marked && !data.session) {
        setRecovery(false);
        setExpired(true);
        dropMark();
      }
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((e, s) => {
      if (e === "PASSWORD_RECOVERY") setRecovery(true);
      setSession(s);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  const recovered = () => {
    setRecovery(false);
    dropMark();
  };
  return { session, ready, recovery, recovered, expired };
}

/** The reset mark leaves the address once used, so a later sign-in on this tab never asks for a new password. */
function dropMark() {
  const u = new URL(window.location.href);
  if (u.searchParams.has(RESET_MARK)) {
    u.searchParams.delete(RESET_MARK);
    window.history.replaceState(null, "", u.pathname + u.search);
  }
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
  const { session, ready, recovery, recovered, expired } = useSession();
  const uid = session?.user.id;
  const profileQ = useQuery({
    queryKey: ["staff_profile", uid],
    enabled: !!uid,
    queryFn: () => loadProfile(uid!),
  });

  // Back from a reset link: the new password comes before anything else, the account check included (§39.15.5).
  if (ready && session && recovery) return <NewPassword onDone={recovered} />;
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
      <AuthForms
        title={L(...title)}
        operatorOnly={roles.length === 1 && roles[0] === "admin"}
        linkExpired={expired}
      />
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
                  "Your account isn't linked to a business yet. Claim your shop from the For businesses page, or write to us on WhatsApp.",
                  "حسابك مش مربوط بمحل بعد. استلم محلّك من صفحة «لأصحاب المحلات»، أو راسلنا عالواتساب.",
                  "Votre compte n'est pas encore lié à un commerce. Revendiquez votre commerce depuis la page Pour les commerces, ou écrivez-nous sur WhatsApp.",
                )}
          </p>
          <p className="mt-2 text-xs text-tone-mute" dir="ltr">
            {session.user.email ?? session.user.phone}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button variant="gold" asChild>
              <a href="/business">{L("For businesses", "لأصحاب المحلات", "Pour les commerces")}</a>
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
  linkExpired,
}: {
  title: string;
  /** The team console has no sign-up. */
  operatorOnly?: boolean;
  /** Back from a password-reset link that was used or has expired. */
  linkExpired?: boolean;
}) {
  const L = useL();
  const [mode, setMode] = useState<"signin" | "forgot" | "sent">("signin");
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

  // "Forgot password" (DECISIONS §39.15.5): Supabase emails a one-time link back to this page. The answer is the same
  // whether or not the address has an account, so the form never tells anyone who is a member.
  async function sendReset(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: resetRedirect(),
      });
      // Only a network failure is shown. Supabase answers 429 (asked again too soon) only for an address with an account,
      // so it gets the same "Check your email" as every other address.
      if (error && (error.status === 0 || error.status === undefined)) throw error;
      setMode("sent");
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  const emailField = (
    <div>
      <label className="ak-label" htmlFor="email">
        {L("Email", "الإيميل", "E-mail")}
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
  );
  const head = (sub: string) => (
    <div className="text-center">
      <Crown className="mx-auto h-9 w-12 text-gold" />
      <h1 className="ak-h3 mt-3">{title}</h1>
      <p className="mt-1 text-sm text-tone-mute">{sub}</p>
    </div>
  );
  const back = (
    <button
      type="button"
      className="mx-auto block text-sm font-bold underline underline-offset-4"
      onClick={() => setMode("signin")}
    >
      {L("Back to sign in", "رجوع للدخول", "Retour à la connexion")}
    </button>
  );

  if (mode === "sent")
    return (
      <Shell>
        <div className="ak-card w-full max-w-sm space-y-5 p-8" role="status">
          {head(L("Check your email", "شوف الإيميل تبعك", "Vérifiez vos e-mails"))}
          <p className="text-center text-tone-mute">
            {L(
              "If an account uses this email, a link to choose a new password is on its way. Open it on this device. It works once and expires soon.",
              "إذا في حساب على هالإيميل، رح يوصلك رابط لتختار كلمة سر جديدة. افتحو على هالجهاز. بيشتغل مرة وحدة وبيخلص بعد شوي.",
              "Si un compte utilise cet e-mail, un lien pour choisir un nouveau mot de passe arrive. Ouvrez-le sur cet appareil. Il ne sert qu'une fois et expire vite.",
            )}
          </p>
          {back}
        </div>
      </Shell>
    );

  if (mode === "forgot")
    return (
      <Shell>
        <form onSubmit={sendReset} className="ak-card w-full max-w-sm space-y-5 p-8">
          {head(
            L(
              "We'll email you a link to choose a new password.",
              "منبعتلك رابط عالإيميل لتختار كلمة سر جديدة.",
              "Nous vous envoyons un lien pour choisir un nouveau mot de passe.",
            ),
          )}
          {emailField}
          <Button type="submit" variant="gold" size="lg" className="w-full" disabled={busy}>
            {busy
              ? L("Please wait…", "لحظة…", "Un instant…")
              : L("Send the link", "ابعتلي الرابط", "Envoyer le lien")}
          </Button>
          {back}
        </form>
      </Shell>
    );

  return (
    <Shell>
      <form onSubmit={submit} className="ak-card w-full max-w-sm space-y-5 p-8">
        {head(L("Sign in to continue", "فوت عحسابك لتكمّل", "Connectez-vous pour continuer"))}
        {linkExpired && (
          <p className="text-center text-sm text-tone-mute" role="status">
            {L(
              "That link has expired or was already used. Tap Forgot password to get a new one.",
              "هالرابط خلص أو انستعمل قبل. دوس «نسيت كلمة السر» لياخدك رابط جديد.",
              "Ce lien a expiré ou a déjà servi. Touchez Mot de passe oublié pour en recevoir un nouveau.",
            )}
          </p>
        )}
        {emailField}
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <label className="ak-label" htmlFor="pw">
              {L("Password", "كلمة السر", "Mot de passe")}
            </label>
            <button
              type="button"
              className="text-sm font-bold underline underline-offset-4"
              onClick={() => setMode("forgot")}
            >
              {L("Forgot password?", "نسيت كلمة السر؟", "Mot de passe oublié ?")}
            </button>
          </div>
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
          {busy ? L("Please wait…", "لحظة…", "Un instant…") : L("Sign in", "فوت", "Se connecter")}
        </Button>
        {!operatorOnly && (
          <p className="text-center text-sm text-tone-mute">
            {L(
              "Sign-in with your phone number is coming. Until then, run your shop on WhatsApp.",
              "الدخول برقم التلفون جايي قريباً. لهلّق دير محلّك عالواتساب.",
              "La connexion avec votre numéro arrive. D'ici là, gérez votre commerce sur WhatsApp.",
            )}
          </p>
        )}
      </form>
    </Shell>
  );
}

/** After a reset link: the person is signed in by the link and picks a new password before anything else. */
function NewPassword({ onDone }: { onDone: () => void }) {
  const L = useL();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const mismatch = again.length > 0 && again !== password;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (password !== again) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success(L("Password changed", "تغيّرت كلمة السر", "Mot de passe changé"));
      onDone();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <form onSubmit={save} className="ak-card w-full max-w-sm space-y-5 p-8">
        <div className="text-center">
          <Crown className="mx-auto h-9 w-12 text-gold" />
          <h1 className="ak-h3 mt-3">
            {L(
              "Choose a new password",
              "اختار كلمة سر جديدة",
              "Choisissez un nouveau mot de passe",
            )}
          </h1>
        </div>
        <div>
          <label className="ak-label" htmlFor="npw">
            {L("New password", "كلمة السر الجديدة", "Nouveau mot de passe")}
          </label>
          <input
            id="npw"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            dir="ltr"
            className="ak-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div>
          <label className="ak-label" htmlFor="npw2">
            {L("Type it again", "رجاع اكتبها", "Encore une fois")}
          </label>
          <input
            id="npw2"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            dir="ltr"
            className="ak-input"
            aria-invalid={mismatch || undefined}
            aria-describedby={mismatch ? "npw-err" : undefined}
            value={again}
            onChange={(e) => setAgain(e.target.value)}
          />
          {mismatch && (
            <p id="npw-err" className="mt-1.5 text-sm font-semibold text-destructive">
              {L(
                "The two passwords are not the same.",
                "كلمتين السر مش متل بعض.",
                "Les deux mots de passe ne sont pas identiques.",
              )}
            </p>
          )}
        </div>
        <Button
          type="submit"
          variant="gold"
          size="lg"
          className="w-full"
          disabled={busy || mismatch}
        >
          {busy
            ? L("Please wait…", "لحظة…", "Un instant…")
            : L("Save the password", "احفظ كلمة السر", "Enregistrer")}
        </Button>
      </form>
    </Shell>
  );
}
