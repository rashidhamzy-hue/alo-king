# Kapso webhook fixtures

Real payloads, fake people. Build plan 0.6: ten real payloads of each event type are saved here before any parser changes.

How they get here: send messages to the staging numbers, then run the `capture-kapso-fixtures` workflow. It reads what the
staging Worker stored in `wa_inbound_events`, replaces phone numbers, user ids, names and every URL with stable fakes
(`scripts/ci/export-kapso-fixtures.mjs`) and pushes the branch `fixtures/kapso`. Open a pull request from it.

Layout: `<event>/<message type>-NN.json`, each `{ line, event, body }`. Event types to cover: `whatsapp.message.received`
(text, audio, image, location, interactive button_reply, list_reply, and one with no phone number), `delivered`, `read`,
`failed`, `whatsapp.contact.marketing_preference_changed`. Also capture a click-to-WhatsApp message with `referral` (task 0.9).

Status (13 Nov, session A2): 75 fixtures built from REAL Kapso message objects (October traffic on the customer number, `source: "kapso-message-api"`),
by `scripts/fixtures/from-kapso-messages.mjs`: the message is real (people replaced, typed and spoken words replaced by synthetic Lebanese lines,
wamids replaced because a wamid encodes the sender's number); the envelope around it follows Kapso's documented v2 payload.
The contact events and `failed` are Kapso's documented examples (`source: "kapso-docs"`): no real one has happened yet.
Real webhook captures (`source: "webhook"`) still come from the workflow above once real messages reach the staging Worker; they sit beside these.
