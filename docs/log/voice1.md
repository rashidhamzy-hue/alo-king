# VOICE1: voice notes understood properly, and the catalogue's button (23 November 2026)

Session VOICE1. Decisions: `docs/DECISIONS.md`, "VOICE1, voice notes understood properly, 23 November 2026". Migration **0276**. No new
agent (invariant 21); no write by a model; prices only from the database; confirmation only by the customer's tap; Kabsi not touched.

## What happened
Staging, 23 November 10:34 UTC: the founder, a tester, said in a voice note that he wanted one whole chicken from Safa Chicken. Kapso's
transcript read «بدي أطلب من عنفطة Chicken Tin، جوج واحد، okay؟», and the bot answered «عنفطة مش متوفّر بعد على ألو كينغ».
1. Only Kapso's transcript had ever been read: `settings.stt.second_provider` was null, no ElevenLabs key was wired, and `readVoiceNote`
   was called without keyterms, so place and brand names were never biased.
2. An unknown place name was echoed back as "not on Alo King" (the planner's `merchant_not_onboarded` answer quotes the name as said).
3. Safa's whole chicken (فروج) is one of the 16 dishes rejected for showing a price range, so it could not be ordered even when understood.

## Built
1. **Our own transcription** (`packages/agents/src/scribe.ts`, `stt.ts`): ElevenLabs Scribe (`scribe_v2`) first, Kapso's transcript the
   fallback, `judge()` decides. Scribe is used only when the Worker holds `ELEVENLABS_API_KEY` (deploy-staging copies the repository secret
   into the Worker, only when it exists) and `settings.stt.primary_provider` names it (0276). Scribe failing, or the daily cap (USD 1)
   reached, never loses a note: Kapso's transcript is read and the reason is noted on the message.
2. **Keyterms on every note** (`stt_keyterms`, 0276): each place's name and other names (Safa Chicken, صفا، صفا تشيكن, …), everyday words
   (فروج، شاورما، كرتونة مي، ربطة خبز، ألو كينغ, …), the served villages, the most-ordered brands; at most 100 (above 100 Scribe bills every
   note at least 20 seconds).
3. **The provider and cost per note**: on `wa_messages.transcript.ours` (provider, seconds, keyterms, USD) beside Kapso's text and the one
   chosen, and one `model_costs` row (workflow `stt`) per note.
4. **Places** (`packages/agents/src/place-guess.ts`, `food.ts`, 0276): a place name we do not know is compared, by spelling, the other
   script and sound, with the places this customer may order from. Close: «🔎 *قصدك Safa Chicken؟*» with إيه / لا (a typed «ايه» works too);
   yes carries on with the order from that place. Nothing close, a tie, or "no": «🔎 *ما لقينا هالمحل على ألو كينغ*» and the places by name.
   A real place we know of (an LV1 listing) still gets the honest "not on Alo King yet". The name as heard is never repeated.
5. **Dishes not on sale** (0276 `food_match`): a rejected, waiting or unpriced dish of the place gets «⚠️ *ما فينا ناخد طلب «فروج» من Safa
   Chicken بعد*» and up to five of the place's dishes on sale (same section first) to tap. Never its price or the reason. «فروج» is never
   turned into «نص فروج» because the longer name is on sale.
6. **The catalogue's button**: the first-ever welcome, and in test mode a tester's first reply, is followed by WhatsApp's own "View catalog"
   message with one line in the customer's language; «بدي شوف الكتالوج», "show me the catalogue", «le catalogue» send it by code. The
   friends' message (`docs/log/test1.md`) now says: write «الكتالوج» or tap View catalog.
7. **Messages** in Arabic, English and French (`messages.food.placeGuess`, `placeUnknown`, `notOnSale`, `yesButton`, `noButton`,
   `catalogOffer`), checked by the CX2 rules and in the snapshots.
8. **The live check**: workflow `voice-check` (`scripts/qa/voice-check.mjs`). It never prints a transcript.
9. **CI's `test` job may run 45 minutes** (was 30): the full suite took 26 minutes on TEST1's last run and 29.5 on this PR's first full
   run, which passed every test (3640) and was then cancelled at the 30-minute limit.

## Eval cases (written before the fixes)
- `evals/voice_notes/cases/vn-voice1-a.json` to `-e.json`: the note's Kapso transcript, its clean version, «بدي تنين شاورما من صفا», an
  English note said as people speak, and a place that does not exist.
- `evals/cases/voice1_places.json`: the same five as flow cases, run by `test/db/voice1-places.test.ts` (15 tests) on an invented copy of
  the place (Safa Chicken's name and other names as on staging; an invented menu and prices).

## Tested (free)
- `test/db/voice1-places.test.ts`: the transcript of the 23 Nov note asks «قصدك Safa Chicken؟» and never says «عنفطة»; yes (button or typed)
  carries on with Safa's menu; no lists the places; a place that does not exist lists the places; a customer who is not a tester gets no
  place; the clean note says فروج can't be ordered yet and offers نص فروج, whose tap makes the card; «تنين شاورما» asks which shawarma; the
  English note makes the card at the database's price; a voice note is read by Scribe with Safa's names among at most 100 keyterms, the
  cost recorded; Scribe failing or over the cap leaves Kapso's transcript; the catalogue's button with the welcome (once), with a tester's
  first reply in test mode, and for the three ways of asking, with no model.
- `test/db/ordering-b3.test.ts` (the 1.7 voice tests) unchanged and green; the message rules and snapshots with the new messages.
- `npm run typecheck && npm test`: see "Results" below.

## What only a live account can prove
- ElevenLabs' answer for this audio (the `voice-check` workflow, below), and Meta's "View catalog" button on a real phone.

## Results
(Filled in at the end of the session.)

## The founder's note: how voice notes are read now
- When a customer sends a voice note, we now transcribe it ourselves with **ElevenLabs Scribe**, telling it the words to expect: the
  places' names and their other names («صفا», "Safa Chicken"), everyday words (فروج، شاورما، كرتونة مي، ربطة خبز), our villages and the
  brands people order most. Kapso's own transcript stays as the backup: if ours fails or sounds broken, Kapso's is used.
- If a place name still comes out wrong, the bot no longer repeats it. It asks «قصدك صفا تشيكن؟» with two buttons, or, when nothing is
  close, lists the places you can order from.
- If a dish is on the menu but not on sale (like Safa's whole chicken, waiting for its price), the bot says so and offers that place's
  dishes that can be ordered.
- **Cost**: USD 0.20 per hour of audio plus 0.05 for the words we give it: **about 0.42 US cents a minute**; a 10-second note costs about
  0.07 cents. Capped at USD 1 a day (about 4 hours of notes); above it, Kapso's transcript alone. Each note's cost is recorded.
- **Privacy**: the audio goes to ElevenLabs to be transcribed (it already did, through Kapso). Before real customers, the privacy notice
  should name ElevenLabs as the processor of voice notes: a wording for you and the lawyer.
