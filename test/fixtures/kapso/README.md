# Kapso webhook fixtures

Real payloads, fake people. Build plan 0.6: ten real payloads of each event type are saved here before any parser changes.

How they get here: send messages to the staging numbers, then run the `capture-kapso-fixtures` workflow. It reads what the
staging Worker stored in `wa_inbound_events`, replaces phone numbers, user ids, names and every URL with stable fakes
(`scripts/ci/export-kapso-fixtures.mjs`) and pushes the branch `fixtures/kapso`. Open a pull request from it.

Layout: `<event>/<message type>-NN.json`, each `{ line, event, body }`. Event types to cover: `whatsapp.message.received`
(text, audio, image, location, interactive button_reply, list_reply, and one with no phone number), `delivered`, `read`,
`failed`, `whatsapp.contact.marketing_preference_changed`. Also capture a click-to-WhatsApp message with `referral` (task 0.9).

Status: tooling written and tested on a synthetic payload. **No real payload is saved yet**: that needs real messages on the staging numbers.
