// The component gallery (DS1; docs/strategy/05, section C): every component of packages/ui on one page, in the language and theme
// the staff member is using. Staging and local only: in production the address answers "not found". Reads nothing, changes nothing.
import { render, type Ctx, type Section } from "../app";
import { gallery } from "@ak/ui/gallery";
import { ALL } from "../roles";

async function page(c: Ctx) {
  if (c.deps.environment === "production") return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
  return render(c, c.lang === "ar" ? "معرض المكوّنات" : "Component gallery", gallery(c.lang, c.theme === "dark" ? { theme: "dark" } : {}), { translated: true });
}

export const gallerySection: Section = {
  // No menu entry: More links to it on staging.
  nav: { href: "/gallery", label: "Component gallery", roles: [] },
  routes: [{ method: "GET", path: "/gallery", roles: ALL, handler: page }],
};
