import { lazy, Suspense } from "react";
import { ClientOnly } from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";

const VendorMap = lazy(() => import("./VendorMap"));

export function LazyVendorMap(props: { lat: number; lng: number; draggable?: boolean; onMove?: (lat: number, lng: number) => void; className?: string }) {
  const { className = "h-64", ...rest } = props;
  return (
    <div className={`${className} overflow-hidden rounded-xl border border-border`}>
      <ClientOnly fallback={<Skeleton className="h-full w-full" />}>
        <Suspense fallback={<Skeleton className="h-full w-full" />}>
          <VendorMap {...rest} />
        </Suspense>
      </ClientOnly>
    </div>
  );
}
