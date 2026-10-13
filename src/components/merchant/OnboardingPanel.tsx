import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  Circle,
  FileText,
  Languages,
  ListChecks,
  MapPinned,
  Sparkles,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { CompletenessRing } from "@/components/shared/CompletenessRing";
import { MERCHANT_ASSISTANT_LIVE } from "@/lib/site-config";
import { useL } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { AssistantChat } from "./AssistantChat";
import { useCompleteness, useMerchant } from "./context";

/**
 * The AI onboarding assistant's side panel (DECISIONS §24.3): after a claim it sits beside the dashboard and helps the merchant
 * turn a menu photo, PDF or link into a draft, write descriptions in three languages, choose a delivery radius and fee within
 * the bands, and finish the go-live checklist. The merchant approves each item with a tap. This is the shell: the checklist
 * works from the shop's own data today; the assistant behind it is switched on by MERCHANT_ASSISTANT_LIVE (session 5b).
 */
export function OnboardingPanel({ className }: { className?: string }) {
  const L = useL();
  const { vendorId, openAssistant } = useMerchant();
  const c = useCompleteness(vendorId);
  const [tab, setTab] = useState<"list" | "chat">("list");
  const d = c.data;
  const missing = (k: string) =>
    (d?.missing_profile ?? []).some((m) => m.toLowerCase().includes(k));
  const hasMenu = (d?.menu?.items ?? 0) > 0;
  const checks = [
    {
      done: hasMenu,
      label: L("Your menu is in", "المنيو موجود", "Votre menu est en ligne"),
      to: "/merchant/menu/import" as const,
    },
    {
      done: hasMenu && d?.menu.with_description === d?.menu.items,
      label: L(
        "Every item has a description",
        "كل صنف إلو وصف",
        "Chaque article a une description",
      ),
      to: "/merchant/menu" as const,
    },
    {
      done: !!d && !missing("hours"),
      label: L("Opening hours are set", "أوقات الدوام محدّدة", "Les horaires sont réglés"),
      to: "/merchant/profile" as const,
    },
    {
      done: !!d && !missing("delivery"),
      label: L(
        "Delivery area and fee are set",
        "منطقة التوصيل والأجرة محدّدة",
        "Zone et frais de livraison réglés",
      ),
      to: "/merchant/profile" as const,
    },
    {
      done: !!d && !missing("urgent_phone"),
      label: L(
        "An urgent phone number is added",
        "رقم الطوارئ مضاف",
        "Un numéro d'urgence est ajouté",
      ),
      to: "/merchant/profile" as const,
    },
  ];
  const done = checks.filter((x) => x.done).length;

  const helps = [
    {
      I: FileText,
      title: L("Draft your menu", "جهّز المنيو", "Préparer votre menu"),
      text: L(
        "Send photos, a PDF or a link. I turn them into sections and items.",
        "ابعت صور أو PDF أو رابط. بحوّلها لأقسام وأصناف.",
        "Envoyez des photos, un PDF ou un lien. J'en fais des sections et des articles.",
      ),
      prompt: "Turn my menu into a draft",
    },
    {
      I: Languages,
      title: L("Descriptions in 3 languages", "وصف بتلات لغات", "Descriptions en 3 langues"),
      text: L(
        "Arabic, English and French, written for you to review.",
        "عربي وإنكليزي وفرنسي، مكتوبة لتراجعها.",
        "Arabe, anglais et français, à relire.",
      ),
      prompt: "Write my descriptions in Arabic, English and French",
    },
    {
      I: MapPinned,
      title: L("Delivery radius and fees", "نطاق التوصيل والأجرة", "Rayon et frais de livraison"),
      text: L(
        "Suggestions inside the fee bands, for you to accept or change.",
        "اقتراحات ضمن شرائح الأجرة، تقبلها أو تغيّرها.",
        "Des suggestions dans les tranches de frais, à accepter ou modifier.",
      ),
      prompt: "Suggest my delivery radius and fee",
    },
    {
      I: ListChecks,
      title: L("Go-live check", "فحص قبل الانطلاق", "Vérification avant le lancement"),
      text: L(
        "I check what is missing before you switch on.",
        "بفحص شو ناقص قبل ما تشغّل.",
        "Je vérifie ce qui manque avant l'activation.",
      ),
      prompt: "Check what is missing before I go live",
    },
  ];

  return (
    <section
      aria-label={L("Setup assistant", "مساعد الإعداد", "Assistant de configuration")}
      className={cn("flex h-full min-h-0 flex-col", className)}
    >
      <div className="flex items-center justify-between gap-3 border-b border-tone-line-soft px-5 py-4">
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <Sparkles className="size-5 text-gold" aria-hidden="true" />
          {L("Setup assistant", "مساعد الإعداد", "Assistant de configuration")}
        </h2>
        {!MERCHANT_ASSISTANT_LIVE && (
          <span className="ak-chip ak-chip-gold">{L("Coming soon", "قريباً", "Bientôt")}</span>
        )}
      </div>

      {MERCHANT_ASSISTANT_LIVE && (
        <div role="tablist" className="flex gap-1 px-5 pt-3">
          {(["list", "chat"] as const).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className="min-h-10 rounded-full px-4 text-sm font-bold text-tone-mute aria-selected:bg-gold aria-selected:text-ink"
            >
              {k === "list" ? L("Checklist", "القائمة", "Liste") : L("Ask", "اسأل", "Demander")}
            </button>
          ))}
        </div>
      )}

      {tab === "chat" && MERCHANT_ASSISTANT_LIVE ? (
        <AssistantChat className="min-h-0 flex-1 p-5" />
      ) : (
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
          <div className="flex items-center gap-4">
            {c.isLoading ? (
              <Skeleton className="size-[88px] rounded-full" />
            ) : (
              <CompletenessRing value={Math.round((done / checks.length) * 100)} size={88} />
            )}
            <div>
              <p className="font-extrabold">
                {L("Go-live checklist", "قائمة الانطلاق", "Liste de lancement")}
              </p>
              <p className="text-sm text-tone-mute">
                {done}/{checks.length} ·{" "}
                {L(
                  "You approve every change with a tap.",
                  "إنت بتوافق على كل تغيير بضغطة.",
                  "Vous approuvez chaque changement d'un appui.",
                )}
              </p>
            </div>
          </div>

          <ul className="space-y-2" aria-busy={c.isLoading}>
            {checks.map((x) => (
              <li key={x.label}>
                <Link
                  to={x.to}
                  className="flex items-start gap-3 rounded-xl p-2 no-underline hover:bg-tone-surface-2"
                >
                  {x.done ? (
                    <CheckCircle2
                      className="mt-0.5 size-5 shrink-0 text-success"
                      aria-hidden="true"
                    />
                  ) : (
                    <Circle className="mt-0.5 size-5 shrink-0 text-tone-mute" aria-hidden="true" />
                  )}
                  <span className={x.done ? "text-tone-mute line-through" : "font-semibold"}>
                    {x.label}
                  </span>
                  <span className="sr-only">
                    {x.done ? L("Done", "تم", "Fait") : L("To do", "للعمل", "À faire")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <div>
            <h3 className="text-sm font-extrabold uppercase tracking-wider text-tone-mute rtl:tracking-normal">
              {L("I will help you with", "رح ساعدك بـ", "Je vous aiderai à")}
            </h3>
            <ul className="mt-3 space-y-3">
              {helps.map(({ I, title, text, prompt }) => (
                <li key={title} className="ak-card p-4">
                  <div className="flex items-start gap-3">
                    <I className="mt-0.5 size-5 shrink-0 text-gold" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="font-bold">{title}</p>
                      <p className="mt-0.5 text-sm text-tone-mute">{text}</p>
                      {MERCHANT_ASSISTANT_LIVE && (
                        <button
                          type="button"
                          className="mt-2 text-sm font-bold text-gold underline underline-offset-4"
                          onClick={() => {
                            setTab("chat");
                            openAssistant(prompt);
                          }}
                        >
                          {L("Start", "ابدأ", "Commencer")}
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {!MERCHANT_ASSISTANT_LIVE && (
              <p className="mt-4 text-sm text-tone-mute">
                {L(
                  "The assistant is being connected. Until then, use the checklist, or manage your shop by message on WhatsApp.",
                  "عم نوصّل المساعد. لحدّ ما يجهز، استعمل القائمة، أو دير محلك برسالة عالواتساب.",
                  "L'assistant est en cours de connexion. D'ici là, utilisez la liste, ou gérez votre commerce par message sur WhatsApp.",
                )}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
