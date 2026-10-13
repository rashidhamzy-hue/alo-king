import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { applyToDrive, toE164 } from "@/lib/site-claim";
import { useSite } from "../context";
import { ChipOption, CheckRow, Field, focusFirstError, Notice, PhoneField, TextInput } from "./ui";
import { withLinks } from "./withLinks";

const VEHICLES = ["motorbike", "car", "bicycle", "van"] as const;
const TIMES = ["mornings", "afternoons", "evenings", "nights", "weekends"] as const;
const LANGS = ["ar", "en", "fr"] as const;

const toggle = (list: string[], v: string, on: boolean) =>
  on ? [...new Set([...list, v])] : list.filter((x) => x !== v);

/** The driver sign-up (DECISIONS §37.4): a short form that Rasheed reads in the admin page and answers on WhatsApp. */
export function DriverForm() {
  const { t, lang } = useSite();
  const d = t.driversPage;
  const [name, setName] = useState("");
  const [cc, setCc] = useState("961");
  const [typed, setTyped] = useState("");
  const [place, setPlace] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [licence, setLicence] = useState(false);
  const [langs, setLangs] = useState<string[]>([lang]);
  const [times, setTimes] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [top, setTop] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (done) heading.current?.focus();
  }, [done]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const phone = toE164(cc, typed);
    const next: Record<string, string> = {};
    if (name.trim().length < 2) next.name = t.form.errors.name;
    if (!phone) next.phone = t.form.errors.phone;
    if (place.trim().length < 2) next.place = d.placeError;
    if (!vehicle) next.vehicle = d.vehicleError;
    if (!consent) next.consent = t.form.errors.consent;
    setErrors(next);
    if (Object.keys(next).length || !phone) return focusFirstError();
    setBusy(true);
    setTop(null);
    const r = await applyToDrive({
      name: name.trim(),
      phone,
      place: place.trim(),
      vehicle,
      licence,
      languages: langs,
      availability: times,
      note: note.trim(),
      consent,
      lang,
    });
    setBusy(false);
    if (r.ok) return setDone(true);
    setTop(
      r.error === "rate_limited"
        ? t.form.errors.rate
        : r.error === "offline"
          ? t.form.errors.offline
          : t.form.errors.generic,
    );
  }

  if (done)
    return (
      <div className="ak-card space-y-3 p-6 text-center sm:p-10">
        <h2 ref={heading} tabIndex={-1} className="ak-h2 outline-none">
          {d.doneTitle}
        </h2>
        <p className="mx-auto max-w-xl text-tone-mute">{d.doneText}</p>
      </div>
    );

  const privacy = (
    <Link
      to="/$lang/legal/$doc"
      params={{ lang, doc: "privacy" }}
      target="_blank"
      rel="noopener"
      className="font-semibold underline underline-offset-4"
    >
      {t.claim.privacyLink}
    </Link>
  );

  return (
    <form
      onSubmit={submit}
      noValidate
      className="ak-card space-y-6 p-5 sm:p-8"
      aria-labelledby="drivers-form-title"
    >
      <h2 id="drivers-form-title" className="ak-h3">
        {d.formTitle}
      </h2>
      {top && (
        <Notice tone="error" title={t.claim.errorTitle}>
          {top}
        </Notice>
      )}
      <Field label={t.form.name} error={errors.name} required>
        {({ id, describedBy, invalid }) => (
          <TextInput
            id={id}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            maxLength={80}
            aria-describedby={describedBy}
            invalid={invalid}
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
      <Field label={d.place} help={d.placeHelp} error={errors.place} required>
        {({ id, describedBy, invalid }) => (
          <TextInput
            id={id}
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            maxLength={80}
            aria-describedby={describedBy}
            invalid={invalid}
            required
          />
        )}
      </Field>
      <fieldset aria-describedby={errors.vehicle ? "vehicle-e" : undefined}>
        <legend className="ak-label">
          {d.vehicle} <span aria-hidden="true">*</span>
        </legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {VEHICLES.map((v) => (
            <ChipOption
              key={v}
              name="vehicle"
              value={v}
              single
              checked={vehicle === v}
              onChange={() => setVehicle(v)}
            >
              {d.vehicles[v]}
            </ChipOption>
          ))}
        </div>
        {errors.vehicle && (
          <p className="ak-error" id="vehicle-e">
            {errors.vehicle}
          </p>
        )}
      </fieldset>
      <CheckRow checked={licence} onChange={setLicence}>
        {d.licence}
      </CheckRow>
      <fieldset>
        <legend className="ak-label">{d.languages}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {LANGS.map((l) => (
            <ChipOption
              key={l}
              name="languages"
              value={l}
              checked={langs.includes(l)}
              onChange={(on) => setLangs(toggle(langs, l, on))}
            >
              {d.langNames[l]}
            </ChipOption>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="ak-label">{d.availability}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {TIMES.map((x) => (
            <ChipOption
              key={x}
              name="availability"
              value={x}
              checked={times.includes(x)}
              onChange={(on) => setTimes(toggle(times, x, on))}
            >
              {d.availNames[x]}
            </ChipOption>
          ))}
        </div>
      </fieldset>
      <Field label={d.note}>
        {({ id }) => (
          <textarea
            id={id}
            className="ak-input"
            value={note}
            maxLength={400}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
      </Field>
      <CheckRow checked={consent} onChange={setConsent} error={errors.consent}>
        {withLinks(d.consent, { privacy })}
      </CheckRow>
      <button type="submit" className="ak-btn ak-btn-gold ak-btn-lg" disabled={busy}>
        {busy ? t.form.sending : d.submit}
      </button>
    </form>
  );
}
