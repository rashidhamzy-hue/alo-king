// SIM1: the simulated customer. Sonnet 5.5 plays one persona with one goal. It sees only what the customer's phone shows (the
// shop's texts, buttons and list rows, the location button) and answers with one action: a text, a short burst of texts, a tap,
// a location pin, a voice note, or done. A voice note is what the customer says aloud; code turns it into a noisy transcript in
// the shape the speech provider returns (Kapso's message.kapso.transcript.text), so voice is tested at transcript level only.
import type Anthropic from "@anthropic-ai/sdk";
import type { ModelClient } from "../../packages/agents/src/concierge";
import type { BotMsg } from "./checks";
import { sonnet, type Features } from "./call";
import { hash, rng } from "./rng";
import { langNote, type Scenario } from "./scenarios";

export interface CustomerMove {
  action: "text" | "texts" | "tap" | "pin" | "voice" | "done";
  text: string | null; texts: string[] | null; option: string | null;
  goal: "in_progress" | "reached" | "impossible";
}

/** The shared instructions, the same for every conversation, so the prompt cache serves them to all 500. */
export const CUSTOMER_SYSTEM = `You are role-playing ONE customer of a small grocery delivery service that works on WhatsApp in the Chouf, Lebanon.
This is a test of the shop's assistant. You see only what a customer's phone shows: the shop's text messages, its buttons, its list rows, and its "send location" button. You do not know how the shop works inside.

How you answer: one JSON object, nothing else, with these fields:
- "action": one of "text", "texts", "tap", "pin", "voice", "done".
  - "text": you type one message. Put it in "text".
  - "texts": you send two or three short messages one after another, quickly (a burst). Put them in "texts".
  - "tap": you tap a button or a list row the shop sent. Put its reference (for example "b4") in "option", exactly as shown in square brackets. You can only tap options that were shown to you.
  - "pin": you send your WhatsApp location pin (your phone sends the real coordinates; you write nothing).
  - "voice": you record a voice note. Put in "text" exactly what you say aloud, as spoken words (numbers as you would say them).
  - "done": you stop writing (your goal is reached, or you give up). Use it as soon as there is nothing left to do.
- "text", "texts", "option": null when not used by your action.
- "goal": "in_progress", "reached" (what you came for is done) or "impossible" (it cannot be done here).

How you behave:
- Write like a real Lebanese customer in the language you are given: short, natural, casual, with the small mistakes people make. No formal Arabic unless your language says so. Never explain that you are testing.
- Follow your goal and your persona. Do not add requests that are not in your goal. Do not invent product codes.
- Answer what the shop asks. If the shop offers choices as buttons or a list, you usually tap one. If it asks where to deliver and your goal does not say otherwise, send a pin.
- Confirm an order ONLY by tapping the shop's confirm button on the order card, and only when the card is right for your goal. Never type "confirm" instead, unless your goal tells you to.
- If the card is wrong (wrong product, wrong quantity, missing item), say so in words or use its edit button.
- Never give a real person's name, phone number or address. If asked for a name, say "Sim". If asked for a phone number, say it is the number you are writing from. If asked for building and floor, invent simple ones ("the white building, second floor").
- When the shop says a person will take over or call you, you may still write: follow your goal about follow-up messages.
- Keep messages short: most customers write one line. Never more than three short lines.
- Stop with "done" when your goal is reached (for an order: after you tapped confirm and got the confirmation), when the shop clearly cannot help, or when you are told to stop.

Lebanese language notes (for writing naturally):
- Lebanese Arabic in Arabic script: بدي، عطيني، ابعتلي، كيلو، ربطة خبز، قنينة، علبة، شو، وين، أيمتى، هلق، بكرا، لو سمحت، يعطيك العافية، مرسي. Spoken forms, not Modern Standard Arabic.
- Arabizi (Lebanese in Latin letters): 2 = ء, 3 = ع, 5 = خ, 7 = ح, 8 = غ. "baddi", "3tine", "ba3tline", "kilo", "rabtet khebez", "2annine", "3elbe", "shu", "wen", "emta", "halla2", "bokra", "merci", "yslamo".
- Lebanese often mix English and French words into Arabic ("please", "merci", "ok", "bonjour", "ça va").
- Lebanese French and English are simple and direct; prices are thought of in dollars; lira (LBP) is also used.`;

const CUSTOMER_SCHEMA: Record<string, unknown> = {
  type: "object", additionalProperties: false,
  properties: {
    action: { type: "string", enum: ["text", "texts", "tap", "pin", "voice", "done"] },
    text: { anyOf: [{ type: "string" }, { type: "null" }] },
    texts: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
    option: { anyOf: [{ type: "string" }, { type: "null" }] },
    goal: { type: "string", enum: ["in_progress", "reached", "impossible"] },
  },
  required: ["action", "text", "texts", "option", "goal"],
};

