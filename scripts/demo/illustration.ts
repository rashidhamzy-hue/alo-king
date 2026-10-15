// Illustrative item images for the staging demo shops (DECISIONS §39.12): one clean, consistent picture per menu item that
// has no photo of its own, so every product in the Meta catalogue has an image. Drawn, never a photo of the shop or a
// Google place photo (§38.1), and labelled "Illustration" so nobody takes it for the real dish; stored with
// source = illustrative and removed when the merchant claims the shop (their own photos replace them).
// The picture is chosen from the item's name, then its section, then the shop's business type.

export type Category =
  | "burger"
  | "wrap"
  | "sub"
  | "pizza"
  | "manousheh"
  | "fries"
  | "salad"
  | "grill"
  | "chicken"
  | "soda"
  | "juice"
  | "water"
  | "coffee"
  | "icecream"
  | "dessert"
  | "dairy"
  | "bakery"
  | "pasta"
  | "soup"
  | "grocery"
  | "dish";

// Checked in this order: the first match wins ("chicken burger" is a burger, "pizza fries" are fries only if no pizza).
const WORDS: [Category, RegExp][] = [
  ["icecream", /ice ?cream|gelato|sorbet|scoop|sundae|booza|بوظة|ايس كريم|آيس/i],
  ["coffee", /coffee|espresso|cappuccino|latte|mocha|americano|nescafe|tea\b|chai|hot chocolate|قهوة|شاي|نسكافيه/i],
  ["juice", /juice|smoothie|milkshake|shake|lemonade|cocktail|mojito|frappe|iced|عصير|ليموناضة|كوكتيل/i],
  ["water", /\bwater\b|sohat|tannourine|rim\b|mineral|مي\b|مياه|ماء/i],
  ["soda", /pepsi|\bcola\b|coca|coke|7.?up|sprite|fanta|mirinda|soft drinks?|\bsoda\b|energy drink|red bull|\bcan\b|بيبسي|كولا|سفن/i],
  ["burger", /burger|برغر|برجر/i],
  ["pizza", /pizza|margherita|pepperoni|calzone|بيتزا/i],
  ["manousheh", /man[ao]ou?sh|mana2ish|zaatar|za'?atar|kishk|kechek|ka?shkawan|akkawi|lahm ?(b|w)?.?a?ajeen|lahme|fatayer|foron|saj|منقوش|مناقيش|زعتر|كشك|لحم بعجين|فطاير/i],
  ["sub", /\bsubs?\b|submarine|hot ?dog|baguette|panini|toast|club|فرنجي/i],
  ["wrap", /shawarma|wrap|tortilla|sandwich|taouk sandwich|falafel|kebbe? ?sandwich|شاورما|سندويش|فلافل|عروس/i],
  ["fries", /fries|frites|fritas|wedges|potato|chips|بطاطا/i],
  ["salad", /salad|fattoush|tabbou?leh|caesar|greens|سلطة|فتوش|تبولة/i],
  ["pasta", /pasta|spaghetti|penne|fettuccine|lasagn|macaroni|noodle|koushari|kushari|معكرونة|باستا|كشري/i],
  ["soup", /soup|shorba|lentil|شوربة/i],
  ["chicken", /wings|nuggets|tenders|popcorn|crispy|broasted|fried chicken|drumstick|زنجر|جوانح|بروستد/i],
  ["grill", /grill|kafta|kebab|kabab|taouk|tawook|shish|mashawi|skewer|steak|chops|meat|lamb|beef|chicken|مشاوي|كفتة|كباب|طاووق|لحمة|دجاج|فروج/i],
  ["dessert", /cake|dessert|cookie|brownie|crepe|waffle|knafeh|kunafa|baklava|cheesecake|chocolate|sweet|maamoul|حلو|كنافة|كيك|بقلاوة/i],
  ["dairy", /milk|labne|laban|yogh?urt|cheese|halloumi|butter|cream|ayran|لبنة|لبن|حليب|جبنة|جبن/i],
  ["bakery", /croissant|bread|bun\b|pastry|bagel|ka'?ak|خبز|كعك|كرواسان/i],
];

const BY_TYPE: Record<string, Category> = {
  bakery_manakish: "manousheh",
  sweets_pastry: "dessert",
  ice_cream: "icecream",
  cafe: "coffee",
  grocery_supermarket: "grocery",
  minimarket: "grocery",
  home_essentials: "grocery",
  butcher: "grill",
  poultry: "chicken",
  produce: "salad",
  roastery_nuts: "grocery",
  fast_food: "burger",
};

export function categoryOf(item: {
  name_en?: string | null;
  name_ar?: string | null;
  description?: string | null;
  section_en?: string | null;
  business_type?: string | null;
}): Category {
  const name = `${item.name_en ?? ""} ${item.name_ar ?? ""}`;
  for (const [c, re] of WORDS) if (re.test(name)) return c;
  const around = `${item.section_en ?? ""} ${item.description ?? ""}`;
  for (const [c, re] of WORDS) if (re.test(around)) return c;
  return BY_TYPE[item.business_type ?? ""] ?? "dish";
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const chars = (s: string) => Array.from(s);
const clip = (s: string, n: number) =>
  chars(s).length > n ? chars(s).slice(0, n - 1).join("") + "…" : s;

/** At most two lines of about `width` characters, broken at spaces. */
export function lines(s: string, width: number): string[] {
  const words = s.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if (chars(cur).length + 1 + chars(w).length <= width) cur += ` ${w}`;
    else {
      out.push(cur);
      cur = w;
    }
  }
  if (cur) out.push(cur);
  if (out.length <= 2) return out.map((l) => clip(l, width));
  return [clip(out[0], width), clip(out.slice(1).join(" "), width)];
}

// The palette: warm cream, ink and the brand gold, with food colours that stay soft.
const C = {
  bg1: "#FBF4E8",
  bg2: "#F1E2CB",
  ink: "#1F1A17",
  gold: "#B8872E",
  plate: "#FFFFFF",
  rim: "#E9DCC6",
  bun: "#D99A4E",
  bunDark: "#B8742E",
  sesame: "#FFF3D6",
  lettuce: "#7DB24A",
  tomato: "#E0533D",
  cheese: "#F4C542",
  meat: "#7A4128",
  meatLight: "#9C5A36",
  crust: "#E3A85B",
  sauce: "#C8432F",
  herb: "#5E8C3A",
  bread: "#EBC98F",
  fry: "#F2C14E",
  box: "#D8402F",
  glass: "#DDEFF5",
  cola: "#5A2E1C",
  orange: "#F29A38",
  water: "#9FD3E6",
  cup: "#FFFFFF",
  coffee: "#6B3E22",
  cone: "#D9A35A",
  scoop1: "#F7D9E3",
  scoop2: "#8A5634",
  scoop3: "#F3E7B3",
  cream: "#FFF8EC",
  bowl: "#F4F0EA",
  noodle: "#F0C766",
  soup: "#E39A3B",
  bag: "#C99B63",
  bagDark: "#A97C47",
};

/** The drawing for a category, centred on the plate at (400, 345). */
function art(c: Category): string {
  switch (c) {
    case "burger":
      return [
        `<path d="M250 355 Q400 200 550 355 Z" fill="${C.bun}"/>`,
        `<ellipse cx="350" cy="300" rx="8" ry="4" fill="${C.sesame}"/><ellipse cx="410" cy="285" rx="8" ry="4" fill="${C.sesame}"/><ellipse cx="460" cy="310" rx="8" ry="4" fill="${C.sesame}"/><ellipse cx="390" cy="325" rx="8" ry="4" fill="${C.sesame}"/>`,
        `<path d="M240 365 Q270 345 300 365 Q330 345 360 365 Q390 345 420 365 Q450 345 480 365 Q510 345 540 365 Q555 372 560 380 L240 380 Z" fill="${C.lettuce}"/>`,
        `<rect x="250" y="378" width="300" height="20" rx="6" fill="${C.tomato}"/>`,
        `<path d="M245 398 L555 398 L520 425 L470 410 L420 432 L370 410 L320 428 L280 410 Z" fill="${C.cheese}"/>`,
        `<rect x="245" y="408" width="310" height="40" rx="18" fill="${C.meat}"/>`,
        `<path d="M255 452 L545 452 Q545 495 400 495 Q255 495 255 452 Z" fill="${C.bunDark}"/>`,
      ].join("");
    case "wrap":
      return [
        `<g transform="rotate(-18 400 350)">`,
        `<rect x="250" y="300" width="300" height="110" rx="55" fill="${C.bread}"/>`,
        `<ellipse cx="540" cy="355" rx="34" ry="55" fill="${C.crust}"/>`,
        `<ellipse cx="540" cy="355" rx="24" ry="42" fill="${C.meatLight}"/>`,
        `<circle cx="535" cy="335" r="8" fill="${C.lettuce}"/><circle cx="545" cy="368" r="7" fill="${C.tomato}"/><circle cx="530" cy="375" r="6" fill="${C.lettuce}"/>`,
        `<path d="M300 310 L330 400 M350 305 L380 405 M400 303 L430 407 M450 305 L480 405" stroke="${C.crust}" stroke-width="5" opacity="0.6"/>`,
        `</g>`,
      ].join("");
    case "sub":
      return [
        `<rect x="215" y="330" width="370" height="60" rx="30" fill="${C.bunDark}"/>`,
        `<path d="M225 330 Q240 312 260 318 L540 318 Q565 312 575 330 Z" fill="${C.lettuce}"/>`,
        `<rect x="232" y="306" width="336" height="18" rx="6" fill="${C.cheese}"/>`,
        `<rect x="240" y="292" width="320" height="18" rx="6" fill="${C.tomato}"/>`,
        `<path d="M215 300 Q400 200 585 300 Q585 295 585 300 L215 300 Z" fill="${C.bun}"/>`,
        `<path d="M290 270 L310 262 M360 252 L380 246 M430 250 L450 254 M500 262 L520 270" stroke="${C.sesame}" stroke-width="5" stroke-linecap="round"/>`,
      ].join("");
    case "pizza":
      return [
        `<circle cx="400" cy="350" r="185" fill="${C.crust}"/>`,
        `<circle cx="400" cy="350" r="160" fill="${C.sauce}"/>`,
        `<circle cx="400" cy="350" r="150" fill="${C.cheese}"/>`,
        ...[
          [340, 290],
          [450, 300],
          [380, 380],
          [470, 400],
          [320, 400],
          [410, 250],
        ].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="22" fill="${C.tomato}"/>`),
        `<path d="M400 190 L400 510 M240 350 L560 350 M287 237 L513 463 M513 237 L287 463" stroke="${C.crust}" stroke-width="5" opacity="0.7"/>`,
        `<circle cx="365" cy="330" r="7" fill="${C.herb}"/><circle cx="430" cy="360" r="7" fill="${C.herb}"/><circle cx="350" cy="440" r="6" fill="${C.herb}"/>`,
      ].join("");
    case "manousheh":
      return [
        `<circle cx="400" cy="350" r="180" fill="${C.bread}"/>`,
        `<circle cx="400" cy="350" r="160" fill="${C.crust}" opacity="0.35"/>`,
        ...Array.from({ length: 70 }, (_, i) => {
          const a = i * 2.39996;
          const r = 150 * Math.sqrt((i + 0.5) / 70);
          return `<circle cx="${(400 + r * Math.cos(a)).toFixed(1)}" cy="${(350 + r * Math.sin(a)).toFixed(1)}" r="${4 + (i % 3)}" fill="${i % 4 === 0 ? C.meatLight : C.herb}"/>`;
        }),
      ].join("");
    case "fries":
      return [
        ...Array.from({ length: 9 }, (_, i) => {
          const x = 300 + i * 25;
          const h = 150 + ((i * 37) % 60);
          return `<rect x="${x}" y="${420 - h}" width="20" height="${h}" rx="4" fill="${C.fry}" transform="rotate(${(i - 4) * 4} ${x + 10} 420)"/>`;
        }),
        `<path d="M285 330 L515 330 L490 500 L310 500 Z" fill="${C.box}"/>`,
        `<path d="M285 330 Q400 380 515 330" fill="none" stroke="#B5301F" stroke-width="6"/>`,
        `<path d="M375 420 L400 395 L425 420 L400 445 Z" fill="${C.cheese}"/>`,
      ].join("");
    case "salad":
      return [
        `<path d="M220 340 L580 340 Q570 500 400 505 Q230 500 220 340 Z" fill="${C.bowl}" stroke="${C.rim}" stroke-width="4"/>`,
        ...[
          [280, 330, 50],
          [350, 305, 55],
          [430, 300, 58],
          [510, 325, 50],
          [470, 345, 40],
          [320, 350, 40],
        ].map(
          ([x, y, r]) =>
            `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.6}" fill="${C.lettuce}" transform="rotate(${(x - 400) / 6} ${x} ${y})"/>`,
        ),
        `<circle cx="380" cy="320" r="20" fill="${C.tomato}"/><circle cx="455" cy="335" r="17" fill="${C.tomato}"/><circle cx="300" cy="345" r="15" fill="${C.tomato}"/>`,
        `<circle cx="410" cy="345" r="10" fill="${C.cream}"/><circle cx="345" cy="335" r="9" fill="${C.cream}"/>`,
      ].join("");
    case "pasta":
      return [
        `<path d="M220 340 L580 340 Q570 500 400 505 Q230 500 220 340 Z" fill="${C.bowl}" stroke="${C.rim}" stroke-width="4"/>`,
        ...Array.from({ length: 8 }, (_, i) => {
          const y = 300 + i * 6;
          return `<path d="M${260 + i * 6} ${y + 40} Q${330 + i * 4} ${y - 30} ${400} ${y + 20} Q${470 - i * 4} ${y + 70} ${540 - i * 6} ${y + 30}" fill="none" stroke="${C.noodle}" stroke-width="9" stroke-linecap="round"/>`;
        }),
        `<circle cx="370" cy="315" r="22" fill="${C.sauce}"/><circle cx="440" cy="330" r="18" fill="${C.sauce}"/>`,
        `<circle cx="400" cy="305" r="8" fill="${C.herb}"/>`,
      ].join("");
    case "soup":
      return [
        `<path d="M220 330 L580 330 Q570 500 400 505 Q230 500 220 330 Z" fill="${C.bowl}" stroke="${C.rim}" stroke-width="4"/>`,
        `<ellipse cx="400" cy="332" rx="178" ry="34" fill="${C.soup}"/>`,
        `<circle cx="360" cy="330" r="8" fill="${C.herb}"/><circle cx="420" cy="325" r="7" fill="${C.herb}"/><circle cx="455" cy="338" r="6" fill="${C.cream}"/>`,
        ...[340, 400, 460].map(
          (x) =>
            `<path d="M${x} 285 Q${x - 18} 255 ${x} 230 Q${x + 18} 205 ${x} 180" fill="none" stroke="${C.rim}" stroke-width="7" stroke-linecap="round"/>`,
        ),
      ].join("");
    case "grill":
      return [
        ...[-1, 1].map((k) => {
          const y = 330 + k * 55;
          return [
            `<rect x="210" y="${y - 3}" width="380" height="6" rx="3" fill="#8A8A8A"/>`,
            ...[260, 330, 400, 470, 540].map(
              (x, i) =>
                `<rect x="${x - 28}" y="${y - 26}" width="56" height="52" rx="16" fill="${i % 2 ? C.meatLight : C.meat}"/>`,
            ),
            `<circle cx="295" cy="${y}" r="13" fill="${C.tomato}"/><circle cx="435" cy="${y}" r="13" fill="${C.lettuce}"/><circle cx="505" cy="${y}" r="13" fill="${C.tomato}"/>`,
          ].join("");
        }),
      ].join("");
    case "chicken":
      return [
        ...[
          [330, 330, -25],
          [460, 320, 20],
          [400, 410, 0],
        ].map(
          ([x, y, r]) =>
            `<g transform="rotate(${r} ${x} ${y})"><ellipse cx="${x}" cy="${y}" rx="70" ry="55" fill="${C.crust}"/><ellipse cx="${x - 10}" cy="${y - 10}" rx="45" ry="30" fill="${C.cheese}" opacity="0.45"/><rect x="${x + 55}" y="${y - 9}" width="55" height="18" rx="9" fill="${C.cream}"/><circle cx="${x + 112}" cy="${y - 10}" r="12" fill="${C.cream}"/><circle cx="${x + 112}" cy="${y + 10}" r="12" fill="${C.cream}"/></g>`,
        ),
      ].join("");
    case "soda":
      return [
        `<rect x="325" y="190" width="150" height="290" rx="26" fill="${C.tomato}"/>`,
        `<rect x="325" y="190" width="150" height="26" rx="12" fill="#C9C9C9"/>`,
        `<rect x="325" y="455" width="150" height="25" rx="12" fill="#B5B5B5"/>`,
        `<path d="M325 300 Q400 270 475 300 L475 360 Q400 330 325 360 Z" fill="${C.cream}"/>`,
        `<circle cx="400" cy="420" r="20" fill="${C.cream}" opacity="0.5"/>`,
      ].join("");
    case "juice":
      return [
        `<path d="M310 200 L490 200 L465 490 L335 490 Z" fill="${C.glass}" stroke="${C.rim}" stroke-width="4"/>`,
        `<path d="M318 260 L482 260 L465 490 L335 490 Z" fill="${C.orange}"/>`,
        `<rect x="420" y="140" width="14" height="190" rx="7" fill="${C.tomato}" transform="rotate(12 427 235)"/>`,
        `<circle cx="490" cy="215" r="38" fill="${C.cheese}"/><circle cx="490" cy="215" r="28" fill="${C.cream}"/>`,
        `<circle cx="370" cy="330" r="10" fill="${C.cream}" opacity="0.6"/><circle cx="420" cy="380" r="8" fill="${C.cream}" opacity="0.6"/>`,
      ].join("");
    case "water":
      return [
        `<rect x="355" y="170" width="90" height="40" rx="10" fill="#3D7FB3"/>`,
        `<path d="M340 215 Q340 200 360 200 L440 200 Q460 200 460 215 L470 250 L470 470 Q470 495 445 495 L355 495 Q330 495 330 470 L330 250 Z" fill="${C.water}" stroke="${C.rim}" stroke-width="4"/>`,
        `<rect x="330" y="320" width="140" height="80" fill="${C.cream}"/>`,
        `<path d="M400 335 Q385 360 400 385 Q415 360 400 335 Z" fill="#3D7FB3"/>`,
      ].join("");
    case "coffee":
      return [
        `<ellipse cx="400" cy="470" rx="170" ry="30" fill="${C.rim}"/>`,
        `<path d="M270 300 L530 300 L510 450 Q505 470 480 470 L320 470 Q295 470 290 450 Z" fill="${C.cup}" stroke="${C.rim}" stroke-width="4"/>`,
        `<path d="M528 330 Q590 330 585 380 Q580 425 515 425" fill="none" stroke="${C.cup}" stroke-width="22"/>`,
        `<ellipse cx="400" cy="302" rx="128" ry="22" fill="${C.coffee}"/>`,
        `<path d="M370 300 Q400 280 430 300 Q400 315 370 300 Z" fill="${C.cream}"/>`,
        ...[355, 400, 445].map(
          (x) =>
            `<path d="M${x} 270 Q${x - 15} 245 ${x} 220 Q${x + 15} 195 ${x} 170" fill="none" stroke="${C.rim}" stroke-width="7" stroke-linecap="round"/>`,
        ),
      ].join("");
    case "icecream":
      return [
        `<path d="M330 330 L470 330 L400 510 Z" fill="${C.cone}"/>`,
        `<path d="M345 360 L455 360 M360 400 L440 400 M375 440 L425 440 M360 340 L430 480 M440 340 L370 480" stroke="${C.bunDark}" stroke-width="4" opacity="0.6"/>`,
        `<circle cx="355" cy="305" r="55" fill="${C.scoop1}"/>`,
        `<circle cx="445" cy="305" r="55" fill="${C.scoop3}"/>`,
        `<circle cx="400" cy="245" r="58" fill="${C.scoop2}"/>`,
        `<circle cx="400" cy="185" r="14" fill="${C.tomato}"/>`,
      ].join("");
    case "dessert":
      return [
        `<path d="M260 420 L400 260 L540 420 Z" fill="${C.cream}"/>`,
        `<path d="M260 420 L540 420 L540 470 L260 470 Z" fill="${C.bread}"/>`,
        `<path d="M280 398 L520 398" stroke="${C.scoop2}" stroke-width="18"/>`,
        `<path d="M323 350 L477 350" stroke="${C.scoop1}" stroke-width="14"/>`,
        `<path d="M260 420 L400 260 L540 420" fill="none" stroke="${C.scoop2}" stroke-width="10" stroke-linejoin="round"/>`,
        `<circle cx="400" cy="250" r="20" fill="${C.tomato}"/>`,
      ].join("");
    case "dairy":
      return [
        `<path d="M250 420 L520 300 L550 360 L550 470 L250 470 Z" fill="${C.cheese}"/>`,
        `<path d="M250 420 L520 300 L550 360 L280 470 Z" fill="#F7D46A"/>`,
        `<circle cx="340" cy="440" r="18" fill="#E2B03A"/><circle cx="440" cy="420" r="14" fill="#E2B03A"/><circle cx="500" cy="445" r="12" fill="#E2B03A"/><circle cx="410" cy="380" r="10" fill="#E2B03A"/>`,
        `<rect x="420" y="190" width="80" height="120" rx="8" fill="${C.cream}" stroke="${C.rim}" stroke-width="4"/>`,
        `<path d="M420 190 L460 160 L500 190" fill="${C.cream}" stroke="${C.rim}" stroke-width="4"/>`,
      ].join("");
    case "bakery":
      return [
        `<path d="M240 400 Q300 260 400 250 Q500 260 560 400 Q480 440 400 430 Q320 440 240 400 Z" fill="${C.crust}"/>`,
        `<path d="M300 330 Q330 410 340 430 M370 270 Q380 380 385 432 M430 270 Q420 380 415 432 M500 330 Q470 410 460 430" fill="none" stroke="${C.bunDark}" stroke-width="7"/>`,
        `<path d="M280 360 Q400 300 520 360" fill="none" stroke="${C.sesame}" stroke-width="6" opacity="0.5"/>`,
      ].join("");
    case "grocery":
      return [
        `<rect x="300" y="200" width="44" height="130" rx="10" fill="${C.water}"/>`,
        `<ellipse cx="420" cy="250" rx="42" ry="58" fill="${C.lettuce}"/>`,
        `<circle cx="490" cy="270" r="40" fill="${C.tomato}"/>`,
        `<path d="M260 290 L540 290 L520 490 L280 490 Z" fill="${C.bag}"/>`,
        `<path d="M260 290 L540 290 L535 320 L265 320 Z" fill="${C.bagDark}"/>`,
      ].join("");
    default:
      // A covered dish.
      return [
        `<path d="M250 420 Q250 260 400 250 Q550 260 550 420 Z" fill="#D9D4CC"/>`,
        `<path d="M290 400 Q300 300 400 285" fill="none" stroke="${C.cream}" stroke-width="12" stroke-linecap="round" opacity="0.8"/>`,
        `<circle cx="400" cy="240" r="18" fill="#BDB6AB"/>`,
        `<rect x="220" y="420" width="360" height="22" rx="11" fill="#BDB6AB"/>`,
      ].join("");
  }
}

