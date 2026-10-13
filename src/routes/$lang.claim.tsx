import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { buildHead, fmt } from "@/lib/site";
import {
  lookupBusiness,
  searchBusinesses,
  type ClaimBusiness,
  type ClaimHit,
} from "@/lib/site-claim";
import { useSite } from "@/components/site/context";
import { PageHero } from "@/components/site/PageHero";
import { ClaimFlow } from "@/components/site/forms/ClaimFlow";
import { Notice } from "@/components/site/forms/ui";

type Search = { q?: string; v?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/$lang/claim")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    q: typeof s.q === "string" && s.q.trim().length >= 2 ? s.q.trim().slice(0, 80) : undefined,
    v: typeof s.v === "string" && UUID.test(s.v) ? s.v : undefined,
  }),
  // A form with a person's details: never cached, never indexed.
  headers: () => ({ "cache-control": "no-store" }),
  head: ({ match }) => {
    const { lang, copy, info } = match.context;
    return buildHead({
      lang,
      path: "/claim",
      title: copy.claim.seoTitle,
      description: copy.claim.seoDescription,
      info: info ?? { origin: "", indexing: false },
      noindex: true,
    });
  },
  component: ClaimPage,
});

function ClaimPage() {
  const { t, lang } = useSite();
  const c = t.claim;
  const { q, v } = Route.useSearch();
  // The search and the lookup run in the visitor's browser, never on our server: the platform counts calls per visitor
  // address, and a server-side call would put every visitor behind one address and one shared limit.
  const [data, setData] = useState<{
    business: ClaimBusiness | null;
    hits: ClaimHit[] | null;
    failed: boolean;
    loading: boolean;
  }>({ business: null, hits: null, failed: false, loading: !!(q || v) });
  useEffect(() => {
    let live = true;
    if (!q && !v) {
      setData({ business: null, hits: null, failed: false, loading: false });
      return;
    }
    setData((d) => ({ ...d, loading: true, failed: false }));
    const run = v
      ? lookupBusiness(v).then((business) => ({
          business,
          hits: null as ClaimHit[] | null,
          failed: false,
        }))
      : searchBusinesses(q!).then((r) => ({
          business: null as ClaimBusiness | null,
          hits: r.ok ? r.data.results : null,
          failed: !r.ok,
        }));
    void run.then((x) => live && setData({ ...x, loading: false }));
    return () => {
      live = false;
    };
  }, [q, v]);
  const { business, hits, failed } = data;
  const navigate = useNavigate({ from: "/$lang/claim" });
  const [typed, setTyped] = useState(q ?? "");

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    if (typed.trim().length >= 2) void navigate({ search: { q: typed.trim() } });
  };

  return (
    <>
      <PageHero
        eyebrow={c.eyebrow}
        title={c.title}
        lead={c.lead}
        crumbs={[
          { label: "", to: "/$lang" },
          { label: t.nav.merchants, to: "/$lang/for-merchants" },
          { label: c.eyebrow },
        ]}
      />
      <section className="tone-cream ak-section !pt-10">
        <div className="ak-container max-w-3xl">
          {v && data.loading ? (
            <p role="status" className="py-10 text-center text-tone-mute">
              {t.form.sending}
            </p>
          ) : v ? (
            business ? (
              <ClaimFlow key={business.vendor_id} business={business} />
            ) : (
              <Notice tone="error">{c.notAvailable}</Notice>
            )
          ) : (
            <>
              <form
                action={`/${lang}/claim`}
                method="get"
                role="search"
                onSubmit={onSearch}
                aria-label={c.searchLabel}
              >
                <label htmlFor="claim-q" className="ak-label">
                  {c.searchLabel}
                </label>
                <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                  <div className="relative flex-1">
                    <Search
                      className="pointer-events-none absolute start-4 top-1/2 size-5 -translate-y-1/2 text-tone-mute"
                      aria-hidden="true"
                    />
                    <input
                      id="claim-q"
                      name="q"
                      type="search"
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      minLength={2}
                      maxLength={80}
                      required
                      autoComplete="off"
                      placeholder={c.placeholder}
                      className="ak-input !mt-0 !min-h-14 !ps-12"
                    />
                  </div>
                  <button type="submit" className="ak-btn ak-btn-ink ak-btn-lg">
                    {c.searchButton}
                  </button>
                </div>
              </form>

              {failed && (
                <div className="mt-6">
                  <Notice tone="error">{t.form.errors.generic}</Notice>
                </div>
              )}

              {hits && (
                <div className="mt-8" aria-live="polite">
                  {hits.length === 0 ? (
                    <div className="space-y-4">
                      <p>{fmt(c.noResults, { q: q ?? "" })}</p>
                      <Link to="/$lang/register" params={{ lang }} className="ak-btn ak-btn-gold">
                        {c.registerInstead}
                      </Link>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-tone-mute">
                        {hits.length === 1 ? c.resultsOne : fmt(c.resultsCount, { n: hits.length })}
                      </p>
                      <ul className="mt-3 space-y-3">
                        {hits.map((h) => (
                          <li
                            key={h.vendor_id}
                            className="ak-card flex flex-wrap items-center justify-between gap-4 p-5"
                          >
                            <div className="min-w-0">
                              <p className="text-lg font-extrabold">{h.name}</p>
                              <p className="text-sm text-tone-mute">
                                {[h.branch_label, h.town].filter(Boolean).join(" · ")}
                              </p>
                              {(h.claimed || h.frozen) && (
                                <p className="mt-1 text-sm font-bold">
                                  {h.claimed ? c.claimed : c.frozen}
                                </p>
                              )}
                            </div>
                            <Link
                              to="/$lang/claim"
                              params={{ lang }}
                              search={{ v: h.vendor_id }}
                              className="ak-btn ak-btn-gold ak-btn-sm"
                            >
                              {c.claimThis}
                            </Link>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-6 text-tone-mute">
                        {hits.some((h) => h.claimed) && `${c.claimedHelp} `}
                        <Link
                          to="/$lang/register"
                          params={{ lang }}
                          className="font-bold text-tone-fg underline underline-offset-4"
                        >
                          {c.registerInstead}
                        </Link>
                      </p>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </>
  );
}
