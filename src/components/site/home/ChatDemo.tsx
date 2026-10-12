import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Crown } from "@/design/Crown";
import { lbpAt, usd } from "@/lib/site";
import { useSite } from "../context";

// Heights (percent) of the voice-note waveform bars: a hand-picked, natural-looking speech shape.
const WAVE = [
  28, 46, 70, 38, 82, 54, 30, 66, 90, 48, 34, 72, 58, 26, 62, 84, 44, 32, 70, 52, 36, 78, 50, 28,
  60, 40, 24, 34,
];

/**
 * A real, coded chat that plays an order in the visitor's language (DECISIONS §37.3.1): a voice note, its transcript,
 * the basket card, Confirm, and "Ali is 3 minutes away". Pure CSS animation: the whole conversation is in the server HTML at
 * its final size (no layout shift), each message rises in on a delay, and `prefers-reduced-motion` shows the end state.
 * The amounts are an example; the delivery fee and the rate are the live ones when the database answers.
 */
export function ChatDemo() {
  const { t, lang, overview } = useSite();
  const d = t.home.demo;
  const [run, setRun] = useState(0);
  const sub = d.items.reduce((a, i) => a + i.n * i.price, 0);
  const fee = overview.fees.min_usd;
  const total = sub + (fee ?? 0);
  const lbp = overview.rate ? lbpAt(total, overview.rate, lang) : null;
  const at = (s: number) => ({ ["--d" as string]: `${s}s` }) as React.CSSProperties;

  return (
    <figure className="m-0" aria-label={t.a11y.phoneDemo}>
      <div className="ak-phone ak-phone-chat" key={run}>
        <div className="ak-phone-screen">
          <div className="ak-chat-head">
            <span className="grid size-10 place-items-center rounded-full bg-gold text-ink">
              <Crown className="h-5 w-6" />
            </span>
            <div className="min-w-0 leading-tight">
              <div className="font-bold">{d.botName}</div>
              <div className="relative h-4 text-xs" style={{ color: "var(--mute-night)" }}>
                <span className="ak-typing-off absolute inset-y-0 start-0">{d.online}</span>
                <span
                  className="ak-typing-on absolute inset-y-0 start-0 flex items-center gap-1.5"
                  aria-hidden="true"
                >
                  <span className="ak-typing">
                    <i />
                    <i />
                    <i />
                  </span>
                </span>
              </div>
            </div>
          </div>
          <div className="ak-chat-body" aria-hidden={false}>
            <div className="ak-msg ak-bubble ak-bubble-me" style={at(0.5)}>
              <div className="flex items-center gap-2.5">
                <span
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-ink text-gold"
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 24 24" className="size-4 fill-current">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
                <span className="ak-wave" role="img" aria-label={d.voiceLabel}>
                  {WAVE.map((h, i) => (
                    <i
                      key={i}
                      style={
                        {
                          ["--h" as string]: h,
                          ["--i" as string]: i,
                          ["--d" as string]: "0.9s",
                        } as React.CSSProperties
                      }
                    />
                  ))}
                </span>
                <span className="ak-num whitespace-nowrap text-xs font-bold">{d.voiceTime}</span>
              </div>
            </div>
            <div className="ak-msg ak-bubble ak-bubble-me !bg-ink-3 !text-tone-fg" style={at(2.7)}>
              <span dir="auto">{d.transcript}</span>
              <small>{d.transcriptNote}</small>
            </div>

            <div className="ak-msg ak-wa-card" style={at(4.2)}>
              <div className="flex items-baseline justify-between gap-3">
                <strong>{d.cardTitle}</strong>
                <span className="text-xs opacity-70">{d.shop}</span>
              </div>
              <hr />
              <ul className="space-y-1">
                {d.items.map((i) => (
                  <li key={i.name} className="flex justify-between gap-3">
                    <span>
                      <bdi className="ak-num">{i.n}×</bdi> {i.name}
                    </span>
                    <bdi className="ak-num">{usd(i.n * i.price)}</bdi>
                  </li>
                ))}
                <li className="text-xs opacity-75">{d.noteLine}</li>
                {fee != null && (
                  <li className="flex justify-between gap-3 opacity-90">
                    <span>{d.delivery}</span>
                    <bdi className="ak-num">{usd(fee)}</bdi>
                  </li>
                )}
              </ul>
              <hr />
              <div className="flex items-baseline justify-between gap-3 font-bold">
                <span>{d.total}</span>
                <span className="text-end">
                  <bdi className="ak-num">{usd(total)}</bdi>
                  {lbp && (
                    <span className="block text-xs font-medium opacity-75">
                      <bdi className="ak-num">{lbp}</bdi> {t.common.lbp}
                    </span>
                  )}
                </span>
              </div>
              <div className="ak-wa-btn is-pressed" style={at(5.7)}>
                {d.confirm}
              </div>
              <div className="ak-wa-btn !mt-0 opacity-80">{d.change}</div>
            </div>

            <div className="ak-msg ak-bubble ak-bubble-me" style={at(6.3)}>
              {d.confirmed}
            </div>

            <div className="ak-msg ak-wa-card" style={at(7.7)}>
              <strong>{d.accepted}</strong>
              <div className="mt-1 flex items-center gap-2 text-gold">
                <span className="ak-num font-bold">{d.eta}</span>
              </div>
              <div className="ak-route" aria-hidden="true">
                <svg className="ak-route-bg" viewBox="0 0 280 78" preserveAspectRatio="none">
                  <path
                    d="M 18 56 C 70 56, 90 18, 150 30 S 220 40, 262 22"
                    fill="none"
                    stroke="#f4b63c"
                    strokeWidth="2"
                    strokeDasharray="3 5"
                    opacity=".7"
                  />
                  <circle cx="262" cy="22" r="6" fill="none" stroke="#f4b63c" strokeWidth="2" />
                  <circle cx="262" cy="22" r="2.4" fill="#f4b63c" />
                </svg>
                <span
                  className="ak-dot absolute left-0 top-0 block size-3.5 rounded-full bg-gold shadow-[0_0_0_5px_rgb(244_182_60/0.25)]"
                  style={at(8.1)}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="mt-4 flex items-center justify-center gap-3 text-sm text-tone-mute">
        <span>{d.example}</span>
        <button
          type="button"
          className="ak-btn ak-btn-line ak-btn-sm !min-h-9 gap-1.5 !px-3"
          onClick={() => setRun((n) => n + 1)}
          aria-label={t.a11y.replay}
        >
          <RotateCcw className="size-4" aria-hidden="true" />
        </button>
      </figcaption>
    </figure>
  );
}
