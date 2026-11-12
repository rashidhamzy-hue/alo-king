# Tools and open-source decisions (12 November 2026)

One line each: what we use it for, and when. "Not checked" means the repository could not be opened from the build
environment; the decision then rests on general knowledge and should be confirmed before use.

## Development tools (builder's machine and CI, never in production code)
| Tool | Decision | Notes |
| --- | --- | --- |
| Claude Code | Use | `CLAUDE.md` is the project memory. No project skills yet: write one only when the same multi-step job has been done three times. |
| anthropics/claude-code-action | Defer | Add automatic pull-request review after Phase 1, when there is a second pair of eyes worth saving. |
| supabase/agent-skills (MIT) | Use | `postgres-best-practices` for every migration session. |
| Supabase CLI | Use | Local stack, `db push`, branches. |
| Supabase MCP | Use, staging only, read-only, scoped to one project | `.mcp.json.example`. Schema changes go through migrations. |
| cloudflare/skills (Apache-2.0) | Use | Workers, Durable Objects, Queues guidance plus the Cloudflare MCP. |
| wrangler | Use | Already a dependency. |
| cloudflare/agents | Reject | A second conversation framework. Ours is one Durable Object per sender and it is tested. |
| gokapso/agent-plugins (MIT) | Use on staging after checking scopes | Three skills (integrate, automate, observe) and a remote MCP at api.kapso.ai/mcp. Connect it with a staging-project key that cannot send from the +961 numbers. |
| vitest | Use | Already the test runner. |
| PGlite | Use | Already runs the real migrations in tests. |
| gitleaks, osv-scanner | Use | In `.github/workflows/ci.yml`. |
| Playwright | Phase 3 | When the staff console exists. |
| msw | Reject for now | The gateway tests stub `fetch` in ten lines. |
| OWASP Cheat Sheets | Reference | Webhook signatures, SSRF (menu import), secrets. |

## Runtime libraries
| Library | Decision | Notes |
| --- | --- | --- |
| @kapso/whatsapp-cloud-api 0.4.0 (MIT, one dependency: zod; released 23 Oct 2026) | Adopt in Phase 4, inside `packages/wa` only | Its main entry uses `fetch` only, so it runs on Workers; the webhook helpers need Node crypto (`nodejs_compat` is on). Worth having for typed errors with a retry hint, template builders and Flows. Not adopted now: it is pre-1.0 and nothing can be proven against live Kapso yet. `gateway.ts` stays the only caller. Build plan 4.13. |
| supabase-js | Use | Already a dependency. |
| zod | Use | Already a dependency. |
| decimal.js, dinero.js | Reject | Money arithmetic happens in Postgres `numeric`. TypeScript only formats. |
| medici | Reject | A MongoDB ledger. Ours is Postgres double entry. |
| ERPNext | Reference | Chart-of-accounts and stock-valuation patterns for 2.7. Not deployed. |
| sharp | Reject on Workers | Native code. If images need resizing, use Cloudflare Images. |
| docling, PaddleOCR | Defer | Python services. The vision model already reads menus and labels. Revisit only if measured extraction accuracy on real Chouf menus is poor. |
| Open Food Facts API | Phase 5, as a lookup at intake | Database is ODbL (attribution and share-alike on the database). About 3,200 products tagged Lebanon. Staff confirm against the pack; we store our own confirmed record plus the source id, not a copy of their database. Get a lawyer's line on ODbL before storing bulk data. |
| USDA FoodData Central | Later | Public domain. Only for recipe nutrition, labelled an estimate. |
| PostGIS | Defer | Village-level zones do not need it. Add when zones become polygons. |
| OSRM, GraphHopper, VROOM, Nominatim | Defer | Self-hosted routing is for many riders. Travel times come from `scripts/build_travel_times.mjs` and then from our own measured deliveries. Never call the public demo servers from production. |
| Turf | Not needed | Distance is one SQL formula. |
| MapLibre | Phase 3, optional | A map of pins in the console. |
| Chatwoot, whatsapp-cloud-inbox, whatsapp-support-agent, flowso | Reference | The Kapso inbox is the human inbox. No second messaging system. |
| Sentry | Use, free tier | Task 0.8. Scrub message bodies and phone numbers before sending. |
| PostHog, OpenTelemetry | Defer | SQL reports on our own tables answer the pilot's questions. |

## Food-vision research code
Nutrition5k, FoodSAM, FoodCNN, plate-vision, vlm-food-benchmark: reference only. Licences of the last three were not checked.
None is installed. See the innovation review for why meal-photo calorie estimates are not part of the product.
