import { describe, expect, it } from "vitest";
import { handleOnboarding, readOnboardingInbound, type OnboardingDeps } from "./onboarding";
import { checkInteractive } from "../../_shared/meta-limits";
import { guessLang, isJoinIntent, parseOnboardingTap } from "../../_shared/onboarding-cards";

const V = "20000000-0000-0000-0000-0000000000d1";
const C = "60000000-0000-0000-0000-000000000001";
const ME = "+96176555001";

function harness(rpcs: Record<string, (a: any) => any> = {}, opts: { voice?: boolean } = {}) {
  let session: any = null;
  const calls: { fn: string; args: any }[] = [];
  const sent: any[] = [];
  const rpc = async (fn: string, args: any) => {
    calls.push({ fn, args });
    if (rpcs[fn]) return rpcs[fn](args);
    if (fn === "onboarding_session_get") return session;
    if (fn === "onboarding_session_set") {
      session = args.p_step ? { step: args.p_step, data: args.p_data, lang: args.p_lang } : null;
      return null;
    }
    return null;
  };
  const deps: OnboardingDeps = {
    rpc,
    send: async (p) => {
      sent.push(p);
      return { ok: true, id: "wamid" };
    },
    voiceCode: opts.voice ? async () => ({ ok: true, id: "CA1" }) : null,
  };
  const msg = (m: any) =>
    readOnboardingInbound({ message: { id: `w${calls.length}`, from: ME.slice(1), ...m } })!;
  return {
    deps,
    calls,
    sent,
    msg,
    of: (fn: string) => calls.filter((c) => c.fn === fn),
    get session() {
      return session;
    },
  };
}
const txt = (body: string) => ({ type: "text", text: { body } });
const tap = (id: string) => ({ type: "interactive", interactive: { button_reply: { id } } });

describe("onboarding intents (zero model calls)", () => {
  it("recognises join intents in four languages and leaves orders alone", () => {
    for (const s of [
      "join Alo King",
      "I want to claim my restaurant",
      "register my shop",
      "سجّل محلي",
      "بدي سجل محلي عندكن",
      "Je veux inscrire mon commerce",
      "sajjel ma7ale",
    ])
      expect(isJoinIntent(s), s).toBe(true);
    for (const s of [
      "بدي شاورما",
      "2 manakish zaatar",
      "where is my order",
      "un café svp",
      "I want to claim a refund",
      "join",
      "انضم",
      "stop",
    ])
      expect(isJoinIntent(s), s).toBe(false);
  });
  it("guesses the language", () => {
    expect(guessLang("سجل محلي")).toBe("ar");
    expect(guessLang("je veux inscrire mon commerce")).toBe("fr");
    expect(guessLang("join")).toBe("en");
  });
  it("parses only well-formed taps", () => {
    expect(parseOnboardingTap(`CLM|V|${V}`)).toEqual({ a: "vendor", vendorId: V });
    expect(parseOnboardingTap("CLM|T|restaurant")).toEqual({ a: "type", type: "restaurant" });
    expect(parseOnboardingTap("CLM|T|casino")).toBeNull();
    expect(parseOnboardingTap(`CLM|V|${V}x`)).toBeNull();
    expect(parseOnboardingTap(`CLM|LOK|${C}`)).toEqual({ a: "recover", claimId: C, approve: true });
  });
});

