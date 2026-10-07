import { Camera } from "lucide-react";
import { useL } from "@/lib/i18n";

const TIPS = {
  dish: [
    ["Shoot in daylight near a window, no flash.", "صوّر بضوء النهار قرب الشباك، بلا فلاش."],
    [
      "Fill the frame with the dish, clean plate edges.",
      "خلّي الطبق يعبّي الصورة، وأطراف الصحن نظيفة.",
    ],
    [
      "Shoot from 45° for burgers and sandwiches, from above for flat dishes.",
      "صوّر من زاوية ٤٥° للسندويشات، ومن فوق للأطباق المسطحة.",
    ],
    ["Plain background, hold the phone steady.", "خلفية بسيطة، وثبّت التلفون."],
  ],
  menu: [
    ["Lay the menu flat, photograph straight from above.", "حط المنيو مسطّح وصوّر من فوق مباشرة."],
    ["Good even light, no shadows or glare on prices.", "ضو منيح، بلا ظلال أو لمعة عالأسعار."],
    [
      "One page per photo, all four corners visible.",
      "صفحة وحدة بكل صورة، والزوايا الأربعة ظاهرين.",
    ],
    ["Make sure the text is sharp before uploading.", "تأكد إنو الكتابة واضحة قبل الرفع."],
  ],
} as const;

export function PhotoTips({ kind = "dish" }: { kind?: "dish" | "menu" }) {
  const L = useL();
  return (
    <div className="rounded-xl border border-gold/20 bg-gold/5 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-gold">
        <Camera className="size-4" />
        {kind === "menu"
          ? L("How to photograph your menu", "كيف تصوّر المنيو")
          : L("Photo tips", "نصائح للصور")}
      </p>
      <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-muted-foreground">
        {TIPS[kind].map(([en, ar]) => (
          <li key={en}>{L(en, ar)}</li>
        ))}
      </ul>
    </div>
  );
}
