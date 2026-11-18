<!-- Written by session FIX1 on 18 November 2026 (the report that used to go under HANDOFF, "Status"). -->

### FIX1: the Sentry fix, Khraibeh, Safa Chicken and the limits, 18 November 2026 (Sonnet 5.5); migration 0241
One pull request. No simulation and no live model call. Decisions: `docs/DECISIONS.md`, FIX1.

**Built (each with a failing test first, `test/db/fix1.test.ts`).**
1. **Sentry ALO-KING-GATEWAY-6** ("Could not find the function public.temperature_log_check without parameters in the schema cache", staging, 9 events on 18 November): the console Worker's two-minute run called the function with no arguments, and PostgREST finds a function by the argument names it is sent. `p_now` already had a default of `now()` in 0240; 0241 states it again (same body) for an environment that applied an earlier 0240, and the Worker now passes it (`apps/console/src/temperature-check.ts`, used by `worker.ts`). The test calls it exactly as the Worker does, through a stand-in that refuses a call without `p_now` as PostgREST does.
2. Khraibeh: mid zone, served (0241 only; the village seed is left as it is because SIM1's generated scenarios read it).
3. Safa Chicken listed (0241); the Food page counts 461; the tests that counted 460 follow.
4. `sim_monthly_cap_usd` 55 for 2026-11, default 10 (0241).
5. The capture page shrinks to 1600 px, JPEG 0.8.
6. `usage_size_check` and the weekly workflow step: a staff alert at 600 MB storage or 350 MB database (`settings.usage_alerts`).

**Not proven.** The workflow step runs only in GitHub (it needs the Supabase secrets): the first Monday run, or a manual run of `usage-check`, shows it. The Worker's fix is proven by the test and by Sentry going quiet after the next deploy (the issue is still open: resolve it once a deploy has run). The capture page's new size was not tried on a phone. `test/pg/*` (real Postgres) cannot start in the build container (it failed the same way before this session); 
**Founder actions:** none. Deploy staging after the merge (0241), then run `usage-check` once by hand to see the new step.
