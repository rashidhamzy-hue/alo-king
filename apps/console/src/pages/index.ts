// Every console section, in menu order. Each owns its routes and the roles that may use them.
import type { Section } from "../app";
import { render, html } from "../app";
import { ALL } from "../roles";

const home: Section = {
  nav: { href: "/", label: "Today", roles: ALL },
  routes: [{ method: "GET", path: "/", roles: ALL, handler: async (c) => render(c, "Today", html`<p>Signed in.</p>`) }],
};

export const registry: Section[] = [home];
