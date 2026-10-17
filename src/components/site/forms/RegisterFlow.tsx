import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { LocateFixed, Map as MapIcon } from "lucide-react";
import { fmt, pickName } from "@/lib/site";
import type { BusinessTypeRow } from "@/lib/site-data";
import { registerBusiness, toE164, type ClaimState } from "@/lib/site-claim";
import { useSite } from "../context";
import { DocsStep } from "./DocsStep";
import { CheckRow, Field, focusFirstError, Notice, PhoneField, Steps, TextInput } from "./ui";
import { withLinks } from "./withLinks";

const PinMap = lazy(() => import("./PinMap"));
const IN_LEBANON = (lat: number, lon: number) =>
  lat >= 33 && lat <= 34.8 && lon >= 35 && lon <= 36.7;

type Stage = "business" | "location" | "docs" | "done";

/** Registering a business that is not in our list (DECISIONS §18.1 E, F, §24.3): what it is, where, then papers. */
export function RegisterFlow({ types }: { types: BusinessTypeRow[] }) {
  const { t, lang } = useSite();
  const r = t.register;
  const c = t.claim;
  const [stage, setStage] = useState<Stage>("business");
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [type, setType] = useState("");
  const [home, setHome] = useState(false);
  const [chain, setChain] = useState(false);
  const [cc, setCc] = useState("961");
  const [typed, setTyped] = useState("");
  const [consent, setConsent] = useState(false);
  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [locating, setLocating] = useState(false);
  const [latText, setLatText] = useState("");
  const [lonText, setLonText] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [top, setTop] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [claim, setClaim] = useState<{ id: string; phone: string; missing: string[] } | null>(null);
  const [outcome, setOutcome] = useState<"review" | "waitlist">("review");
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    heading.current?.focus();
  }, [stage]);

  const setPoint = (lat: number, lon: number) => {
    setPin({ lat, lon });
    setLatText(String(lat));
    setLonText(String(lon));
    setErrors((e) => ({ ...e, pin: "" }));
  };

  const typedPin = (la: string, lo: string) => {
    setLatText(la);
    setLonText(lo);
    const lat = Number(la.replace(",", "."));
    const lon = Number(lo.replace(",", "."));
    if (la.trim() && lo.trim() && Number.isFinite(lat) && Number.isFinite(lon))
      setPin({ lat, lon });
    else setPin(null);
  };

  function locate() {
    if (!navigator.geolocation) return setTop(r.locationDenied);
    setLocating(true);
    setTop(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        setShowMap(true);
        setPoint(+p.coords.latitude.toFixed(6), +p.coords.longitude.toFixed(6));
      },
      () => {
        setLocating(false);
        setTop(r.locationDenied);
      },
      { enableHighAccuracy: true, timeout: 12_000 },
    );
  }

  function nextFromBusiness(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!nameAr.trim() && !nameEn.trim()) next.name = r.nameError;
    if (!type) next.type = r.typeError;
    if (!toE164(cc, typed)) next.phone = t.form.errors.phone;
    if (!consent) next.consent = t.form.errors.consent;
    setErrors(next);
    if (Object.keys(next).length) return focusFirstError();
    setTop(null);
    setStage("location");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const phone = toE164(cc, typed);
    if (!pin) return setErrors({ pin: r.pinError });
    if (!IN_LEBANON(pin.lat, pin.lon)) return setErrors({ pin: r.outside });
    if (!phone) return setStage("business");
    setErrors({});
    setBusy(true);
    setTop(null);
    const res = await registerBusiness({
      phone,
      name_ar: nameAr.trim(),
      name_en: nameEn.trim(),
      business_type: type,
      lat: pin.lat,
      lon: pin.lon,
      home_kitchen: home,
      brand_wide: chain,
      lang,
    });
    setBusy(false);
    if (!res.ok) {
      setTop(
        res.error === "rate_limited"
          ? t.form.errors.rate
          : res.error === "offline"
            ? t.form.errors.offline
            : res.error === "pin_outside_lebanon"
              ? r.outside
              : t.form.errors.generic,
      );
      return;
    }
    apply(res.data, phone);
  }

  function apply(s: ClaimState, phone?: string) {
    if (s.status === "awaiting_documents" && s.claim_id) {
      setClaim((p) => ({
        id: s.claim_id!,
        phone: phone ?? p?.phone ?? "",
        missing: s.missing ?? [],
      }));
      setStage("docs");
    } else if (s.status === "pending_review") {
      setOutcome("review");
      setStage("done");
    } else if (s.status === "waitlist") {
      setOutcome("waitlist");
      setStage("done");
    } else if (s.status === "rate_limited") setTop(t.form.errors.rate);
    else setTop(t.form.errors.generic);
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
  const step = stage === "business" ? 0 : stage === "location" ? 1 : 2;

  return (
    <div className="ak-card p-5 sm:p-8">
      <Steps labels={r.stepLabels} current={stage === "done" ? 3 : step} />
      <div className="mt-6 space-y-6">
        {top && (
          <Notice tone="error" title={c.errorTitle}>
            {top}
          </Notice>
        )}

        {stage === "business" && types.length === 0 && (
          <Notice tone="error" title={c.errorTitle}>
            {t.form.errors.generic}{" "}
            <button
              type="button"
              className="font-semibold underline underline-offset-4"
              onClick={() => window.location.reload()}
            >
              {t.cta.tryAgain}
            </button>
          </Notice>
        )}
        {stage === "business" && (
          <form onSubmit={nextFromBusiness} noValidate className="space-y-5">
            <h2 ref={heading} tabIndex={-1} className="sr-only">
              {r.stepLabels[0]}
            </h2>
            <Field label={r.nameAr} help={r.nameHelp} error={errors.name}>
              {({ id, describedBy, invalid }) => (
                <TextInput
                  id={id}
                  value={nameAr}
                  onChange={(e) => setNameAr(e.target.value)}
                  dir="rtl"
                  lang="ar"
                  maxLength={80}
                  aria-describedby={describedBy}
                  invalid={invalid}
                />
              )}
            </Field>
            <Field label={r.nameEn}>
              {({ id }) => (
                <TextInput
                  id={id}
                  value={nameEn}
                  onChange={(e) => setNameEn(e.target.value)}
                  dir="ltr"
                  maxLength={80}
                />
              )}
            </Field>
            <Field label={r.type} error={errors.type} required>
              {({ id, describedBy, invalid }) => (
                <select
                  id={id}
                  className="ak-input"
                  aria-invalid={invalid || undefined}
                  aria-describedby={describedBy}
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  required
                >
                  <option value="">{r.typePlaceholder}</option>
                  {types.map((b) => (
                    <option key={b.business_type} value={b.business_type}>
                      {pickName(b, "name", lang)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <div className="space-y-3">
              <CheckRow checked={home} onChange={setHome} help={r.homeKitchenHelp}>
                {r.homeKitchen}
              </CheckRow>
              <CheckRow checked={chain} onChange={setChain}>
                {r.chain}
              </CheckRow>
            </div>
            <PhoneField
              label={r.phone}
              help={t.form.phoneHelp}
              error={errors.phone}
              cc={cc}
              onCc={setCc}
              value={typed}
              onValue={setTyped}
            />
            <CheckRow checked={consent} onChange={setConsent} error={errors.consent}>
              {withLinks(r.consent, { terms: termsLink, privacy: privacyLink })}
            </CheckRow>
            <button type="submit" className="ak-btn ak-btn-gold ak-btn-lg">
              {t.form.next}
            </button>
          </form>
        )}

        {stage === "location" && (
          <form onSubmit={submit} noValidate className="space-y-5">
            <div>
              <h2 ref={heading} tabIndex={-1} className="ak-h3 outline-none">
                {r.locationTitle}
              </h2>
              <p className="mt-2 text-tone-mute">{r.locationLead}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="ak-btn ak-btn-ink"
                onClick={() => setShowMap(true)}
                aria-expanded={showMap}
              >
                <MapIcon className="size-5" aria-hidden="true" /> {r.pickOnMap}
              </button>
              <button
                type="button"
                className="ak-btn ak-btn-line"
                onClick={locate}
                disabled={locating}
              >
                <LocateFixed className="size-5" aria-hidden="true" />{" "}
                {locating ? r.locating : r.useMyLocation}
              </button>
            </div>
            {showMap && (
              <div>
                <Suspense fallback={<div className="ak-map" aria-busy="true" />}>
                  <PinMap
                    lat={pin?.lat ?? null}
                    lon={pin?.lon ?? null}
                    onPick={setPoint}
                    label={r.mapHint}
                  />
                </Suspense>
                <p className="ak-help">{r.mapHint}</p>
              </div>
            )}
            <fieldset>
              <legend className="ak-label">{r.coords}</legend>
              <div className="mt-1 grid grid-cols-2 gap-3">
                <Field label={r.lat}>
                  {({ id }) => (
                    <TextInput
                      id={id}
                      inputMode="decimal"
                      dir="ltr"
                      value={latText}
                      onChange={(e) => typedPin(e.target.value, lonText)}
                    />
                  )}
                </Field>
                <Field label={r.lon}>
                  {({ id }) => (
                    <TextInput
                      id={id}
                      inputMode="decimal"
                      dir="ltr"
                      value={lonText}
                      onChange={(e) => typedPin(latText, e.target.value)}
                    />
                  )}
                </Field>
              </div>
            </fieldset>
            <p aria-live="polite" className="font-semibold">
              {pin ? fmt(r.pinned, { lat: pin.lat.toFixed(5), lon: pin.lon.toFixed(5) }) : r.noPin}
            </p>
            {errors.pin && <p className="ak-error">{errors.pin}</p>}
            <Notice>{r.reviewNote}</Notice>
            <div className="flex flex-wrap items-center gap-4">
              <button type="submit" className="ak-btn ak-btn-gold ak-btn-lg" disabled={busy}>
                {busy ? t.form.sending : r.submit}
              </button>
              <button
                type="button"
                className="font-semibold underline underline-offset-4"
                onClick={() => setStage("business")}
              >
                {t.form.back}
              </button>
            </div>
          </form>
        )}

        {stage === "docs" && claim && (
          <>
            <DocsStep
              headingRef={heading}
              claimId={claim.id}
              phone={claim.phone}
              missing={claim.missing}
              homeKitchen={home}
              onState={(s) => apply(s)}
            />
          </>
        )}

        {stage === "done" && (
          <div className="space-y-3 text-center">
            <h2 ref={heading} tabIndex={-1} className="ak-h2 outline-none">
              {outcome === "waitlist" ? c.waitlistTitle : c.reviewTitle}
            </h2>
            <p className="mx-auto max-w-xl text-tone-mute">
              {outcome === "waitlist" ? c.waitlistText : c.reviewText}
            </p>
            <Link to="/$lang/business/contact" params={{ lang }} className="ak-btn ak-btn-ink mt-3">
              {c.contact}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
