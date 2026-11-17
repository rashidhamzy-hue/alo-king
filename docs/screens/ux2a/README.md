# UX2a: the six staff pages beside the design reference (17 November 2026)

Ours: `ux2a-<page>-{390,1280}-{en,ar}`, from `SCREENS=<folder> npx vitest run test/screens/ux2a.test.ts` (the real pages over the real migrations, invented data:
two riders, one holding cash; orders at every stage, one late, one gift order with a handover code; three cases at 2, 7 and 17 minutes; one item out, one low).
The same run checks that nothing scrolls sideways at 390 px and that every control on the phone pages is at least 44 px tall and wide.
The reference: `ref-ops-*`, photographed from the founder's reference app (English only; copied from `docs/screens/ds2`, never code).
Long pages are cut at the bottom.

| Page | Ours | The reference's screen |
|---|---|---|
| Today | `ux2a-today-…` | `ref-ops-today-…` |
| Inbox | `ux2a-inbox-…` | `ref-ops-inbox-…` |
| Orders (the list, with the drawer open at 1280 px) | `ux2a-orders-…` | `ref-ops-orders-…` |
| One order as a page (the drawer's body, the phone's way in) | `ux2a-order-…` | the reference's orders drawer |
| Pick: the queue | `ux2a-pick-…` | `ref-ops-pick-…` |
| Pick: one order in the runner | `ux2a-pick-runner-…` | the reference's runner |
| Dispatch | `ux2a-dispatch-…` | `ref-ops-dispatch-…` |
| Stock | `ux2a-stock-…` | `ref-ops-stock-…` |

What differs on purpose is in `docs/HANDOFF.md`, UX2a, "Not the same as the reference".
