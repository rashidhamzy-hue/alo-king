// WEB4a: the founder's design reference's small parts (its components/ak Brand, Button, Price, WhatsApp), copied for the look and rendered on
// the server by Astro (@astrojs/react, no client directive: no React reaches the browser). Class names are the reference's; each resolves to a
// token in packages/ui/tokens.css through packages/ui/styles/theme.ref.css (one palette). Left and right are start and end (ms, me, ps, pe,
// start, end), and an arrow that points the way of reading is mirrored in Arabic (rtl:-scale-x-100). No data, no store, no number here: a
// component takes words and figures already decided by the page, from the database.
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { usd } from "../../lib/i18n";

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

/** An arrow that points forward in the language of the page (right in English and French, left in Arabic). */
export function Forward({ className = "size-4" }: { className?: string }) {
  return <ArrowRight className={cx(className, "shrink-0 rtl:-scale-x-100")} aria-hidden="true" />;
}

/** A price: the database's figure, in dollars, with Western digits in every language, isolated so an Arabic sentence keeps its order. */
export function Price({ value, className = "" }: { value: number | string; className?: string }) {
  return <bdi dir="ltr" className={cx("tabular", className)}>{usd(value)}</bdi>;
}

/** The crown: the same drawing as packages/ui/crown.svg (the reference's Brand.tsx). */
export function Crown({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path d="M5 22.5 6.5 9.5l5.5 5.5L16 7l4 8 5.5-5.5L27 22.5Z" fill="currentColor" strokeLinejoin="round" />
      <circle cx="6.5" cy="8.5" r="1.8" fill="currentColor" />
      <circle cx="16" cy="5.8" r="1.8" fill="currentColor" />
      <circle cx="25.5" cy="8.5" r="1.8" fill="currentColor" />
      <rect x="5" y="24" width="22" height="3.2" rx="1.6" fill="currentColor" />
    </svg>
  );
}
/** The logo: the crown on its gold tile and the name, as the site writes it in the page's language. */
export function Logo({ name, light = false }: { name: string; light?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="grid size-9 place-items-center rounded-md bg-accent text-ink shadow-press">
        <Crown className="size-6" />
      </span>
      <span className={cx("text-[1.35rem] font-bold leading-none tracking-tight", light ? "text-paper" : "text-foreground")}>{name}</span>
    </span>
  );
}

/** The WhatsApp glyph (Simple Icons, CC0). Only on a WhatsApp action. */
export function WaIcon({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}

type Variant = "primary" | "accent" | "outline" | "ghost" | "soft" | "whatsapp";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground shadow-press hover:bg-primary-deep",
  accent: "bg-accent text-accent-foreground shadow-press hover:brightness-105",
  outline: "border-2 border-input bg-card text-foreground",
  ghost: "text-foreground hover:bg-muted",
  soft: "bg-secondary text-secondary-foreground hover:brightness-95",
  whatsapp: "bg-whatsapp text-whatsapp-ink shadow-press hover:brightness-105",
};
const SIZES = { sm: "min-h-11 px-3.5 text-sm", md: "min-h-12 px-5 text-[15px]", lg: "min-h-14 px-6 text-base" } as const;
/** The reference's one button system (its Button.tsx, without the class library). */
export const btn = (variant: Variant = "primary", size: keyof typeof SIZES = "md", block = false, extra = "") =>
  cx("press inline-flex select-none items-center justify-center gap-2 rounded-2xl font-bold no-underline", VARIANTS[variant], SIZES[size], block && "w-full", extra);

/** A section's heading, with an optional line under it and an action at its end. */
export function SectionHead({ title, sub, action, id }: { title: string; sub?: string | null; action?: ReactNode; id?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 id={id} className="m-0 text-[22px] font-bold leading-tight lg:text-[26px]">{title}</h2>
        {sub && <p className="m-0 text-sm text-muted-foreground">{sub}</p>}
      </div>
      {action}
    </div>
  );
}
/** "See all" at the end of a section head. */
export function SeeAll({ href, label }: { href: string; label: string }) {
  return <a href={href} className="inline-flex min-h-11 shrink-0 items-center gap-1 text-sm font-bold text-foreground no-underline">{label} <Forward /></a>;
}
