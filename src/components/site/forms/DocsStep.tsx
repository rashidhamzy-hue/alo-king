import { useRef, useState } from "react";
import { Check, FileUp, Loader2 } from "lucide-react";
import { noRegistration, uploadDocument, type ClaimState } from "@/lib/site-claim";
import { useSite } from "../context";
import { Notice } from "./ui";

const MAX_BYTES = 8 * 1024 * 1024;
// The papers a claim can ask for, in the order they are shown (a list that rearranges itself as files arrive is confusing).
const KINDS = ["registration", "company", "sign_photo"];

/**
 * Sends the papers a claim or registration is waiting for (§18.1 C, E, F, G, I): one upload per missing kind. The server
 * says what is still missing after each file; when nothing is, the claim goes to a person and `onState` says so.
 */
export function DocsStep({
  claimId,
  phone,
  missing,
  homeKitchen,
  onState,
  intro,
  headingRef,
}: {
  claimId: string;
  phone: string;
  missing: string[];
  homeKitchen?: boolean;
  onState: (s: ClaimState) => void;
  intro?: string;
  /** The step's heading takes focus when the step appears. */
  headingRef?: React.Ref<HTMLHeadingElement>;
}) {
  const { t } = useSite();
  const c = t.claim;
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const asked = KINDS.filter((k) => missing.includes(k) || done.includes(k));

  async function send(kind: string, file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > MAX_BYTES || !/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.type)) {
      setError(t.form.errors.file);
      return;
    }
    setBusy(kind);
    const r = await uploadDocument({ claim_id: claimId, phone, kind, file });
    setBusy(null);
    if (!r.ok) {
      setError(
        r.error === "file_type" || r.error === "file_size"
          ? t.form.errors.file
          : r.error === "rate_limited"
            ? t.form.errors.rate
            : r.error === "offline"
              ? t.form.errors.offline
              : t.form.errors.generic,
      );
      return;
    }
    setDone((d) => (d.includes(kind) ? d : [...d, kind]));
    onState(r.data);
  }

  async function skipRegistration() {
    setError(null);
    setBusy("skip");
    const r = await noRegistration({ claim_id: claimId, phone });
    setBusy(null);
    if (r.ok) onState(r.data);
    else setError(t.form.errors.generic);
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 ref={headingRef} tabIndex={-1} className="ak-h3 outline-none">
          {c.docsTitle}
        </h2>
        <p className="mt-2 text-tone-mute">{intro ?? c.docsLead}</p>
      </div>
      <ul className="space-y-3">
        {asked.map((kind) => {
          const sent = done.includes(kind) && !missing.includes(kind);
          return (
            <li
              key={kind}
              className="ak-card flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <span className="font-semibold">{c.docKinds[kind] ?? kind}</span>
              <input
                ref={(el) => {
                  inputs.current[kind] = el;
                }}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="sr-only"
                id={`doc-${kind}`}
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => {
                  void send(kind, e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              {sent ? (
                <span
                  role="status"
                  className="inline-flex items-center gap-1.5 font-bold text-tone-ok"
                >
                  <Check className="size-5" aria-hidden="true" /> {c.uploaded}
                </span>
              ) : (
                <button
                  type="button"
                  className="ak-btn ak-btn-ink ak-btn-sm"
                  aria-label={`${c.docKinds[kind] ?? kind}: ${c.choose}`}
                  disabled={busy !== null}
                  onClick={() => inputs.current[kind]?.click()}
                >
                  {busy === kind ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" /> {c.uploading}
                    </>
                  ) : (
                    <>
                      <FileUp className="size-4" aria-hidden="true" /> {c.choose}
                    </>
                  )}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {error && <Notice tone="error">{error}</Notice>}
      {homeKitchen && missing.includes("registration") && (
        <button
          type="button"
          className="font-semibold underline underline-offset-4"
          disabled={busy !== null}
          onClick={skipRegistration}
        >
          {c.noRegistration}
        </button>
      )}
    </div>
  );
}
