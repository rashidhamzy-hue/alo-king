import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { Crown, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/lib/supabase";
import { errMsg } from "@/lib/format";
import { WHATSAPP_LINK } from "@/lib/config";

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

export function StaffGate({
  roles,
  title,
  children,
}: {
  roles: StaffRole[];
  title: string;
  children: (p: StaffProfile, session: Session) => ReactNode;
}) {
  const { session, ready } = useSession();
  const uid = session?.user.id;
  const profileQ = useQuery({
    queryKey: ["staff_profile", uid],
    enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_profiles")
        .select("user_id,role,vendor_id,display_name")
        .eq("user_id", uid!)
        .maybeSingle();
      if (error) throw error;
      return data as StaffProfile | null;
    },
  });

  if (!ready || (uid && profileQ.isLoading))
    return (
      <Shell>
        <Skeleton className="h-64 w-full max-w-sm rounded-xl" />
      </Shell>
    );
  if (!session) return <AuthForms title={title} />;
  const p = profileQ.data;
  if (!p || !roles.includes(p.role))
    return (
      <Shell>
        <div className="lux-card max-w-md p-8 text-center">
          <Crown className="mx-auto size-8 text-gold" />
          <h1 className="mt-4 text-3xl font-semibold">Almost there</h1>
          <p className="mt-3 text-muted-foreground">
            Your account isn't linked to a {roles.includes("driver") ? "driver" : "kitchen"} profile
            yet. Contact Alo King to get set up.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">Signed in as {session.user.email}</p>
          <div className="mt-6 flex justify-center gap-2">
            <Button variant="gold" asChild>
              <a href={WHATSAPP_LINK} target="_blank" rel="noreferrer">
                Contact Alo King
              </a>
            </Button>
            <Button variant="hairline" onClick={signOut}>
              <LogOut /> Sign out
            </Button>
          </div>
        </div>
      </Shell>
    );
  return <>{children(p, session)}</>;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-hero px-4">{children}</div>
  );
}

export function AuthForms({
  title,
  inline,
  subtitle,
}: {
  title: string;
  inline?: boolean;
  subtitle?: string;
}) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.href },
        });
        if (error) throw error;
        if (!data.session)
          toast.success("Account created. Check your email to confirm, then sign in.");
      }
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  const form = (
    <form onSubmit={submit} className="lux-card w-full max-w-sm space-y-5 p-8">
      <div className="text-center">
        <Crown className="mx-auto size-7 text-gold" />
        <h1 className="mt-3 text-3xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">
          {subtitle ?? (mode === "in" ? "Sign in to continue" : "Create your account")}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-12"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="pw">Password</Label>
        <Input
          id="pw"
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-12"
        />
      </div>
      <Button type="submit" variant="gold" size="lg" className="w-full" disabled={busy}>
        {busy ? "Please wait…" : mode === "in" ? "Sign in" : "Sign up"}
      </Button>
      <button
        type="button"
        className="w-full text-center text-sm text-muted-foreground hover:text-gold"
        onClick={() => setMode(mode === "in" ? "up" : "in")}
      >
        {mode === "in" ? "New here? Create an account" : "Have an account? Sign in"}
      </button>
    </form>
  );
  return inline ? form : <Shell>{form}</Shell>;
}
