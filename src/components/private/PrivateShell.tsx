import { lazy, Suspense, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Data fetching and toasts belong to the private pages (merchant, driver, admin). The public site never loads them, which
// keeps its JavaScript under the budget (DECISIONS §37.5). The look is the public site's: night tone, same type and tokens.
const Toaster = lazy(() => import("@/components/ui/sonner").then((m) => ({ default: m.Toaster })));

export function PrivateShell({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <div className="ak-site tone-night min-h-screen">{children}</div>
      <Suspense fallback={null}>
        <Toaster position="top-center" richColors theme="dark" />
      </Suspense>
    </QueryClientProvider>
  );
}