describe("handleOnboarding", () => {
  it("is not involved when there is no intent, tap or session", async () => {
    const h = harness();
    expect(await handleOnboarding(h.deps, h.msg(txt("بدي شاورما")))).toBe(false);
    expect(h.sent).toHaveLength(0);
  });

  it("A: name → list → tap → code to the shop's own number → typed code approves", async () => {
    const h = harness({
      vendor_claim_search: () => [
        { vendor_id: V, name: "مشاوي أبو كليم", town: "بعقلين", claim_status: "unclaimed" },
      ],
      claim_start: () => ({
        claim_id: C,
        case: "A",
        status: "code_sent",
        phone_tail: "…56",
        send: { channel: "whatsapp", to: "+96170123456", code: "482913" },
      }),
      claim_verify_code: (a) =>
        a.p_code === "482913" ? { status: "approved" } : { status: "wrong_code", left: 4 },
    });
    await handleOnboarding(h.deps, h.msg(txt("سجّل محلي")));
    expect(h.session).toBeNull();
    expect(h.sent.at(-1).interactive.action.buttons[0].reply.id).toBe("CLM|JOIN");
    await handleOnboarding(h.deps, h.msg(tap("CLM|JOIN")));
    expect(h.session.step).toBe("ask_name");
    await handleOnboarding(h.deps, h.msg(txt("ابو كليم")));
    expect(h.sent.at(-2).interactive.type).toBe("list");
    await handleOnboarding(h.deps, h.msg(tap(`CLM|V|${V}`)));
    const code = h.sent.find((p) => p.to === "96170123456");
    expect(code.text.body).toContain("482913");
    const card = h.sent.at(-1);
    expect(card.to).toBe(ME.slice(1));
    expect(JSON.stringify(card)).not.toContain("482913");
    expect(JSON.stringify(card)).toContain("…56");
    expect(h.session.step).toBe("code");
    await handleOnboarding(h.deps, h.msg(txt("111111")));
    expect(h.sent.at(-1).text.body).toMatch(/4/);
    await handleOnboarding(h.deps, h.msg(txt("٤٨٢٩١٣")));
    expect(h.of("claim_verify_code").at(-1)!.args.p_code).toBe("482913");
    expect(h.session).toBeNull();
    for (const p of h.sent) expect(checkInteractive(p)).toEqual([]);
  });

  it("B without a voice provider falls back to documents instead of pretending", async () => {
    const h = harness({
      claim_start: () => ({
        claim_id: C,
        case: "B",
        status: "code_sent",
        phone_tail: "…11",
        send: { channel: "voice", to: "+9615333333", code: "123456" },
      }),
      claim_use_documents: () => ({
        status: "awaiting_documents",
        claim_id: C,
        missing: ["registration", "sign_photo"],
      }),
    });
    await handleOnboarding(h.deps, h.msg(tap(`CLM|V|${V}`)));
    expect(h.of("claim_use_documents")).toHaveLength(1);
    expect(h.session.step).toBe("docs");
    expect(h.sent.at(-1).text.body).toMatch(/registration|السجل/i);
  });

  it("B with a voice provider calls the landline", async () => {
    const h = harness(
      {
        claim_start: () => ({
          claim_id: C,
          case: "B",
          status: "code_sent",
          phone_tail: "…33",
          send: { channel: "voice", to: "+9615333333", code: "123456" },
        }),
      },
      { voice: true },
    );
    await handleOnboarding(h.deps, h.msg({ ...tap(`CLM|V|${V}`) }));
    expect(h.session.step).toBe("code");
    expect(JSON.stringify(h.sent.at(-1))).toMatch(/…33/);
  });

  it("C: documents one at a time, then review", async () => {
    let n = 0;
    const h = harness({
      claim_start: () => ({
        claim_id: C,
        case: "C",
        status: "awaiting_documents",
        missing: ["registration", "sign_photo"],
      }),
      claim_add_document: () =>
        ++n === 1
          ? { status: "awaiting_documents", claim_id: C, missing: ["sign_photo"] }
          : { status: "pending_review", claim_id: C },
    });
    await handleOnboarding(h.deps, h.msg(tap(`CLM|V|${V}`)));
    await handleOnboarding(h.deps, h.msg(txt("hello")));
    expect(h.of("claim_add_document")).toHaveLength(0);
    await handleOnboarding(
      h.deps,
      h.msg({ type: "image", image: { id: "MEDIA1", mime_type: "image/jpeg" } }),
    );
    expect(h.of("claim_add_document")[0].args).toMatchObject({
      p_kind: "registration",
      p_media_ref: "wa-media:MEDIA1",
    });
    await handleOnboarding(
      h.deps,
      h.msg({ type: "document", document: { id: "MEDIA2", mime_type: "application/pdf" } }),
    );
    expect(h.of("claim_add_document")[1].args.p_kind).toBe("sign_photo");
    expect(h.session).toBeNull();
  });

  it("E: registration asks type, shop or home, pin, then documents", async () => {
    const h = harness({
      vendor_claim_search: () => [],
      vendor_register: (a) => ({
        status: "awaiting_documents",
        claim_id: C,
        case: "E",
        missing: a.p_home_kitchen ? ["registration"] : ["registration", "sign_photo"],
      }),
    });
    await handleOnboarding(h.deps, h.msg(txt("join Alo King")));
    await handleOnboarding(h.deps, h.msg(tap("CLM|JOIN")));
    await handleOnboarding(h.deps, h.msg(txt("Um Ali Kitchen")));
    expect(h.sent.at(-1).interactive.action.buttons[0].reply.id).toBe("CLM|NEW");
    await handleOnboarding(h.deps, h.msg(tap("CLM|NEW")));
    expect(h.sent.at(-1).interactive.type).toBe("list");
    await handleOnboarding(
      h.deps,
      h.msg({ type: "interactive", interactive: { list_reply: { id: "CLM|T|restaurant" } } }),
    );
    await handleOnboarding(h.deps, h.msg(tap("CLM|H|1")));
    expect(h.sent.at(-1).interactive.type).toBe("location_request_message");
    await handleOnboarding(
      h.deps,
      h.msg({ type: "location", location: { latitude: 33.68, longitude: 35.58 } }),
    );
    expect(h.of("vendor_register")[0].args).toMatchObject({
      p_name_en: "Um Ali Kitchen",
      p_business_type: "restaurant",
      p_home_kitchen: true,
      p_lat: 33.68,
    });
    expect(h.sent.at(-1).interactive.action.buttons[0].reply.id).toBe(`CLM|NOREG|${C}`);
    for (const p of h.sent) expect(checkInteractive(p)).toEqual([]);
  });

  it("cancel ends the session at any step", async () => {
    const h = harness();
    await handleOnboarding(h.deps, h.msg(tap("CLM|JOIN")));
    expect(h.session.step).toBe("ask_name");
    await handleOnboarding(h.deps, h.msg(txt("إلغاء")));
    expect(h.session).toBeNull();
  });

  it("objection and lost-phone taps go to the server with the sender's number", async () => {
    const h = harness({
      claim_object: () => ({ status: "objected" }),
      member_recover_decide: () => ({ status: "approved" }),
    });
    expect(await handleOnboarding(h.deps, h.msg(tap(`CLM|OBJ|${C}`)))).toBe(true);
    expect(h.of("claim_object")[0].args).toEqual({ p_phone: ME, p_claim_id: C });
    await handleOnboarding(h.deps, h.msg(tap(`CLM|LOK|${C}`)));
    expect(h.of("member_recover_decide")[0].args).toEqual({
      p_phone: ME,
      p_claim_id: C,
      p_approve: true,
    });
  });

  it("STOP during onboarding is not swallowed as a cancel", async () => {
    const h = harness({ vendor_claim_search: () => [] });
    await handleOnboarding(h.deps, h.msg(tap("CLM|JOIN")));
    await handleOnboarding(h.deps, h.msg(txt("STOP")));
    expect(h.session).not.toBeNull();
  });

  it("tapping the business again while the code is valid asks for the same code", async () => {
    const h = harness({
      claim_start: () => ({
        claim_id: C,
        case: "A",
        status: "code_sent",
        channel: "whatsapp",
        phone_tail: "…56",
      }),
    });
    await handleOnboarding(h.deps, h.msg(tap(`CLM|V|${V}`)));
    expect(h.of("claim_use_documents")).toHaveLength(0);
    expect(h.session.step).toBe("code");
    expect(JSON.stringify(h.sent.at(-1))).toContain("…56");
  });

  it("copies a document to storage when it can, and keeps the WhatsApp reference when it cannot", async () => {
    const h = harness({
      claim_start: () => ({
        claim_id: C,
        case: "C",
        status: "awaiting_documents",
        missing: ["registration", "sign_photo"],
      }),
      claim_add_document: () => ({
        status: "awaiting_documents",
        claim_id: C,
        missing: ["sign_photo"],
      }),
    });
    h.deps.storeDocument = async (m, claim) =>
      m.id === "OK" ? `storage:claim-documents/${claim}/x.jpg` : null;
    await handleOnboarding(h.deps, h.msg(tap(`CLM|V|${V}`)));
    await handleOnboarding(
      h.deps,
      h.msg({ type: "image", image: { id: "OK", mime_type: "image/jpeg" } }),
    );
    expect(h.of("claim_add_document")[0].args.p_media_ref).toBe(
      `storage:claim-documents/${C}/x.jpg`,
    );
    await handleOnboarding(
      h.deps,
      h.msg({ type: "image", image: { id: "NO", mime_type: "image/jpeg" } }),
    );
    expect(h.of("claim_add_document")[1].args.p_media_ref).toBe("wa-media:NO");
  });
});
