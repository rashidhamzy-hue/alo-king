import { useState } from "react";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { ClipboardList, Crown, Home, LogOut, Sparkles, Store, UtensilsCrossed } from "lucide-react";
import { StaffGate, signOut, type StaffProfile } from "@/components/staff/StaffGate";
import { LangToggle } from "@/components/landing/SiteHeader";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MerchantCtx, useVendorRow } from "@/components/merchant/context";
import {
  AssistantChat,
  AssistantProvider,
  useAssistantState,
} from "@/components/merchant/AssistantChat";
import { VendorPicker } from "@/components/merchant/VendorPicker";
import { vendorName } from "@/lib/vendor";
import { useL } from "@/lib/i18n";

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
  component: () => (
    <StaffGate roles={["merchant", "admin"]} title="Merchant dashboard">
      {(p) => (
        <AssistantProvider>
          <MerchantLayout profile={p} />
        </AssistantProvider>
      )}
    </StaffGate>
  ),
});

const NAV = [
  { to: "/merchant", en: "Home", ar: "الرئيسية", I: Home, exact: true },
  { to: "/merchant/orders", en: "Orders", ar: "الطلبات", I: ClipboardList },
  { to: "/merchant/menu", en: "Menu", ar: "المنيو", I: UtensilsCrossed },
  { to: "/merchant/profile", en: "Profile", ar: "الصفحة", I: Store },
  { to: "/merchant/assistant", en: "Assistant", ar: "المساعد", I: Sparkles },
] as const;

function MerchantLayout({ profile }: { profile: StaffProfile }) {
  const L = useL();
  const [vendorId, setVendorId] = useState<string | null>(profile.vendor_id);
  const [open, setOpen] = useState(false);
  const { setDraft } = useAssistantState();
  const vendorQ = useVendorRow(vendorId ?? "");
  const name = vendorQ.data ? vendorName(vendorQ.data) : L("Your kitchen", "مطبخك");

  if (!vendorId && profile.role === "merchant")
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center text-muted-foreground">
        {L(
          "Your profile has no business linked yet. Contact Alo King.",
          "حسابك مش مربوط بمحل بعد. احكي مع ألو كينغ.",
        )}
      </div>
    );

  const openAssistant = (prompt?: string) => {
    if (prompt) setDraft(prompt);
    setOpen(true);
  };

  return (
    <div className="min-h-screen md:grid md:grid-cols-[220px_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col border-e border-border p-4 md:flex">
        <Link to="/" className="mb-8 flex items-center gap-2 px-2">
          <span className="grid size-8 place-items-center rounded-full bg-gold-gradient text-gold-foreground">
            <Crown className="size-4" />
          </span>
          <span className="font-display text-xl font-semibold">Alo King</span>
        </Link>
        <nav className="space-y-1">
          {NAV.map(({ to, en, ar, I, ...r }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: "exact" in r }}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
              activeProps={{ className: "bg-gold/10 text-gold" }}
            >
              <I className="size-4" /> {L(en, ar)}
            </Link>
          ))}
          {profile.role === "admin" && (
            <Link
              to="/admin"
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
            >
              <Crown className="size-4" /> Admin
            </Link>
          )}
        </nav>
        <Button variant="ghost" className="mt-auto justify-start" onClick={signOut}>
          <LogOut /> {L("Sign out", "خروج")}
        </Button>
      </aside>
      <div className="min-w-0 pb-20 md:pb-0">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border bg-background/90 px-4 backdrop-blur">
          <p className="truncate font-display text-xl font-semibold">{name}</p>
          <div className="flex items-center gap-2">
            {profile.role === "admin" && (
              <VendorPicker
                value={vendorId ?? ""}
                label={vendorId ? name : L("Pick a vendor", "اختر محل")}
                onChange={setVendorId}
              />
            )}
            <LangToggle />
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={signOut}
              aria-label="Sign out"
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
              <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
                <SheetHeader>
                  <SheetTitle>{L("Ask the assistant", "اسأل المساعد")}</SheetTitle>
                </SheetHeader>
                <AssistantChat className="min-h-0 flex-1 px-4 pb-4" />
              </SheetContent>
            </Sheet>
            <Button
              variant="gold"
              className="fixed bottom-20 end-4 z-40 rounded-full shadow-glow-gold md:bottom-6"
              size="lg"
              onClick={() => setOpen(true)}
            >
              <Sparkles />{" "}
              <span className="hidden sm:inline">{L("Ask the assistant", "اسأل المساعد")}</span>
            </Button>
          </MerchantCtx.Provider>
        ) : (
          <p className="p-10 text-center text-muted-foreground">
            {L("Pick a vendor to manage.", "اختر محل لتديره.")}
          </p>
        )}
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-background/95 backdrop-blur md:hidden">
        {NAV.map(({ to, en, ar, I, ...r }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: "exact" in r }}
            className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground"
            activeProps={{ className: "text-gold" }}
          >
            <I className="size-5" /> {L(en, ar)}
          </Link>
        ))}
      </nav>
    </div>
  );
}
