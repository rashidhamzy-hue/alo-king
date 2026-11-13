# Evaluation set

The 38 voice notes from the "Alo King" WhatsApp group are the acceptance test for language understanding.

1. Put the `.opus` files in `evals/voice_notes/audio/` (git-ignored: they contain names and addresses).
2. For each note, write the ground truth by hand in `evals/voice_notes/truth/<id>.json` using the shape in `example.json`.
3. `npm run eval` runs speech-to-text and the Concierge extraction on every note and scores:
   - item recall and precision (an invented item is a hard failure),
   - quantity accuracy,
   - modifier recall (no pickles, extra garlic, cut in half, bread type),
   - address fields (village, landmark, building, floor),
   - `change_for_usd`, pickup versus delivery, and merchant attribution.
4. A release needs item F1 of 0.90 or better and zero invented items. Every production miss becomes a new case.

## Transcript cases (run in CI)
`evals/voice_notes/cases/*.json` are voice notes written down as the speech provider returned them, with a duration, a
label saying whether the transcript is usable at all, and the hand-written truth. They hold no audio and no real names or
addresses, so they live in the repository. `evals/test/voice-cases.test.ts` checks they are well formed and that the
mechanical checks (`judge` in `packages/agents/src/stt.ts`) agree with each label. With an API key, `npm run eval` also
runs the Concierge's extraction on each transcript and scores it.

## Wording cases: neutral, factual, on the job (run in CI)
`evals/cases/neutral_and_food_facts.json` (1.10) and `evals/cases/money_guard.json` (1.5) hold
replies the output guard (`packages/agents/src/output-guard.ts`) must refuse or let through.
`evals/test/*.test.ts` run them on every push.

The same cases against the real model, which a person then grades on `must` / `must_not`:
```
ALO_LIVE_EVAL=1 ANTHROPIC_API_KEY=... MODEL=claude-haiku-5-5 npx vitest run evals/live
```
This goes through vitest because the Concierge imports its prompt as a `.md` module, which vitest bundles and plain `tsx`
does not; `npm run eval` (package.json) still points at `tsx evals/run.ts` and should be changed to the line above.
