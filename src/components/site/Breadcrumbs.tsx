import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useSite } from "./context";

export type Crumb = {
  label: string;
  to?: "/$lang" | "/$lang/places" | "/$lang/cuisine" | "/$lang/for-merchants" | "/$lang/claim";
};

/** Visible breadcrumbs; the BreadcrumbList structured data is built from the same list by `crumbsLd`. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const { lang, t } = useSite();
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-tone-mute">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((c, i) => (
          <li key={`${c.label}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight className="size-4 rtl:rotate-180" aria-hidden="true" />}
            {c.to ? (
              <Link to={c.to} params={{ lang }} className="underline-offset-4 hover:underline">
                {c.label === "" ? t.common.home : c.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-tone-fg">
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** schema.org BreadcrumbList for the same trail. `paths` are absolute URLs, one per crumb. */
export function crumbsLd(items: { label: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.label,
      item: c.url,
    })),
  };
}
