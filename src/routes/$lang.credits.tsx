import { createFileRoute, Link } from "@tanstack/react-router";
import { buildHead, fmt, iso, listPage, pickName } from "@/lib/site";
import { creditText } from "@/lib/item";
import { getCredits, type CreditPhoto } from "@/lib/site-data";
import { useSite } from "@/components/site/context";
import { PageHero } from "@/components/site/PageHero";

export const Route = createFileRoute("/$lang/credits")({
  // DECISIONS §38.1, §39.15.7: every photo the site or the catalogue shows that the shop did not take itself, with its
  // author and license, 100 a page (`?page=<n>`). A utility page: never indexed.
  validateSearch: (s: Record<string, unknown>): { page?: number } => ({ page: listPage(s.page) }),
  loaderDeps: ({ search }) => ({ page: search.page ?? 1 }),
  loader: ({ deps }) => getCredits(deps.page),
  staleTime: 60_000,
  headers: () => ({
    "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=600",
  }),
  head: ({ match }) => {
    const { lang, copy, info } = match.context;
    return buildHead({
      lang,
      path: "/credits",
      title: copy.credits.seoTitle,
      description: copy.credits.seoDescription,
      info: info ?? { origin: "", indexing: false },
      noindex: true,
    });
  },
  component: CreditsPage,
});

/** The rows of one page grouped by shop, in the order the database gave them; a shop's cover comes first. */
function byShop(photos: CreditPhoto[]) {
  const groups = new Map<string, CreditPhoto[]>();
  for (const p of photos) {
    const rows = groups.get(p.vendor_slug);
    if (rows) rows.push(p);
    else groups.set(p.vendor_slug, [p]);
  }
  return [...groups.values()].map((rows) =>
    rows.filter((r) => r.kind === "cover").concat(rows.filter((r) => r.kind === "item")),
  );
}

function CreditsPage() {
  const d = Route.useLoaderData();
  const { t, lang } = useSite();
  const c = t.credits;
  const pages = Math.max(1, Math.ceil(d.total / d.page_size));
  const page = d.page;
  const nav = (p: number, label: string, rel: "prev" | "next") => (
    <Link
      to="/$lang/credits"
      params={{ lang }}
      search={{ page: p > 1 ? p : undefined }}
      rel={rel}
      className="ak-btn ak-btn-line ak-btn-sm"
    >
      {label}
    </Link>
  );
  return (
    <>
      <PageHero
        title={c.title}
        lead={c.lead}
        crumbs={[{ label: "", to: "/$lang" }, { label: c.title }]}
      />
      <section className="tone-cream ak-section !pt-12">
        <div className="ak-container max-w-4xl">
          {d.photos.length === 0 && <p className="text-lg text-tone-mute">{c.none}</p>}
          {byShop(d.photos).map((rows) => {
            const s = rows[0]!;
            const shop = pickName(
              { name_ar: s.vendor_ar, name_en: s.vendor_en, name_fr: s.vendor_fr },
              "name",
              lang,
            );
            return (
              <section
                key={s.vendor_slug}
                className="mt-10 first:mt-0"
                aria-labelledby={`shop-${s.vendor_slug}`}
              >
                <h2 id={`shop-${s.vendor_slug}`} className="ak-h3">
                  <Link
                    to="/$lang/m/$slug"
                    params={{ lang, slug: s.vendor_slug }}
                    className="underline underline-offset-4"
                  >
                    {shop}
                  </Link>
                </h2>
                <ul className="mt-4 space-y-3">
                  {rows.map((p, k) => {
                    const item = pickName(
                      { name_ar: p.item_ar, name_en: p.item_en, name_fr: p.item_fr },
                      "name",
                      lang,
                    );
                    const what = p.kind === "cover" ? c.cover : item || c.cover;
                    const credit = creditText(p);
                    return (
                      <li key={`${p.kind}-${p.item_id ?? k}`} className="ak-card p-4">
                        <p className="break-words font-bold">
                          {p.kind === "item" && p.item_id ? (
                            <Link
                              to="/$lang/i/$id"
                              params={{ lang, id: p.item_id }}
                              className="underline underline-offset-4"
                            >
                              {what}
                            </Link>
                          ) : (
                            what
                          )}
                        </p>
                        {credit && (
                          <p className="mt-1 break-words text-sm text-tone-mute">
                            {fmt(t.item.photo, { credit: iso(credit) })}
                          </p>
                        )}
                        {p.source_url && (
                          <p className="mt-1 text-sm">
                            <a
                              href={p.source_url}
                              target="_blank"
                              rel="nofollow noopener noreferrer"
                              className="underline underline-offset-4"
                            >
                              {c.source}
                              <span className="sr-only">{` · ${what}`}</span>
                            </a>
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
          {(pages > 1 || page > 1) && (
            <nav aria-label={c.pages} className="mt-10 flex flex-wrap items-center gap-3">
              {page > 1 && nav(Math.min(page - 1, pages), c.prev, "prev")}
              <span className="text-sm text-tone-mute">
                {fmt(c.pageOf, { page: Math.min(page, pages), pages })}
              </span>
              {page < pages && nav(page + 1, c.next, "next")}
            </nav>
          )}
        </div>
      </section>
    </>
  );
}
