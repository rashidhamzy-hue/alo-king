import { useId, type ComponentProps, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { COUNTRY_CODES } from "@/lib/site-claim";
import { useSite } from "../context";

/** A label, the control, its help and its error, wired together for screen readers. */
export function Field({
  label,
  help,
  error,
  required,
  children,
}: {
  label: string;
  help?: string;
  error?: string | null;
  required?: boolean;
  /** Receives the ids the control needs. */
  children: (a: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}) {
  const id = useId();
  const describedBy =
    [help ? `${id}-h` : "", error ? `${id}-e` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label className="ak-label" htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {children({ id, describedBy, invalid: !!error })}
      {help && (
        <p className="ak-help" id={`${id}-h`}>
          {help}
        </p>
      )}
      {error && (
        <p className="ak-error" id={`${id}-e`}>
          {error}
        </p>
      )}
    </div>
  );
}

/** After a failed validation, puts the keyboard on the first field that has an error (after React has drawn the errors). */
export function focusFirstError() {
  setTimeout(() => {
    document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, 0);
}

export function TextInput(props: ComponentProps<"input"> & { invalid?: boolean }) {
  const { invalid, className = "", ...rest } = props;
  return (
    <input {...rest} aria-invalid={invalid || undefined} className={`ak-input ${className}`} />
  );
}

/** A checkbox row. The label is the whole row, so the target is large. */
export function CheckRow({
  checked,
  onChange,
  children,
  error,
  help,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  error?: string | null;
  help?: string;
}) {
  const id = useId();
  return (
    <div>
      <label className="ak-check">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={!!error || undefined}
          aria-describedby={error ? `${id}-e` : help ? `${id}-h` : undefined}
        />
        <span>{children}</span>
      </label>
      {help && (
        <p className="ak-help ms-9" id={`${id}-h`}>
          {help}
        </p>
      )}
      {error && (
        <p className="ak-error ms-9" id={`${id}-e`}>
          {error}
        </p>
      )}
    </div>
  );
}

/** One option of a group shown as chips (radio when `single`, checkbox otherwise). */
export function ChipOption({
  name,
  value,
  checked,
  onChange,
  single,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  single?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="ak-chip-input">
      <input
        type={single ? "radio" : "checkbox"}
        name={name}
        value={value}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}

export function Notice({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "error" | "ok";
  title?: string;
  children: ReactNode;
}) {
  const Icon = tone === "error" ? AlertTriangle : tone === "ok" ? CheckCircle2 : Info;
  return (
    <div
      className={`ak-alert ${tone === "error" ? "ak-alert-error" : tone === "ok" ? "ak-alert-ok" : ""}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div>
        {title && <p className="font-bold">{title}</p>}
        <div className={title ? "mt-0.5" : ""}>{children}</div>
      </div>
    </div>
  );
}

export function Steps({ labels, current }: { labels: string[]; current: number }) {
  return (
    <ol className="ak-steps" aria-label={labels.join(" › ")}>
      {labels.map((l, i) => (
        <li
          key={l}
          data-n={i + 1}
          data-done={i < current}
          aria-current={i === current ? "step" : undefined}
        >
          <span>{l}</span>
        </li>
      ))}
    </ol>
  );
}

const REGION: Record<string, string> = {
  "961": "LB",
  "971": "AE",
  "33": "FR",
  "1": "US",
  "61": "AU",
  "49": "DE",
  "44": "GB",
  "966": "SA",
  "974": "QA",
  "20": "EG",
  "90": "TR",
  "357": "CY",
};
/** Country code and national number. A number typed in full (+ or 00) is used as typed. */
export function PhoneField({
  label,
  help,
  error,
  cc,
  onCc,
  value,
  onValue,
}: {
  label: string;
  help?: string;
  error?: string | null;
  cc: string;
  onCc: (v: string) => void;
  value: string;
  onValue: (v: string) => void;
}) {
  const { t } = useSite();
  return (
    <Field label={label} help={help} error={error} required>
      {({ id, describedBy, invalid }) => (
        <div className="flex gap-2">
          <select
            aria-label={t.form.countryCode}
            className="ak-input max-w-[9.5rem] shrink-0"
            dir="ltr"
            value={cc}
            onChange={(e) => onCc(e.target.value)}
          >
            {COUNTRY_CODES.map((c) => (
              <option key={c} value={c}>
                +{c} {REGION[c]}
              </option>
            ))}
          </select>
          <TextInput
            id={id}
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            dir="ltr"
            value={value}
            onChange={(e) => onValue(e.target.value)}
            aria-describedby={describedBy}
            invalid={invalid}
            placeholder="71 123 456"
            required
          />
        </div>
      )}
    </Field>
  );
}
