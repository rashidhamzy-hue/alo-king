import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { fmt } from "@/lib/site";
import {
  claimStatus,
  startClaim,
  toE164,
  switchToPapers,
  verifyCode,
  type CallResult,
  type ClaimBusiness,
  type ClaimState,
} from "@/lib/site-claim";
import { useSite } from "../context";
import { DocsStep } from "./DocsStep";
import { CheckRow, Field, focusFirstError, Notice, PhoneField, Steps, TextInput } from "./ui";
import { withLinks } from "./withLinks";

type Stage =
  | { k: "details" }
  | { k: "code"; channel: "whatsapp" | "voice"; tail: string; left?: number; expired?: boolean }
  | { k: "docs"; missing: string[]; notice?: "contested" | "sale" | "undelivered" }
  | { k: "done"; outcome: "approved" | "review" | "waitlist" }
  | { k: "stop"; message: "alreadyOwner" | "rateLimited" | "notAvailable" | "noBrand" };

const digitsOnly = (s: string) =>
  s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/\D/g, "")
    .slice(0, 6);

const store = {
  get(v: string): { claim_id: string; phone: string } | null {
    try {
      return JSON.parse(sessionStorage.getItem(`ak:claim:${v}`) ?? "null");
    } catch {
      return null;
    }
  },
  set(v: string, x: { claim_id: string; phone: string }) {
    try {
      sessionStorage.setItem(`ak:claim:${v}`, JSON.stringify(x));
    } catch {
      /* private mode: the flow still works, it just cannot resume */
    }
  },
};

