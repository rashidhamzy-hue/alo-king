<!-- Moved from docs/HANDOFF.md, "Status", on 18 November 2026 by session DOC2. The text below is unchanged; links to images under docs/screens/ no longer resolve (the images are in the private screens bucket; the console's Screens page lists them). -->

### AR1: the Arabic read applied, 16 November 2026 (Sonnet 5.5); migration 0221

**Arabic read by a person: done, 16 November.** The founder read every unread line with the planning chat (CX1, B1b, B1c, D4b, PD1, SR1, LB1, LD1);
every row of `docs/ARABIC_REVIEW.md` is marked "RA 16 Nov" and the gate A item "Arabic strings read by a person" is met.
- **Changed in `packages/agents/src/messages/ar.ts`:** `cx.privacy` (and so `cx.welcome`), `cx.needsNote`, `cx.pickupOff`, `cx.handoverCode` and
  `ops.codeLockedAlert` (السائق becomes الدليفري), `ops.codeOk`, `cx.noteSet`, `noOpenRepeat` and `repeatOffer` (same words), `honest.notCarried`,
  `honest.cannotConfirm`, `honest.fits`, `honest.noneFits`, `honest.closeFits`, `built.dish` («لـ{n} أشخاص»), «سناكس» in `built.lunchbox`.
- **Privacy wording.** The new `cx.privacy` is what `claim_welcome` stores from now on in `customer_welcomes.privacy_wording`; rows already stored keep
  the words the customer was shown (nothing was rewritten).
- **Peanuts are «فستق عبيد».** `honest.ts` and `search.ts` word lists, the reading step (`packages/search/src/reading.ts`: «فستق عبيد» listed by name;
  it was already caught by «فستق», and «فول سوداني» is still understood when a customer says it) and migration **0221**
  (`food_attributes.name_ar` for `peanuts`, the only wording that lived in SQL). The website's `fields.ts` holds no allergen word, so nothing changed there.
  Product names in `data/proposals` and migration 0110 keep the printed name; they are names, not word lists.
- **Console:** LB1's slot help says «مسبّبات الحساسية» (`capture.ts`).
- **Tested:** `arabic-review.test.ts` and the message-rule tests pass with the new wording, the snapshot `messages.ar.md` was updated on purpose, `peanut-word-ar1.test.ts` pins the peanut word. The PD1 eval case expects the new honest answer.
- **Not done / not proven:** no simulation and no live model call (rule 12.4); the English and French lines are unchanged. «أشخاص» reads oddly for 1 or 2 people
  (the founder's wording, applied as written); 0221 is applied only in the test database until the next staging deploy.
