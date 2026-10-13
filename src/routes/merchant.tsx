import { useState } from "react";
import { PrivateShell } from "@/components/private/PrivateShell";
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { ClipboardList, Home, LogOut, Sparkles, Store, UtensilsCrossed } from "lucide-react";
import { Crown } from "@/design/Crown";
import { OnboardingPanel } from "@/components/merchant/OnboardingPanel";
import { StaffGate, signOut, type StaffProfile } from "@/components/staff/StaffGate";
import { LangToggle } from "@/components/landing/SiteHeader";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MERCHANT_ASSISTANT_LIVE } from "@/lib/site-config";
import { MerchantCtx, useVendorRow } from "@/components/merchant/context";
import { AssistantProvider, useAssistantState } from "@/components/merchant/AssistantChat";
import { VendorPicker } from "@/components/merchant/VendorPicker";
import { vendorName } from "@/lib/vendor";
import { cn } from "@/lib/utils";
import { useL, useLang } from "@/lib/i18n";

export const Route = createFileRoute("/merchant")({
  head: () => ({
    meta: [
      { title: "Merchant dashboard — Alo King" },
      { name: "description", content: "Manage your Alo King page, menu, orders and AI assistant." },
      { property: "og:title", content: "Merchant dashboard — Alo King" },
      { property: "og:description", content: "Manage your Alo King page, menu and orders." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MerchantRoute,
});

function MerchantRoute() {
  return (
    <PrivateShell>
      <StaffGate
        roles={["merchant", "admin"]}
        title={["Merchant dashboard", "لوحة التاجر", "Tableau de bord commerçant"]}
      >
        {(p) => (
          <AssistantProvider>
            <MerchantLayout profile={p} />
          </AssistantProvider>
        )}
      </StaffGate>
    </PrivateShell>
  );
}

const NAV = [
  { to: "/merchant", en: "Home", ar: "الرئيسية", fr: "Accueil", I: Home, exact: true },
  { to: "/merchant/orders", en: "Orders", ar: "الطلبات", fr: "Commandes", I: ClipboardList },
  { to: "/merchant/menu", en: "Menu", ar: "المنيو", fr: "Menu", I: UtensilsCrossed },
  { to: "/merchant/profile", en: "Profile", ar: "الصفحة", fr: "Profil", I: Store },
  { to: "/merchant/assistant", en: "Assistant", ar: "المساعد", fr: "Assistant", I: Sparkles },
] as const;

function MerchantLayout({ profile }: { profile: StaffProfile }) {
  const L = useL();
  const { dir } = useLang();
  // The kitchen terminal wants the whole width for its three columns, so the assistant panel is a sheet there.
  const onOrders = useRouterState({
    select: (s) => s.location.pathname.startsWith("/merchant/orders"),
  });
  const docked = !onOrders;
  const [vendorId, setVendorId] = useState<string | null>(profile.vendor_id);
  const [open, setOpen] = useState(false);
  const { setDraft } = useAssistantState();
  const vendorQ = useVendorRow(vendorId ?? "");
  const name = vendorQ.data
    ? vendorName(vendorQ.data)
    : L("Your kitchen", "مطبخك", "Votre cuisine");

  if (!vendorId && profile.role === "merchant")
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center text-tone-mute">
        {L(
          "Your profile has no business linked yet. Contact Alo King.",
          "حسابك مش مربوط بمحل بعد. احكي مع ألو كينغ.",
          "Votre profil n'est pas encore lié à une activité. Contactez Alo King.",
        )}
      </div>
    );

  const openAssistant = (prompt?: string) => {
    if (prompt && MERCHANT_ASSISTANT_LIVE) setDraft(prompt);
    setOpen(true);
  };
  const assistantLabel = L("Setup assistant", "مساعد الإعداد", "Assistant de configuration");

  return (
    <div
      className={cn(
        "min-h-screen lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]",
        docked && "xl:grid-cols-[15rem_minmax(0,1fr)_23rem]",
      )}
    >
      <aside className="sticky top-0 hidden h-screen flex-col border-e border-tone-line p-4 lg:flex">
        <Link to="/" className="mb-8 flex items-center gap-2.5 px-2 text-tone-fg no-underline">
          <Crown className="h-7 w-9 text-gold" />
          <span className="text-lg font-extrabold tracking-tight">Alo King</span>
        </Link>
        <nav className="space-y-1" aria-label={L("Dashboard", "لوحة التحكم", "Tableau de bord")}>
          {NAV.map(({ to, en, ar, fr, I, ...r }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: "exact" in r }}
              className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 font-semibold text-tone-mute no-underline hover:bg-tone-surface-2 hover:text-tone-fg"
              activeProps={{ className: "!bg-gold !text-ink hover:!bg-gold" }}
            >
              <I className="size-5" aria-hidden="true" /> {L(en, ar, fr)}
            </Link>
          ))}
          {profile.role === "admin" && (
            <Link
              to="/admin"
              className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 font-semibold text-tone-mute no-underline hover:bg-tone-surface-2 hover:text-tone-fg"
            >
              <Crown className="h-5 w-6" /> Admin
            </Link>
          )}
        </nav>
        <Button variant="ghost" className="mt-auto justify-start" onClick={signOut}>
          <LogOut /> {L("Sign out", "خروج", "Se déconnecter")}
        </Button>
      </aside>
      <div className="min-w-0 pb-24 lg:pb-0">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-tone-line bg-[color-mix(in_srgb,var(--ink)_90%,transparent)] px-4 backdrop-blur-xl">
          <p className="truncate text-xl font-extrabold">{name}</p>
          <div className="flex items-center gap-2">
            {profile.role === "admin" && (
              <VendorPicker
                value={vendorId ?? ""}
                label={vendorId ? name : L("Pick a vendor", "اختر محل", "Choisir un commerce")}
                onChange={setVendorId}
              />
            )}
            <LangToggle />
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={signOut}
              aria-label={L("Sign out", "خروج", "Se déconnecter")}
            >
              <LogOut />
            </Button>
          </div>
        </header>
        {vendorId ? (
          <MerchantCtx.Provider value={{ profile, vendorId, openAssistant }}>
            <div key={vendorId}>
              <Outlet />
            </div>
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetContent
                side={dir === "rtl" ? "left" : "right"}
                className="flex w-full flex-col p-0 sm:max-w-md"
              >
                <SheetHeader className="sr-only">
                  <SheetTitle>{assistantLabel}</SheetTitle>
                </SheetHeader>
                <OnboardingPanel className="min-h-0 flex-1" />
              </SheetContent>
            </Sheet>
            <Button
              variant="gold"
              className={cn(
                "fixed bottom-20 end-4 z-40 shadow-glow-gold lg:bottom-6",
                docked && "xl:hidden",
              )}
              size="lg"
              onClick={() => setOpen(true)}
            >
              <Sparkles /> <span className="hidden sm:inline">{assistantLabel}</span>
              <span className="sm:hidden sr-only">{assistantLabel}</span>
            </Button>
          </MerchantCtx.Provider>
        ) : (
          <p className="p-10 text-center text-tone-mute">
            {L("Pick a vendor to manage.", "اختر محل لتديره.", "Choisissez un commerce à gérer.")}
          </p>
        )}
      </div>
      {vendorId && docked && (
        <MerchantCtx.Provider value={{ profile, vendorId, openAssistant }}>
          <aside className="sticky top-0 hidden h-screen border-s border-tone-line xl:block">
            <OnboardingPanel />
          </aside>
        </MerchantCtx.Provider>
      )}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-tone-line bg-[color-mix(in_srgb,var(--ink)_95%,transparent)] backdrop-blur-xl lg:hidden"
        aria-label={L("Dashboard", "لوحة التحكم", "Tableau de bord")}
      >
        {NAV.map(({ to, en, ar, fr, I, ...r }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: "exact" in r }}
            className="flex min-h-14 flex-col items-center justify-center gap-0.5 py-2 text-[0.72rem] font-semibold text-tone-mute no-underline"
            activeProps={{ className: "!text-gold" }}
          >
            <I className="size-5" aria-hidden="true" /> {L(en, ar, fr)}
          </Link>
        ))}
      </nav>
    </div>
  );
}
