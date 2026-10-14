import { lazy, Suspense, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Data fetching and toasts belong to the private pages (merchant, driver, admin). The public site never loads them, which
// keeps its JavaScript under the budget (DECISIONS §37.5). The look is the public site's, same type and tokens: the merchant
// dashboard belongs to the business side and reads by day (session W, §39.11); the team console and the driver app stay
// at night. A page can still set its own tone (the kitchen terminal is a night panel inside the day dashboard).
const Toaster = lazy(() => import("@/components/ui/sonner").then((m) => ({ default: m.Toaster })));

export function PrivateShell({
  children,
  tone = "night",
}: {
  children: ReactNode;
  tone?: "night" | "cream";
}) {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <div className={`ak-site tone-${tone} min-h-screen ${tone === "cream" ? "ak-side-biz" : ""}`}>
        {children}
      </div>
      <Suspense fallback={null}>
        <Toaster position="top-center" richColors theme={tone === "cream" ? "light" : "dark"} />
      </Suspense>
    </QueryClientProvider>
  );
}