export const SIZE = 800;

const hasArabic = (s: string) => /[؀-ۿ]/.test(s);

function textLine(y: number, s: string, size: number, fill: string, bold = false): string {
  const ar = hasArabic(s);
  const font = ar ? "Noto Naskh Arabic" : "Noto Sans";
  return `<text x="${SIZE / 2}" y="${y}" font-family="${font}" font-size="${size}" fill="${fill}" text-anchor="middle"${bold ? ' font-weight="bold"' : ""}${ar ? ' direction="rtl"' : ""}>${esc(s)}</text>`;
}

/** The SVG for one item (800 × 800). */
export function illustrationSvg(item: {
  name_en?: string | null;
  name_ar?: string | null;
  vendor?: string | null;
  category: Category;
}): string {
  const main = lines(String(item.name_en || item.name_ar || "Alo King"), 22);
  const second =
    item.name_ar && item.name_en && item.name_ar !== item.name_en ? lines(item.name_ar, 28).slice(0, 1) : [];
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">`,
    `<defs><radialGradient id="bg" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="${C.bg1}"/><stop offset="1" stop-color="${C.bg2}"/></radialGradient>`,
    `<radialGradient id="plate" cx="50%" cy="45%" r="55%"><stop offset="0.8" stop-color="${C.plate}"/><stop offset="1" stop-color="${C.rim}"/></radialGradient></defs>`,
    `<rect width="${SIZE}" height="${SIZE}" fill="url(#bg)"/>`,
    `<ellipse cx="400" cy="372" rx="275" ry="262" fill="${C.ink}" opacity="0.07"/>`,
    `<circle cx="400" cy="350" r="265" fill="url(#plate)"/>`,
    `<circle cx="400" cy="350" r="215" fill="none" stroke="${C.rim}" stroke-width="3"/>`,
    art(item.category),
    `<rect x="508" y="26" width="264" height="44" rx="22" fill="${C.ink}" opacity="0.75"/>`,
    `<text x="528" y="54" font-family="Noto Sans" font-size="18" fill="${C.cream}">Illustration ·</text>`,
    `<text x="754" y="55" font-family="Noto Naskh Arabic" font-size="18" fill="${C.cream}" text-anchor="end">صورة توضيحية</text>`,
  ];
  let y = main.length > 1 ? 668 : 690;
  for (const l of main) {
    parts.push(textLine(y, l, 42, C.ink, true));
    y += 48;
  }
  for (const l of second) {
    parts.push(textLine(y, l, 30, C.ink));
    y += 38;
  }
  if (item.vendor) parts.push(textLine(Math.min(y + 4, 778), clip(item.vendor, 40), 24, C.gold));
  parts.push("</svg>");
  return parts.join("");
}