/** Claiming one business (DECISIONS §18.1, §24.3): details, then a code to the shop's own phone or papers, then done. */
export function ClaimFlow({ business }: { business: ClaimBusiness }) {
  const { t, lang } = useSite();
  const c = t.claim;
  const [stage, setStage] = useState<Stage>({ k: "details" });
  const [cc, setCc] = useState("961");
  const [typed, setTyped] = useState("");
  const [name, setName] = useState("");
  const [owner, setOwner] = useState(false);
  const [chain, setChain] = useState(false);
  const [consent, setConsent] = useState(false);
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [top, setTop] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [claim, setClaim] = useState<{ id: string; phone: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  const fail = (r: Extract<CallResult<unknown>, { ok: false }>) =>
    setTop(
      r.error === "rate_limited"
        ? t.form.errors.rate
        : r.error === "offline"
          ? t.form.errors.offline
          : t.form.errors.generic,
    );

  // A reload in the middle of a claim picks it up again.
  useEffect(() => {
    const saved = store.get(business.vendor_id);
    if (!saved) return;
    let live = true;
    void claimStatus({ claim_id: saved.claim_id, phone: saved.phone }).then((r) => {
      if (!live || !r.ok || r.data.status === "no_claim") return;
      setClaim({ id: saved.claim_id, phone: saved.phone });
      apply(r.data);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business.vendor_id]);

  // Move focus to the new step's heading, so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    heading.current?.focus();
  }, [stage.k]);

  function apply(s: ClaimState) {
    setTop(null);
    switch (s.status) {
      case "code_sent":
        setStage({
          k: "code",
          channel: s.channel ?? "whatsapp",
          tail: s.phone_tail ?? business.phone_tail ?? "",
        });
        break;
      case "awaiting_documents":
      case "locked":
        setStage({
          k: "docs",
          missing: s.missing ?? ["registration", "sign_photo"],
          notice:
            s.code_not_delivered || s.status === "locked"
              ? "undelivered"
              : s.contested
                ? "contested"
                : s.case === "I"
                  ? "sale"
                  : undefined,
        });
        break;
      case "pending_review":
      case "objection_window":
        setStage({ k: "done", outcome: "review" });
        break;
      case "waitlist":
        setStage({ k: "done", outcome: "waitlist" });
        break;
      case "approved":
        setStage({ k: "done", outcome: "approved" });
        break;
      case "wrong_code":
        setStage((p) => (p.k === "code" ? { ...p, left: s.left } : p));
        setCode("");
        break;
      case "expired":
        setStage((p) => (p.k === "code" ? { ...p, expired: true } : p));
        break;
      case "already_owner":
      case "rate_limited":
      case "not_available":
      case "no_brand":
        setStage({
          k: "stop",
          message:
            s.status === "already_owner"
              ? "alreadyOwner"
              : s.status === "rate_limited"
                ? "rateLimited"
                : s.status === "not_available"
                  ? "notAvailable"
                  : "noBrand",
        });
        break;
      default:
        setTop(t.form.errors.generic);
    }
  }

  async function submitDetails(e: FormEvent) {
    e.preventDefault();
    const phone = toE164(cc, typed);
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = t.form.errors.name;
    if (!phone) next.phone = t.form.errors.phone;
    if (!owner) next.owner = t.form.errors.consent;
    if (!consent) next.consent = t.form.errors.consent;
    setErrors(next);
    if (Object.keys(next).length || !phone) return focusFirstError();
    setBusy(true);
    setTop(null);
    const r = await startClaim({
      vendor_id: business.vendor_id,
      phone,
      name: name.trim(),
      lang,
      brand_wide: chain,
    });
    setBusy(false);
    if (!r.ok) return fail(r);
    if (r.data.claim_id) {
      setClaim({ id: r.data.claim_id, phone });
      store.set(business.vendor_id, { claim_id: r.data.claim_id, phone });
    }
    apply(r.data);
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    if (!claim) return;
    if (code.length !== 6) return setErrors({ code: c.codeLabel });
    setErrors({});
    setBusy(true);
    const r = await verifyCode({ claim_id: claim.id, phone: claim.phone, code });
    setBusy(false);
    if (!r.ok) return fail(r);
    apply(r.data);
  }

  async function switchToDocuments() {
    if (!claim) return;
    setBusy(true);
    const r = await switchToPapers({ claim_id: claim.id, phone: claim.phone });
    setBusy(false);
    if (!r.ok) return fail(r);
    apply(r.data);
  }

  const termsLink = (
    <Link
      to="/$lang/legal/$doc"
      params={{ lang, doc: "merchant-terms" }}
      target="_blank"
      rel="noopener"
      className="font-semibold underline underline-offset-4"
    >
      {c.termsLink}
    </Link>
  );
  const privacyLink = (
    <Link
      to="/$lang/legal/$doc"
      params={{ lang, doc: "privacy" }}
      target="_blank"
      rel="noopener"
      className="font-semibold underline underline-offset-4"
    >
      {c.privacyLink}
    </Link>
  );
  const stepIndex = stage.k === "done" ? 2 : 1;

  return (
    <div className="ak-card p-5 sm:p-8">
      <Steps labels={c.stepLabels} current={stepIndex} />
      <div className="mt-6 space-y-6">
        {top && (
          <Notice tone="error" title={c.errorTitle}>
            {top}
          </Notice>
        )}

        {stage.k === "details" && (
          <form onSubmit={submitDetails} noValidate className="space-y-5">
            <div>
              <h2 ref={heading} tabIndex={-1} className="ak-h3 outline-none">
                {fmt(c.claimTitle, { name: business.name })}
              </h2>
              <p className="mt-1 text-tone-mute">
                {[business.branch_label, business.town].filter(Boolean).join(" · ")}
              </p>
              {(business.asked ?? 0) > 0 && (
                <p className="mt-3 font-bold" data-testid="claim-asked">
                  {business.asked === 1 ? c.askedOne : fmt(c.asked, { n: business.asked ?? 0 })}
                </p>
              )}
              <p className="mt-3 text-tone-mute">{c.claimLead}</p>
              {business.phone_tail && (
                <p className="mt-2 text-sm font-semibold">
                  {fmt(c.tailHint, { tail: business.phone_tail })}
                </p>
              )}
            </div>
            {business.claimed && <Notice>{c.sale}</Notice>}
            <Field label={t.form.name} error={errors.name} required>
              {({ id, describedBy, invalid }) => (
                <TextInput
                  id={id}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  aria-describedby={describedBy}
                  invalid={invalid}
                  maxLength={80}
                  required
                />
              )}
            </Field>
            <PhoneField
              label={t.form.phone}
              help={t.form.phoneHelp}
              error={errors.phone}
              cc={cc}
              onCc={setCc}
              value={typed}
              onValue={setTyped}
            />
            <div className="space-y-3">
              <CheckRow checked={owner} onChange={setOwner} error={errors.owner}>
                {c.owner}
              </CheckRow>
              {business.in_brand && (
                <CheckRow checked={chain} onChange={setChain} help={c.chainHelp}>
                  {c.chain}
                </CheckRow>
              )}
              <CheckRow checked={consent} onChange={setConsent} error={errors.consent}>
                {withLinks(c.consent, { terms: termsLink, privacy: privacyLink })}
              </CheckRow>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <button type="submit" className="ak-btn ak-btn-gold ak-btn-lg" disabled={busy}>
                {busy ? t.form.sending : c.start}
              </button>
              <Link
                to="/$lang/claim"
                params={{ lang }}
                className="font-semibold underline underline-offset-4"
              >
                {c.changeBusiness}
              </Link>
            </div>
          </form>
        )}

        {stage.k === "code" && (
          <form onSubmit={submitCode} noValidate className="space-y-5">
            <div>
              <h2 ref={heading} tabIndex={-1} className="ak-h3 outline-none">
                {c.codeTitle}
              </h2>
              <p className="mt-2 text-tone-mute">
                {fmt(c.codeLead, {
                  channel: stage.channel === "voice" ? c.channelVoice : c.channelWhatsapp,
                  tail: stage.tail,
                })}
              </p>
            </div>
            {stage.expired && <Notice tone="error">{c.expired}</Notice>}
            {stage.left != null && !stage.expired && (
              <Notice tone="error">{fmt(c.wrongCode, { left: stage.left })}</Notice>
            )}
            <Field label={c.codeLabel} error={errors.code} required>
              {({ id, describedBy, invalid }) => (
                <TextInput
                  id={id}
                  value={code}
                  onChange={(e) => setCode(digitsOnly(e.target.value))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  dir="ltr"
                  className="max-w-[16rem] text-center text-2xl tracking-[0.4em]"
                  aria-describedby={describedBy}
                  invalid={invalid}
                  required
                />
              )}
            </Field>
            <div className="flex flex-wrap items-center gap-4">
              <button
                type="submit"
                className="ak-btn ak-btn-gold ak-btn-lg"
                disabled={busy || code.length !== 6}
              >
                {busy ? t.form.sending : c.verify}
              </button>
              {stage.expired && (
                <button
                  type="button"
                  className="font-semibold underline underline-offset-4"
                  onClick={() => setStage({ k: "details" })}
                >
                  {c.resend}
                </button>
              )}
            </div>
            <button
              type="button"
              className="font-semibold underline underline-offset-4"
              disabled={busy}
              onClick={switchToDocuments}
            >
              {c.wrongNumber}. {c.useDocuments}
            </button>
          </form>
        )}

        {stage.k === "docs" && claim && (
          <>
            {stage.notice === "undelivered" && <Notice>{c.codeNotDelivered}</Notice>}
            {stage.notice === "contested" && <Notice>{c.contested}</Notice>}
            {stage.notice === "sale" && <Notice>{c.sale}</Notice>}
            <DocsStep
              headingRef={heading}
              claimId={claim.id}
              phone={claim.phone}
              missing={stage.missing}
              onState={(s) => apply(s)}
            />
          </>
        )}

        {stage.k === "done" && (
          <div className="space-y-3 text-center">
            <h2 ref={heading} tabIndex={-1} className="ak-h2 outline-none">
              {stage.outcome === "approved"
                ? fmt(c.approvedTitle, { name: business.name })
                : stage.outcome === "waitlist"
                  ? c.waitlistTitle
                  : c.reviewTitle}
            </h2>
            <p className="mx-auto max-w-xl text-tone-mute">
              {stage.outcome === "approved"
                ? c.approvedText
                : stage.outcome === "waitlist"
                  ? c.waitlistText
                  : c.reviewText}
            </p>
            <Link to="/$lang/contact" params={{ lang }} className="ak-btn ak-btn-ink mt-3">
              {c.contact}
            </Link>
          </div>
        )}

        {stage.k === "stop" && (
          <div className="space-y-4">
            <h2 ref={heading} tabIndex={-1} className="sr-only">
              {c.errorTitle}
            </h2>
            <Notice tone="error">{c[stage.message]}</Notice>
            <div className="flex flex-wrap gap-3">
              {stage.message === "noBrand" && (
                <button
                  type="button"
                  className="ak-btn ak-btn-ink"
                  onClick={() => {
                    setChain(false);
                    setStage({ k: "details" });
                  }}
                >
                  {t.form.back}
                </button>
              )}
              <Link to="/$lang/contact" params={{ lang }} className="ak-btn ak-btn-line">
                {c.contact}
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
