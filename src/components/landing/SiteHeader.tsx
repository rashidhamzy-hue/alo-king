import { useLang, type Lang } from "@/lib/i18n";

const NAMES: Record<Lang, string> = { ar: "العربية", en: "English", fr: "Français" };

/** The staff pages' language choice: three buttons, the current one marked. Remembered in the browser. */
export function LangToggle() {
  const { lang, setLang } = useLang();
  return (
    <div
      role="group"
      aria-label="Language"
      className="flex rounded-full border border-tone-line p-0.5"
    >
      {(["ar", "en", "fr"] as const).map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          aria-label={NAMES[l]}
          className="min-h-9 min-w-9 rounded-full px-2.5 text-sm font-bold uppercase text-tone-mute aria-pressed:bg-gold aria-pressed:text-ink"
        >
          {l}
        </button>
      ))}
    </div>
  );
}