export function scenarioPrompt(s: Scenario): string {
  const voice = s.voice ? "\n- You like voice notes: send your first real request as a voice note (action \"voice\"), and you may send more." : "";
  const burst = s.burst ? "\n- You type in bursts: send your first request as two or three short messages at once (action \"texts\")." : "";
  const pin = s.pin === "refuse" ? "\n- You cannot send a location pin (your phone's location is off): never use action \"pin\"." : "";
  return `Your persona: ${s.persona}.
Your language: ${langNote(s.lang)}. Write every message in it.
You live in ${s.village.name_en} (${s.village.name_ar}), in the Chouf.${s.clock === "night" ? "\nIt is the middle of the night when you start (about 2 am)." : ""}
Your goal: ${s.goal}
You have at most ${s.max_turns} messages in total.${voice}${burst}${pin}
Examples of how customers write in your language (style only; their content is not yours):
${s.style.map((x) => `- ${x}`).join("\n")}`;
}

/** What the customer's phone shows, as text for the simulator: each message, its buttons and list rows with the tap references. */
export function renderForCustomer(msgs: BotMsg[]): string {
  if (!msgs.length) return "(The shop sent nothing.)";
  return msgs.map((m) => {
    const opts = m.options.map((o) => `  [${o.key ?? "?"}] ${o.title}${o.description ? ` - ${o.description}` : ""}`).join("\n");
    const kind = m.kind === "buttons" ? "Buttons:" : m.kind === "list" ? `List "${m.button ?? "Options"}":` : "";
    const loc = m.kind === "location_request" ? "\n  [a \"Send location\" button: answer with action \"pin\" to send your location]" : "";
    return `${m.text}${opts ? `\n${kind}\n${opts}` : ""}${loc}`;
  }).join("\n---\n");
}

export function parseMove(text: string): CustomerMove | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as Partial<CustomerMove>;
    if (!j.action || !["text", "texts", "tap", "pin", "voice", "done"].includes(j.action)) return null;
    return { action: j.action, text: j.text ?? null, texts: j.texts ?? null, option: j.option ?? null, goal: j.goal ?? "in_progress" };
  } catch { return null; }
}

/** One conversation's customer: keeps its own history (the shop's messages as user turns, its moves as assistant turns). */
export class Customer {
  readonly history: Anthropic.MessageParam[] = [];
  constructor(private client: ModelClient, private model: string, readonly scenario: Scenario, private features: Features) {}

  async next(shop: string, note?: string): Promise<CustomerMove> {
    this.history.push({ role: "user", content: `${shop}${note ? `\n\n(${note})` : ""}\n\nYour next action, as JSON:` });
    const text = await sonnet(this.client, this.features, { model: this.model, max_tokens: 600, effort: "low", schema: CUSTOMER_SCHEMA,
      system: [{ type: "text", text: CUSTOMER_SYSTEM, cache_control: { type: "ephemeral" } }, { type: "text", text: scenarioPrompt(this.scenario) }],
      messages: this.history });
    const move = parseMove(text) ?? { action: "done" as const, text: null, texts: null, option: null, goal: "impossible" as const };
    this.history.push({ role: "assistant", content: JSON.stringify(move) });
    return move;
  }
}

// ---------- voice: what was said, as a speech provider returns it ----------
const FILLERS: Record<string, string[]> = { ar: ["يعني", "اممم", "ايه"], arabizi: ["ya3ne", "emmm", "eh"], en: ["um", "uh", "like"], fr: ["euh", "bah", "genre"], mixed: ["ya3ne", "euh", "um"] };
/** A seeded, speech-to-text-like transcript: no punctuation, lower case, a filler, a dropped or doubled word, Arabic letters folded. */
export function noisyTranscript(said: string, seed: number, lang: string): string {
  const r = rng(hash(`${seed}:voice:${said}`));
  let words = said.replace(/[.,!?؟،:;"'()«»\-]/g, " ").split(/\s+/).filter(Boolean).map((w) => w.toLowerCase());
  if (words.length > 3 && r() < 0.3) words.splice(1 + Math.floor(r() * (words.length - 1)), 1);
  if (words.length > 2 && r() < 0.2) { const i = Math.floor(r() * words.length); words.splice(i, 0, words[i]!); }
  if (r() < 0.6) words.splice(Math.floor(r() * (words.length + 1)), 0, (FILLERS[lang] ?? FILLERS.ar!)[Math.floor(r() * 3)]!);
  if (words.length > 4 && r() < 0.15) { const i = Math.floor(r() * (words.length - 1)); words.splice(i, 2, words[i]! + words[i + 1]!); }
  let text = words.join(" ");
  if (/[؀-ۿ]/.test(text)) {
    text = text.replace(/[ً-ْ]/g, "");
    if (r() < 0.5) text = text.replace(/[أإآ]/g, "ا");
    if (r() < 0.4) text = text.replace(/ة(\s|$)/g, "ه$1");
    if (r() < 0.3) text = text.replace(/ى(\s|$)/g, "ي$1");
  }
  return text;
}
export const voiceSeconds = (said: string) => Math.max(2, Math.round(said.split(/\s+/).length * 0.45 + 1.5));
