# UX2b: the five staff pages beside the design reference (17 November 2026)

Ours: `ux2b-<page>-{390,1280}-{en,ar}`, from `SCREENS=<folder> npx vitest run test/screens/ux2b.test.ts` (the real pages over the real migrations, invented data: two riders (one with its
written terms on file, one holding cash and a drop to count), two payment screenshots to confirm, a refund, a new LBP rate and a cash-cap change each waiting for a second person, three
settings changes in the log, two label-day items read, a proposed picture and 282 proposed names). The pictures are stand-in drawings served for the fake media address, so the screens show where
a pack photo or a payment screenshot goes. The same run checks that nothing scrolls sideways at 390 px and that every control on the phone pages is at least 44 px tall and wide.
The reference: `ref-ops-*`, photographed from the founder's reference app (English only; copied from `docs/screens/ds2`, never code). Long pages are cut at the bottom.

| Page | Ours | The reference's screen |
|---|---|---|
| Approve: a name card (the default) | `ux2b-approve-…` | `ref-ops-approve-…` |
| Approve: a label reading (LB1's order; the tick that the person looked at the photo) | `ux2b-approve-labels-…` | the reference's allergens & halal card |
| Approve: a second approval (the two-person rule on the card) | `ux2b-approve-money-…` | the reference's prices card |
| Intake: the progress board, the steps to selling-requires-a-label, the pack check | `ux2b-intake-…` | `ref-ops-intake-…` |
| Intake: Photograph (LB1's label day, a picker's phone) | `ux2b-intake-photograph-…` | the reference's photograph step |
| Intake: Label approvals (the list view) | `ux2b-intake-approvals-…` | the reference's check step |
| Intake: Readiness (sellable, fact-complete, label-ready per template) | `ux2b-intake-readiness-…` | `ref-ops-intake-…` (its "N of 291 ready") |
| Money: the ledger | `ux2b-money-…` | `ref-ops-money-…` |
| Money: To confirm (the customer's screenshot beside what is expected) | `ux2b-money-confirm-…` | the reference's payment proofs |
| Money: Cash drops, by rider | `ux2b-money-drops-…` | the reference's safe count and cash |
| Money: Refunds | `ux2b-money-refunds-…` | the reference's refunds |
| Settings (admin) | `ux2b-settings-…` | `ref-ops-settings-…` |
| Riders (the roster) | `ux2b-riders-…` | `ref-ops-riders-…` |

What differs on purpose is in `docs/HANDOFF.md`, UX2b, "Not the same as the reference".
