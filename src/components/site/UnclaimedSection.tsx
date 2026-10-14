import { Link } from "@tanstack/react-router";
import { fmt } from "@/lib/site";
import type { UnclaimedList } from "@/lib/site-data";
import { useSite } from "./context";
import { UnclaimedCardItem } from "./UnclaimedCard";

/**
 * The "Not on Alo King yet" list under the shops that take orders (DECISIONS §39.3), a page at a time. The pages are the
 * same address with `?u=<page>`; `to` is the page's own route so the links keep its params.
 */
export function UnclaimedSection({
  list,
  lead,
  to,
  params,
}: {
  list: UnclaimedList;
  lead: string;
  to: "/$lang/places/$slug" | "/$lang/cuisine/$tag";
  params: Record<string, string>;
}) {
  const { t } = useSite();
  const u = t.unclaimed;
  if (list.total === 0) return null;
  const pages = Math.max(1, Math.ceil(list.total / list.page_size));
  const page = Math.min(list.page, pages);
  const nav = (p: number, label: string, rel: "prev" | "next") => (
    <Link
      to={to}
      params={params as never}
      search={{ u: p > 1 ? p : undefined } as never}
      rel={rel}
      className="ak-btn ak-btn-line ak-btn-sm"
      hash="not-yet-title"
    >
      {label}
    </Link>
  );
  return (
    <section className="mt-14" aria-labelledby="not-yet-title">
      <h2 id="not-yet-title" className="ak-h2 scroll-mt-24">
        {u.title}
      </h2>
      <p className="mt-3 max-w-3xl text-tone-mute">{lead}</p>
      <p className="mt-2 text-sm font-semibold text-tone-mute">
        {list.total === 1 ? u.countOne : fmt(u.count, { n: list.total })}
      </p>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.vendors.map((v) => (
          <UnclaimedCardItem key={v.slug} v={v} />
        ))}
      </ul>
      {pages > 1 && (
        <nav aria-label={u.pages} className="mt-8 flex flex-wrap items-center gap-3">
          {page > 1 && nav(page - 1, u.prev, "prev")}
          <span className="text-sm text-tone-mute">{fmt(u.pageOf, { page, pages })}</span>
          {page < pages && nav(page + 1, u.next, "next")}
        </nav>
      )}
      <p className="mt-6 max-w-3xl text-sm text-tone-mute">{u.askHelp}</p>
    </section>
  );
}
