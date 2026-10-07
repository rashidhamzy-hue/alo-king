# Human-handoff inbox: assessment and deployment plan

Question: can [`gokapso/whatsapp-cloud-inbox`](https://github.com/gokapso/whatsapp-cloud-inbox) be our human-handoff inbox (customer types "talk to a person" → staff reply from a web inbox)? Nothing is deployed yet.

## Verdict
**Yes as a base, but not as-is.** It does the job functionally and is safe to host only once we add a login in front of it.

## What it is (read from the repo, MIT, Next.js 15.5, React 19, TypeScript, Tailwind)
- WhatsApp-Web-style inbox on the Kapso Meta proxy: conversation list, thread view, send text / media / interactive buttons / templates, 24-hour-window enforcement, failed-message indicators, auto-polling (no webhook needed).
- Server env: `KAPSO_API_KEY`, `WHATSAPP_API_URL` (default `https://api.kapso.ai/meta/whatsapp`), `KAPSO_API_BASE_URL`, `PHONE_NUMBER_ID`, `WABA_ID`. None are `NEXT_PUBLIC_*`, so the key stays server-side.
- Routes: `/api/conversations`, `/api/messages`, `/api/media/[mediaId]`, `/api/phone-numbers`, `/api/settings`, `/api/templates`.

## Security finding (blocking)
There is **no authentication at all**: no `middleware.ts` (404 at `/middleware.ts` and `/src/middleware.ts`), no auth library in `package.json`, and the route handlers do no session check (`/api/conversations` returns every conversation with names, phone numbers and last messages; `/api/settings` lets any caller change the selected number). The README's only "auth" is an HTTP-only cookie holding the selected phone number. Anyone who finds the URL could read all customer chats and **send messages as Alo King using our Kapso key**. Customer names, numbers, addresses and orders are personal data (Law 81/2018), so it must not be reachable without login.

## Other gaps for our use
1. **Bot and human would both answer.** Inbound messages still hit `kapso-brain`. We need flow item 5: a handoff flag (`customers.handoff_until`) that makes the bot stay silent while a human has the chat, plus an admin alert with a deep link to the thread.
2. **Only the production number**, which is currently `LIMITED` by Meta until the display name is approved (see health check). Free-form replies need the customer's 24h window open (true right after they type "talk to a person").
3. Single shared API key for everyone; no per-agent identity or audit log. Fine for 1-3 staff, not more.
4. It shows **all** conversations on the number, not just handoffs. Acceptable only for trusted staff.
5. Early project (v0.1.0, ~26 commits): pin a commit, review updates before merging.

## Plan
1. **Fork** to our org (`rashidhamzy-hue/alo-king-inbox`), pin the commit we reviewed.
2. **Add login** (one small PR to the fork, before first deploy), both layers:
   - `middleware.ts` matching every route including `/api/*`: requires a Supabase Auth session (same project `hnjkietmwvkgbyrcnweq`, publishable key only) whose email is in `INBOX_ALLOWED_EMAILS`; otherwise redirect to a login page / 401 for API calls. Fail closed if the env var is empty.
   - Vercel Deployment Protection as a second lock (see below).
3. **Pin config** in env (`PHONE_NUMBER_ID`, `WABA_ID`) and remove/disable the `/api/settings` PUT so the number can't be switched from the browser.
4. **Deploy** to Vercel (steps below), custom domain `inbox.<our domain>`, HTTPS only.
5. **Wire handoff (flow item 5 in this repo):** `kapso-brain` writes `handoff_log`, sets `handoff_until` (e.g. 2h, extended on each human message), stays silent for that customer, and messages `ADMIN_WHATSAPP_PHONE` "Customer …34 wants a person: <inbox link>". A "Hand back to bot" action clears the flag (or it expires). The admin alert is a service message (inside the 24h window or an approved utility template), never a promotion; the link carries customer identifiers, so it only opens behind the login.
6. **Verify**: unauthenticated `curl https://inbox…/api/conversations` must return 401/redirect; logged-in allowed user sees threads; a disallowed Supabase user gets 403; reply from the inbox arrives on a test phone; bot stays silent during handoff and resumes after.

## Exact steps for you in Vercel (do these after I've opened the fork PR with the login)
1. GitHub: fork `gokapso/whatsapp-cloud-inbox` into `rashidhamzy-hue/alo-king-inbox` (or tell me and I'll do it). Keep it **private**.
2. Vercel → *Add New… → Project* → import `alo-king-inbox`. Framework preset: Next.js (auto). Root directory: repo root. Don't click deploy yet.
3. *Environment Variables* (Production + Preview), mark secrets **Sensitive**:
   - `KAPSO_API_KEY` = the Kapso project API key (paste in Vercel only; never in chat)
   - `KAPSO_API_BASE_URL` = `https://api.kapso.ai`
   - `WHATSAPP_API_URL` = `https://api.kapso.ai/meta/whatsapp`
   - `PHONE_NUMBER_ID` = `1384772384720496`
   - `WABA_ID` = `3060015327535526`
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://hnjkietmwvkgbyrcnweq.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = the project's publishable key (same one the frontend uses)
   - `INBOX_ALLOWED_EMAILS` = comma-separated staff emails (start with yours)
4. Click **Deploy**.
5. *Settings → Deployment Protection*: enable **Vercel Authentication** for *All Deployments* (production included; this needs a plan that offers it, check Settings → Deployment Protection) or Password Protection if that is what your plan offers. This is the second lock behind the app login.
6. *Settings → Domains*: add `inbox.<your domain>`, add the DNS record Vercel shows, wait for the certificate.
7. In Supabase Dashboard → Authentication → URL Configuration, add `https://inbox.<your domain>` to Site URL / redirect allow-list; create your staff user(s) there (email + password or magic link).
8. Tell me the URL; I'll run the verification list in step 6 above (the 401 check needs no login).
9. Rotate: if the Kapso key was ever pasted anywhere other than Vercel, rotate it in Kapso and update Supabase + Vercel.
