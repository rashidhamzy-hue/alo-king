import { useEffect, useState } from "react";
import { Gift } from "lucide-react";
import { toast } from "sonner";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DELIVERY_FEE } from "@/lib/config";
import { lbp, usd } from "@/lib/format";
import { useLang } from "@/lib/i18n";

export function GiftCalculator() {
  const { t } = useLang();
  const [value, setValue] = useState(40);
  const [contact, setContact] = useState("");
  const [joined, setJoined] = useState(false);
  useEffect(() => setJoined(!!localStorage.getItem("ak_gift_waitlist")), []);

  const base = value + DELIVERY_FEE;
  const processing = base * 0.029 + 0.3;
  const pays = base + processing;
  const crowns = Math.floor(base);

  return (
    <section id="gift" className="mx-auto max-w-6xl px-5 py-24">
      <div className="grid gap-12 md:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-gold">For the diaspora</p>
          <h2 className="mt-4 text-4xl font-semibold md:text-6xl">{t("gift_title")}</h2>
          <p className="mt-4 max-w-md text-muted-foreground">
            From Dearborn, Paris or Dubai, send a hot meal or a grocery run to family in the Shouf,
            with a personal message at the door.
          </p>
        </div>
        <div className="lux-card p-7">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">Gift value</span>
            <span className="font-display text-4xl font-semibold text-gold-gradient">
              {usd(value)}
            </span>
          </div>
          <Slider
            className="mt-5"
            min={10}
            max={150}
            step={1}
            value={[value]}
            onValueChange={(v) => setValue(v[0] ?? 10)}
          />
          <dl className="mt-7 space-y-3 text-sm">
            <Row k="Delivery fee" v={usd(DELIVERY_FEE)} />
            <Row k="Card processing (illustrative, 2.9% + $0.30)" v={usd(processing)} />
            <div className="border-t border-border pt-3">
              <Row k="Sender pays" v={usd(pays)} strong />
            </div>
            <Row k="Delivered to family" v={lbp(value)} />
            <Row k="King Crowns earned" v={`${crowns}`} />
          </dl>
          <div className="mt-7 rounded-lg bg-secondary/30 p-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Gift className="size-4 text-gold" /> Card checkout for gifts is coming soon
            </p>
            {joined ? (
              <p className="mt-2 text-sm text-muted-foreground">
                You're on the waitlist. We'll reach out first.
              </p>
            ) : (
              <form
                className="mt-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (contact.trim().length < 5) {
                    toast.error("Enter an email or WhatsApp number");
                    return;
                  }
                  localStorage.setItem(
                    "ak_gift_waitlist",
                    JSON.stringify({ contact: contact.trim(), at: new Date().toISOString() }),
                  );
                  setJoined(true);
                  toast.success("You're on the waitlist");
                }}
              >
                <Input
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="Email or WhatsApp"
                />
                <Button type="submit" variant="gold">
                  Join
                </Button>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={strong ? "text-lg font-semibold" : "font-medium"}>{v}</dd>
    </div>
  );
}
