// The component gallery (DS1; docs/strategy/05, section C): every component of packages/ui on one page, in the language and theme
// the staff member is using. Staging and local only: in production the address answers "not found". Reads nothing, changes nothing.
// CON1: it was at /gallery, which read like a third picture page beside Pictures and Photos; it is now "Design components" under
// Settings, Advanced (admin), at /components, and /gallery goes to Photos (app.ts, MOVED).
import { render, type Ctx, type Section } from "../app";
import { gallery } from "@ak/ui/gallery";
import { ADMIN, ALL } from "../roles";

async function page(c: Ctx) {
  if (c.deps.environment === "production") return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
  return render(c, c.lang === "ar" ? "مكوّنات التصميم" : "Design components", gallery(c.lang, c.theme === "dark" ? { theme: "dark" } : {}), { translated: true });
}

export const gallerySection: Section = {
  // Under Settings, Advanced, for the admin (staging only: production answers "not found").
  nav: { href: "/components", label: "Design components", roles: ADMIN },
  routes: [{ method: "GET", path: "/components", roles: ALL, handler: page }],
};
