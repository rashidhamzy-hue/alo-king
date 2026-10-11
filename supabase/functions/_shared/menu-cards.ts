// Merchant smart-menu messages (DECISIONS §18.3, §32.3): menu import instructions, one card per draft
// section (Approve / Skip), the two nutrition questions (portion size, anything unusual) and the estimate
// card (Confirm all / Later). Arabic with English, like the other merchant cards; all pass meta-limits.

const env = (to: string) => ({
  messaging_product: "whatsapp",
  recipient_type: "individual",
  to: to.replace(/^\+/, ""),
});
const text = (to: string, body: string) => ({ ...env(to), type: "text", text: { body } });
const buttons = (to: string, body: string, btns: { id: string; title: string }[]) => ({
  ...env(to),
  type: "interactive",
  interactive: {
    type: "button",
    body: { text: body.slice(0, 1024) },
    action: { buttons: btns.map((b) => ({ type: "reply", reply: b })) },
  },
});

export const menuImportHelp = (to: string, aiAvailable: boolean) =>
  text(
    to,
    [
      "📋 ابعتلي صور المنيو (أو PDF)، أو الصق المنيو كنص: كل صنف بسطر مع سعره، مثلا «شاورما دجاج 4$».",
      "Send photos or a PDF of your menu, or paste it as text: one item per line with its price, e.g. “Chicken shawarma 4$”.",
      aiAvailable
        ? "منحضّرلك مسودة وإنت بتوافق قسم قسم. / We draft it and you approve it section by section."
        : "قراءة الصور الأوتوماتيكية متوقفة حاليا: النص بيشتغل هلق، والصور رشيد بيساعدك فيها. / Reading photos automatically is paused: text works now, and Rasheed helps with photos.",
    ].join("\n\n"),
  );

export type SectionSummary = {
  index: number;
  name: string;
  items: number;
  priced: number;
  preview?: string[] | null;
};

export function draftSectionCard(to: string, draftId: string, s: SectionSummary, total: number) {
  const lines = [
    `📋 ${s.name} (${s.index + 1}/${total})`,
    `${s.items} أصناف · ${s.priced} بسعر واضح / ${s.items} items · ${s.priced} with a clear price`,
    "",
    ...(s.preview ?? []).slice(0, 8).map((p) => `• ${p}`),
    ...(s.items > 8 ? ["…"] : []),
    "",
    "الأسعار بالليرة محسوبة على سعر اليوم. الأصناف بلا سعر واضح منسألك عنها. / LBP prices use today's rate; items without a clear price are asked about.",
  ];
  return buttons(to, lines.join("\n"), [
    { id: `MNU|A|${draftId}|${s.index}`, title: "✅ موافق · Approve" },
    { id: `MNU|S|${draftId}|${s.index}`, title: "⏭️ تخطّى · Skip" },
  ]);
}

export const sectionAddedText = (to: string, inserted: number, needsPrice: string[]) =>
  text(
    to,
    `✅ انضاف ${inserted} صنف. / Added ${inserted} items.` +
      (needsPrice.length
        ? `\nبدنا سعر (بالدولار أو الليرة) لـ / Please send a price (USD or LBP) for:\n${needsPrice
            .slice(0, 15)
            .map((n) => `• ${n}`)
            .join("\n")}\nمثلا «سعر ${needsPrice[0]} 4$»`
        : ""),
  );

export const portionQuestion = (to: string, vendorId: string) =>
  buttons(
    to,
    "🥗 لنعرض السعرات للزبائن (تقدير، وإنت بتأكّد): حجم الحصص عندك؟\nTo show calories (estimated, you confirm): how big are your portions?",
    [
      { id: `NUT|S|${vendorId}`, title: "صغير · Small" },
      { id: `NUT|M|${vendorId}`, title: "وسط · Medium" },
      { id: `NUT|L|${vendorId}`, title: "كبير · Large" },
    ],
  );

export const extrasQuestion = (to: string, vendorId: string, size: string) =>
  buttons(to, "في شي مختلف عن العادة؟ / Anything unusual?", [
    { id: `NUT|E|${vendorId}|${size}|0`, title: "عادي · Normal" },
    { id: `NUT|E|${vendorId}|${size}|oil`, title: "زيت زيادة · Oil+" },
    { id: `NUT|E|${vendorId}|${size}|sauce`, title: "صوص زيادة · Sauce+" },
  ]);

export type EstimateRow = { name: string; dish?: string; kcal: number; protein_g: number };

export function estimateCard(
  to: string,
  vendorId: string,
  r: { estimated: number; unknown: number; items: EstimateRow[] },
) {
  const lines = [
    `🥗 قدّرنا السعرات لـ ${r.estimated} صنف من الوصفات المعروفة / We estimated ${r.estimated} items from standard recipes:`,
    "",
    ...r.items
      .slice(0, 8)
      .map((i) => `• ${i.name}: ≈ ${Math.round(i.kcal)} kcal · ${Math.round(i.protein_g)} g protein (estimated)`),
    ...(r.estimated > r.items.length
      ? ["", `«أكّد» بيأكّد هول بس؛ الباقي بيبقى تقدير لحتى تشوفو. / Confirm covers these ${r.items.length} only; the others stay estimated until you check them.`]
      : []),
    ...(r.unknown ? ["", `${r.unknown} أصناف ما عرفناها، بتقدر تزيدها من لوحة التحكم. / ${r.unknown} items not recognised; add them on the dashboard.`] : []),
    "",
    "الحساسية (غلوتين، سمسم، حليب…) إنت بتحددها، نحنا ما منحددها. / Allergens are yours to declare; we never set them.",
  ];
  return buttons(to, lines.join("\n"), [
    { id: `NUT|C|${vendorId}`, title: "✅ أكّد · Confirm" },
    { id: "NUT|X", title: "لاحقا · Later" },
  ]);
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export type MenuTap =
  | { a: "approve" | "skip"; draftId: string; index: number }
  | { a: "size"; vendorId: string; size: "S" | "M" | "L" }
  | { a: "extras"; vendorId: string; size: "S" | "M" | "L"; extra: "0" | "oil" | "sauce" }
  | { a: "confirm"; vendorId: string }
  | { a: "later" };

export function parseMenuTap(id: string | null | undefined): MenuTap | null {
  const s = String(id ?? "");
  let m: RegExpMatchArray | null;
  if ((m = s.match(new RegExp(`^MNU\\|([AS])\\|(${UUID})\\|(\\d{1,2})$`, "i"))))
    return { a: m[1] === "A" ? "approve" : "skip", draftId: m[2], index: Number(m[3]) };
  if ((m = s.match(new RegExp(`^NUT\\|([SML])\\|(${UUID})$`, "i"))))
    return { a: "size", vendorId: m[2], size: m[1] as "S" | "M" | "L" };
  if ((m = s.match(new RegExp(`^NUT\\|E\\|(${UUID})\\|([SML])\\|(0|oil|sauce)$`, "i"))))
    return { a: "extras", vendorId: m[1], size: m[2] as "S" | "M" | "L", extra: m[3] as "0" | "oil" | "sauce" };
  if ((m = s.match(new RegExp(`^NUT\\|C\\|(${UUID})$`, "i")))) return { a: "confirm", vendorId: m[1] };
  if (s === "NUT|X") return { a: "later" };
  return null;
}

export const isMenuCommand = (s: string | null | undefined) =>
  /^\s*(menu|my menu|add menu|منيو|المنيو|زيد المنيو|menu please|mon menu|ajouter (le |mon )?menu)\s*$/i.test(String(s ?? ""));
