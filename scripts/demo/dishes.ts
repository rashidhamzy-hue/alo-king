// The dish an item is, for its illustrative photo (DECISIONS §39.12, session 5e): one real food photo per dish, shared by
// every item of that dish that has no photo of its own (the shop's own photo or a packshot comes first). The keys follow
// the dish library's names and categories (public.dish_library) where it has the dish, plus the international dishes
// the demo menus carry (burgers, pizza, sushi, coffee…). Each key has the photo search used to find candidates
// (scripts/demo/photo-scout.ts) and, where that photo shows the same dish, the key to fall back to when none was picked.
//
// Better nothing than a wrong photo (Rasheed, 17 October; session 5g): an item without a photo is still reachable, it
// follows as a list after its section's product message (§39.15.2). So the rules are:
//   1. The item's name decides (Arabic and English). A specific bread, dish or drink has its own key (markouk, pita,
//      kaak, buns, ciabatta…; liver, sujuk, kashta…) and gets nothing until a photo of that very thing is picked: a
//      generic photo (a loaf, a skewer, a chocolate dessert) never stands in for it. A broader dish's photo stands in
//      only where it shows the same dish (`parent`, checked by the tests).
//   2. The form wins over the filling: a taouk sandwich is not a skewer, a Caesar wrap is not a salad, a shawarma plate is
//      not a wrap. A dish photo serves a sandwich, wrap or sub only when it shows one (`shows`); a platter only when the
//      dish is not eaten by hand (`handheld`).
//   3. A section that names a family decides inside it: sushi (an "Uramaki Crispy" roll is not fried chicken), manakish
//      and the oven (a kafta foron is not a skewer), pizza, pasta, burgers, dips, croissants, soups; toppings and extras
//      keep a photo only when they are a side dish themselves (fries, coleslaw, pickles…), never a burger's.
//   4. Otherwise the section's own dish, then its broad category. The description never decides (it lists ingredients:
//      "lemon juice", "bun", "truffle"), and neither does the shop's business type (a guess, not the item).
//   5. Shelves and packs (photoDish): a packaged product is shown only by its own packshot; a branded or sized drink
//      (Perrier, Iced Tea 335 ML, a 6-pack, a can) never gets a generic glass.

export type Form = "sandwich" | "wrap" | "sub" | "platter";

export type Dish = {
  key: string;
  /** Matched against the item's names (and, for families and categories, its section). */
  re: RegExp;
  /** Photo search terms (English), best first. */
  q: string[];
  /** The broader dish whose photo stands in when this one has none: only where that photo shows the same dish. */
  parent?: string;
  /** Shop shelves only (`grocery`), dishes only (default), or both. */
  scope?: "grocery" | "both";
  /** A drink (kept in any section; never a glass for a branded or sized pack). */
  drink?: boolean;
  /** The forms this dish's photo shows besides the dish itself (a shawarma photo is the wrap). */
  shows?: Form[];
  /** Eaten by hand (a burger, a wrap): its photo never stands in for a plate of it. */
  handheld?: boolean;
  /** Shelf only: the photo shows the product as it is sold, unbranded, so it may stand in for it. */
  asSold?: boolean;
};

// First match wins: specific dishes before general ones ("chicken burger" before "burger", "iced latte" before "latte").
export const DISHES: Dish[] = [
  // Not food, an option ("Upgrade your pizza with burrata") or uncooked ("Ready to Cook"): never a dish photo (left
  // without an item photo, so the catalogue skips them).
  {
    key: "none",
    re: /argil|shisha|narghil|hookah|cake service|^\s*\+|^upgrade\b|ready to cook/i,
    q: [],
    scope: "both",
  },
  // A meal named only for whom it is ("KIDS", "PROTEIN"): no one dish shows it.
  { key: "meal", re: /^(kids?|protein)( meal)?$/i, q: ["kids meal"] },
  // Drinks.
  {
    key: "water_gallon",
    re: /gallon|10 ?l(iters?|itres?)?\b|refill/i,
    q: ["water cooler bottle", "water jug"],
    scope: "both",
    drink: true,
  },
  {
    key: "sparkling_water",
    re: /sparkling|perrier|san pellegrino|soda water|بيريه|بارييه/i,
    q: ["sparkling water glass", "sparkling water bottle"],
    scope: "both",
    drink: true,
  },
  {
    key: "water",
    re: /\bwater\b|mineral|sohat|tannourine|\bmiyah|مياه|مي معدنية|^مي$|ماء/i,
    q: ["bottled water", "water bottle"],
    scope: "both",
    drink: true,
  },
  {
    key: "energy_drink",
    re: /energy|red ?bull|monster/i,
    q: ["energy drink can"],
    scope: "both",
    drink: true,
  },
  {
    key: "iced_tea",
    re: /ice[d]? ?tea|lipton ice|شاي مثلج|ايس تي|آيس تي|أيس تي/i,
    q: ["iced tea glass", "iced tea"],
    scope: "both",
    drink: true,
  },
  {
    key: "soda",
    re: /pepsi|\bcola\b|coca|coke\b|7 ?up|seven ?up|sprite|fanta|mirinda|miranda|soft ?drinks?|\bsoda\b|بيبسي|كولا|سفن ?اب|ميرندا|مشروبات غازية/i,
    q: ["soda can", "soft drink glass"],
    scope: "both",
    drink: true,
  },
  {
    key: "orange_juice",
    re: /orange|برتقال/i,
    q: ["orange juice glass", "fresh orange juice"],
    parent: "juice",
    scope: "both",
    drink: true,
  },
  {
    key: "lemonade",
    re: /lemonade|lemon ?mint|ليموناضة/i,
    q: ["lemonade glass mint"],
    parent: "juice",
    drink: true,
  },
  {
    key: "milkshake",
    re: /milk ?shake|shake\b|frisco|ميلك ?شيك/i,
    q: ["milkshake", "chocolate milkshake"],
    drink: true,
  },
  {
    key: "smoothie",
    re: /protein shake|smoothie|green charge|pink energy|berry ginger|blue cream|date fuel|apple spice/i,
    q: ["fruit smoothie", "green smoothie"],
    drink: true,
  },
  {
    key: "juice",
    re: /juice|juicy|kiwi|عصير/i,
    q: ["fresh fruit juice", "juice glass"],
    scope: "both",
    drink: true,
  },
  // The Lebanese fruit cocktail (layers of juice, fruit and ashta) is not a glass of juice; a cocktail sauce is a dip.
  {
    key: "fruit_cocktail",
    re: /cocktail(?! ?sauce)|\bcock\.|كوكتيل(?! ?صوص)/i,
    q: ["lebanese fruit cocktail ashta", "fruit cocktail cup"],
    drink: true,
  },
  {
    key: "frappe",
    re: /frapp/i,
    q: ["iced frappe", "frappuccino"],
    parent: "iced_latte",
    drink: true,
  },
  {
    key: "iced_latte",
    re: /iced (latte|americano|moc+h?a|coffee|spanish|caramel|vanilla|hazelnut|white|salted|matcha)|ice latte|spanish iced|cold brew/i,
    q: ["iced latte", "iced coffee glass"],
    drink: true,
  },
  {
    key: "iced_chocolate",
    re: /ice[d]? chocolat|cold chocolat/i,
    q: ["iced chocolate drink"],
    drink: true,
  },
  {
    key: "turkish_coffee",
    re: /turkish|najjar|ahweh|قهوة/i,
    q: ["turkish coffee cup", "arabic coffee"],
    scope: "both",
    drink: true,
  },
  {
    key: "espresso",
    re: /espresso|macchiato|ristretto|cortado/i,
    q: ["espresso cup"],
    drink: true,
  },
  {
    key: "hot_chocolate",
    re: /hot chocolate|chocolat chaud|كاكاو/i,
    q: ["hot chocolate mug"],
    drink: true,
  },
  {
    key: "cappuccino",
    re: /cappuccino|\blatte\b|flat white|mocha|au lait/i,
    q: ["cappuccino", "latte art"],
    drink: true,
  },
  {
    key: "coffee",
    re: /coffee|americano|french press|filter|nescaf|نسكافيه/i,
    q: ["black coffee cup"],
    scope: "both",
    drink: true,
  },
  {
    key: "tea",
    re: /\btea\b|\bchai\b|شاي|lipton/i,
    q: ["cup of tea"],
    scope: "both",
    drink: true,
  },
  // Breads: each kind has its own key, so a loaf never stands in for markouk, pita, kaak, buns or a baguette.
  {
    key: "saj_bread",
    re: /markou?k|mar2ou2|marqouq|saj bread|\bshrak\b|مرقوق|خبز صاج|شراك/i,
    q: ["markouk saj bread", "lebanese saj flatbread"],
    scope: "both",
  },
  {
    key: "pita",
    re: /\bpitt?a\b|arabic bread|lebanese bread|kh[o]?u?bz|خبز عربي|خبز لبناني/i,
    q: ["pita bread stack", "arabic flatbread"],
    scope: "both",
  },
  {
    key: "kaak",
    re: /\bka'?a?ke?\b|ka3ke?|kaek|كعك/i,
    q: ["lebanese kaak bread", "kaak sesame bread"],
    scope: "both",
  },
  { key: "buns", re: /\bbuns?\b|brioche/i, q: ["burger buns", "bread rolls"], scope: "both" },
  {
    key: "baguette",
    re: /baguette|\bpiston\b|باغيت/i,
    q: ["baguette bread"],
    scope: "both",
  },
  { key: "ciabatta", re: /ciabat+a?|^cia\b/i, q: ["ciabatta bread"], scope: "both" },
  {
    key: "toast_bread",
    re: /toast bread|sliced bread|sandwich bread|خبز توست|^toast$/i,
    q: ["sliced toast bread loaf"],
    scope: "both",
  },
  { key: "garlic_bread", re: /garlic bread|bruschetta/i, q: ["garlic bread"] },
  // Lebanese bakery.
  {
    key: "manousheh_kishk",
    re: /kish[e]?k|kechek|كشك/i,
    q: ["kishk manakish"],
  },
  {
    key: "lahm_bi_ajeen",
    re: /lahm ?(b|bi|b')? ?a?ajeen|lahme|لحم ب?عجين|لحمة\b.*عجين|meshrouha lahmeh/i,
    q: ["lahm bi ajeen", "sfiha"],
  },
  {
    key: "manousheh_cheese",
    re: /akkawi|kashkawan|kaskawan|jebneh|cheese (manoush|saj|pie)|manakish jebneh|منقوشة جبنة|عكاوي|قشقوان/i,
    q: ["cheese manakish", "cheese flatbread"],
  },
  {
    key: "manousheh",
    re: /zaatar|za'?atar|manoush|mankoush|manakish|mana2ish|\bsaj\b|foron|زعتر|منقوش|مناقيش/i,
    q: ["manakish zaatar", "zaatar flatbread"],
  },
  {
    key: "fatayer",
    re: /fatayer|spinach|سبانخ|فطاير|mshakal|\bpies?\b/i,
    q: ["fatayer spinach pies", "lebanese pies"],
  },
  { key: "croissant", re: /croissant|كرواسان/i, q: ["croissant"], scope: "both" },
  { key: "sweet_roll", re: /cinnamon roll|raisin roll|cinnabon/i, q: ["cinnamon roll"] },
  {
    key: "bread",
    re: /\bbreads?\b|sour ?dough|pain rugby|\bpain (de|blanc|complet)|خبز/i,
    q: ["fresh bread loaves", "sourdough loaf"],
    scope: "both",
  },
  // Sweets.
  { key: "mochi", re: /mochi|little moons|موتشي/i, q: ["mochi"] },
  { key: "cheesecake", re: /cheese ?cake/i, q: ["cheesecake slice"] },
  { key: "brownie", re: /brownie/i, q: ["chocolate brownie"], parent: "dessert" },
  {
    key: "cake",
    re: /cake|loaf|\btart\b|gateau|كيك/i,
    q: ["slice of cake", "loaf cake"],
    scope: "both",
  },
  {
    key: "cookies",
    re: /cookie|biscuit|oaty/i,
    q: ["chocolate chip cookies"],
    scope: "both",
  },
  { key: "muffin", re: /muffin/i, q: ["muffin"] },
  { key: "waffle", re: /waffle|وافل/i, q: ["waffle with fruit", "belgian waffle"] },
  { key: "crepe", re: /crep|كريب/i, q: ["chocolate crepe"] },
  { key: "nutella", re: /nutella|نوتيلا|نوتلا/i, q: ["nutella dessert"] },
  {
    key: "frozen_yogurt",
    re: /frozen yogh?urt|greek yogh?urt|^blueberry$|^mango$/i,
    q: ["frozen yogurt cup", "yogurt bowl berries"],
  },
  { key: "oatmeal", re: /oat ?meal|\boat\b|porridge/i, q: ["oatmeal bowl fruit"] },
  {
    key: "ice_cream",
    re: /ice ?cream|gelato|italian \d|\d+ balls?\b|cornet|merry cream|flurry|بوظة|ايس ?كريم|آيس كريم/i,
    q: ["ice cream scoops", "ice cream cone"],
  },
  { key: "kashta", re: /\bk?ashta\b|قشطة/i, q: ["ashta lebanese clotted cream"] },
  {
    key: "pudding",
    re: /custard|meghli|mouhalabieh|pudding|مغلي|مهلبية|كاسترد|كسترد/i,
    q: ["rice pudding cup", "custard dessert"],
  },
  // The picked photo is a chocolate dessert: it stands for chocolate desserts only, never for a Desserts section.
  {
    key: "dessert",
    re: /\bchoco|chocolat|fondant|lava cake|شوكولا/i,
    q: ["chocolate cake slice", "chocolate dessert"],
  },
  // Lebanese mezze and plates.
  {
    key: "hummus",
    re: /hom+[ou]s|hum+[ou]s|fat+eh|m[o]?s+ab+aha|حمص|فتة|مسبحة/i,
    q: ["hummus", "hummus plate"],
  },
  {
    key: "mutabbal",
    re: /m[ou]?t[a]?b+al|baba ?gh?an|متبل|بابا غنوج/i,
    q: ["baba ganoush", "eggplant dip"],
  },
  { key: "tabbouleh", re: /tab+ou?leh|تبول/i, q: ["tabbouleh"] },
  { key: "fattoush", re: /fat+oush|فتوش/i, q: ["fattoush salad"] },
  { key: "labneh", re: /labn[e]?h|لبنة/i, q: ["labneh with olive oil"] },
  { key: "shanklish", re: /shank?l[e]?[e]?sh|شنكليش/i, q: ["shanklish"] },
  { key: "makdous", re: /makdous|مكدوس/i, q: ["makdous stuffed eggplant"] },
  {
    key: "vine_leaves",
    re: /\bvine\b|vine leaves|grape leaves|warak|wara2|ورق عنب/i,
    q: ["stuffed grape leaves", "dolma"],
  },
  {
    key: "kibbeh_nayyeh",
    re: /\braw\b|nayy?eh|tab[e]?lah|tablieh|frakeh|kebbeh nayyeh|نيئ|(^|\s)نية($|\s)/i,
    q: ["kibbeh nayyeh"],
  },
  // Kibbeh cooked in yogurt, on a tray, on the saj or with pumpkin: not the fried balls of the kibbeh photo.
  {
    key: "kibbeh_dish",
    re: /(kib+e?h|keb+e?h|kebbe|كبة|كبه).*(laban|لبن|sanieh|saniyeh|siniyeh|صينية|\bsaj\b|صاجية|yakteen|يقطين|pumpkin|قرع)/i,
    q: ["kibbeh bil sanieh", "kibbeh labanieh"],
  },
  { key: "kibbeh", re: /keb+[e]?h|kib+[e]?h|kebbe|كبة|كبه/i, q: ["kibbeh", "fried kibbeh"] },
  {
    key: "sambousek",
    re: /sambo?u?s[e]?k|cheese rolls?|rkakat|rakakat|ر ?قاقات|سمبوسك/i,
    q: ["sambousek", "cheese rolls fried"],
  },
  {
    key: "makanek",
    re: /makan[ei]k|maqanek|sujuk|soujo?u?k|sausage \(makanek\)|مقانق|سجق/i,
    q: ["makanek lebanese sausages"],
  },
  { key: "basterma", re: /bas?t[ie]?rma|basturma|بسترما/i, q: ["basterma"] },
  { key: "foul", re: /\bfoul\b|ful medames|فول/i, q: ["ful medames"] },
  {
    key: "falafel",
    re: /falafel|فلافل/i,
    q: ["falafel", "falafel plate"],
  },
  { key: "koushari", re: /ko?ushari|koshari|كشري/i, q: ["koshari"] },
  { key: "shish_barak", re: /shish barak|ششبرك|شيش برك/i, q: ["shish barak"] },
  { key: "toum", re: /toum|garlic (sauce|cream|dip)|ثوم/i, q: ["toum garlic sauce"] },
  {
    key: "mozzarella_sticks",
    re: /mozzarella (sticks?|bricks?)|موزاريلا ستيكس/i,
    q: ["mozzarella sticks"],
  },
  // Other fried cheese bites (jalapeño triangles, halloumi bricks, cheese fingers or balls) are not mozzarella sticks.
  {
    key: "cheese_bites",
    re: /cheese (wedges|fingers|triangles?|balls|bites)|cheesy (bites|hot triangle)|cheese chilli triangle|cheddar jalape|jalape(n|ñ|ň)o.*(cheese|trian|bites)|hal+ou?mi bricks?|برك جبنة/i,
    q: ["fried cheese bites"],
  },
  {
    key: "pickles",
    re: /pickle|^jalape(n|ñ|ň)os?$|مخلل|كبيس/i,
    q: ["pickles jar", "pickled vegetables"],
  },
  { key: "coleslaw", re: /coleslaw|كولسلو/i, q: ["coleslaw"] },
  {
    key: "caesar_salad",
    re: /caesar|ceasar|caeser|سيزر/i,
    q: ["caesar salad", "chicken caesar salad"],
  },
  { key: "greek_salad", re: /greek/i, q: ["greek salad"] },
  { key: "poke", re: /poke bowl|\bpoke\b/i, q: ["poke bowl"] },
  { key: "salad", re: /salad|rocca|roca|سلطة|سلطات|kale/i, q: ["green salad bowl", "fresh salad"] },
  { key: "soup", re: /\bsoups?\b|shorba|شوربة|\bmiso\b|t[ou]m ?yum/i, q: ["lentil soup bowl"] },
  {
    key: "spring_rolls",
    re: /spring rolls?|summer rolls?|سبرينغ رول/i,
    q: ["spring rolls"],
  },
  { key: "dumplings", re: /dumpling|gyoza|wonton/i, q: ["dumplings"] },
  { key: "calamari", re: /calamari|squid|كاليماري|حبار/i, q: ["fried calamari"] },
  { key: "burrata", re: /burrata/i, q: ["burrata"] },
  { key: "nachos", re: /nacho/i, q: ["nachos cheese"] },
  { key: "quesadilla", re: /quesadill/i, q: ["quesadilla"] },
  {
    key: "mac_cheese",
    re: /mac (&|and|n|'n') ?cheese|macaroni (and )?cheese/i,
    q: ["mac and cheese"],
  },
  {
    key: "batata_harra",
    re: /batata harr?a|spicy potato|بطاطا? حر[ةه]/i,
    q: ["batata harra"],
  },
  { key: "grilled_potato", re: /grilled potato|بطاطا مشوية/i, q: ["grilled potatoes"] },
  // Rice dishes (smoked rice with tawook, mandi): the rice is the dish.
  {
    key: "smoked_rice",
    re: /\brice\b|(^|\s)(ال)?رز|ارز|أرز|mandi|مندي/i,
    q: ["chicken and rice", "rice dish"],
  },
  // Grills and roast chicken.
  {
    key: "grill",
    re: /grilled meat|لحم[ةه]? مشوي|lahm meshwi/i,
    q: ["lebanese grilled meat skewers", "grilled meat platter"],
  },
  {
    key: "mixed_grill",
    re: /mix(ed)? grill|mashawi|مشاوي|charcoal grilled mixed/i,
    q: ["mixed grill platter", "lebanese mixed grill"],
    parent: "grill",
  },
  { key: "clay_pot", re: /fakhar|فخار|pottery|clay pot/i, q: ["clay pot dish"] },
  {
    key: "shish_taouk",
    re: /taouk|tawo+k|tawouk|طاووق|طاوق/i,
    q: ["shish tawook", "chicken skewers"],
  },
  {
    key: "kafta_dish",
    re: /(kafta|kofta|كفتة|كفته).*(halab|sanieh|saniyeh|صينية|tahin|طحين|batata|بطاطا)/i,
    q: ["kafta bil sanieh"],
  },
  {
    key: "kafta",
    re: /kafta|kofta|كفتة|كفته/i,
    q: ["kafta skewers", "kofta kebab"],
    parent: "grill",
  },
  {
    key: "kebab",
    re: /(?<!shrimps? )(kab[a]?b|kebab)|orfali|كباب/i,
    q: ["kebab skewers", "shish kebab"],
  },
  {
    key: "lamb_chops",
    re: /chops|ريش|[kc]astal+et+a|شقف/i,
    q: ["lamb chops grilled"],
  },
  { key: "liver", re: /liver|sawda|سود[ةا]|كبدة/i, q: ["fried chicken liver", "liver dish"] },
  { key: "birds", re: /\bbirds?\b|asafir|عصافير/i, q: ["grilled quail"] },
  {
    key: "offal",
    re: /testicle|بيض غنم|brain|cerveller|نخاع|sanasel|سناسل|ras asfour|راس عصفور|kidney|كلاوي|tongue|لسانات/i,
    q: ["lebanese offal plate"],
  },
  {
    key: "shawarma_plate",
    re: /shawarma.*(plat|plate|box|kg|kilo)|شاورما.*(مقطع|صحن)|(صحن|كيلو).*شاورما|arabic box/i,
    q: ["shawarma plate"],
  },
  {
    key: "shawarma",
    re: /shawarma|شاورما|شاورمة/i,
    q: ["shawarma wrap", "shawarma sandwich"],
    shows: ["wrap", "sandwich"],
    handheld: true,
  },
  {
    key: "grilled_chicken",
    re: /grilled chicken|half chicken|فروج|دجاج مشوي|chicken plate|power chicken|(?<!broasted )chicken breast/i,
    q: ["grilled chicken plate"],
  },
  // Pasta and Asian before the fried and grilled words their names carry ("shrimp pasta", "Crispy Crazy Salmon Roll").
  {
    key: "pizza_margherita",
    re: /margh?er[i]?ta|margarita|مارغريتا/i,
    q: ["margherita pizza"],
    parent: "pizza",
  },
  {
    key: "pizza_pepperoni",
    re: /pep+eroni|salami|ببروني/i,
    q: ["pepperoni pizza"],
    parent: "pizza",
  },
  { key: "calzone", re: /calzone/i, q: ["calzone"] },
  { key: "pizza", re: /pizza|بيتزا/i, q: ["pizza", "chicken pizza"] },
  { key: "lasagna", re: /lasagn/i, q: ["lasagna"] },
  { key: "ravioli", re: /ravioli/i, q: ["ravioli"] },
  { key: "gnocchi", re: /gnocchi/i, q: ["gnocchi"] },
  { key: "risotto", re: /risotto/i, q: ["risotto"] },
  {
    key: "pasta_alfredo",
    re: /alfredo|fettuc+ine|ألفريدو/i,
    q: ["fettuccine alfredo"],
    parent: "pasta",
  },
  {
    key: "pasta",
    re: /pasta|spaghetti|penne|macaroni|chinese|تشاينيز|معكرونة/i,
    q: ["spaghetti pasta plate"],
  },
  { key: "noodles", re: /noodle|soba|ramen/i, q: ["yakisoba noodles"] },
  { key: "sashimi", re: /sa[sc]h?imi/i, q: ["salmon sashimi"] },
  { key: "nigiri", re: /nigiri|gunkan/i, q: ["nigiri sushi"], parent: "sushi" },
  { key: "edamame", re: /edamame/i, q: ["edamame"] },
  {
    key: "sushi",
    re: /sushi|maki|uramaki|futomaki|hosomaki|temaki|kimbap|tempura roll|salmon skin|^cucumber$|brexley|^nature$|roll \(\d+ ?pcs\)/i,
    q: ["sushi rolls", "sushi platter"],
  },
  // Burgers, sandwiches and fried chicken.
  { key: "burger_plate", re: /صحن برغر|burger (plate|platter)/i, q: ["burger plate"] },
  {
    key: "veggie_burger",
    re: /veggie.*burger|vegetarian burger|beyond burger/i,
    q: ["veggie burger"],
    handheld: true,
  },
  {
    key: "chicken_burger",
    re: /chicken.*burger|burger.*chicken|crispy (burger|cheddar)|zinger|تشكن برغر|تشيز تشكن|smoky crispy|korean crispy|bbq crispy|dynamite crispy|chicken fillet/i,
    q: ["crispy chicken burger", "chicken burger"],
    handheld: true,
  },
  {
    key: "cheeseburger",
    re: /cheese ?burger|double cheese|تشيز برغر/i,
    q: ["cheeseburger"],
    parent: "burger",
    handheld: true,
  },
  {
    key: "burger",
    re: /burger|برغر|برجر|\bsmash/i,
    q: ["beef burger", "gourmet burger"],
    handheld: true,
  },
  { key: "hot_dog", re: /hot ?dog/i, q: ["hot dog"], handheld: true },
  {
    key: "wrap",
    re: /wrap|tortilla|(^|\s)راب($|\s)|عروس/i,
    q: ["chicken wrap", "tortilla wrap"],
    shows: ["wrap"],
    handheld: true,
  },
  {
    key: "sub",
    re: /\bsubs?\b|philly|philadelphia|cheesesteak|fajita|francisco|سوبريم|فرنسيسكو|فيلادلفيا|فاهيتا|baguette sandwich|alfredo \(|teriyaki|pesto|pepperoni sub|(^|\s)ساب($|\s)/i,
    q: ["submarine sandwich", "sub sandwich"],
    shows: ["sub"],
    handheld: true,
  },
  {
    key: "sandwich",
    re: /sandwich|\bsand\.|ساندويش|سندويش|panini|toast|\bclub\b|\bmelt\b|سندويشات/i,
    q: ["deli sandwich", "sandwich"],
    shows: ["sandwich"],
    handheld: true,
  },
  {
    key: "steak",
    re: /steak|entrecote|power beef|grilled angus/i,
    q: ["grilled steak"],
  },
  { key: "onion_rings", re: /onion ring/i, q: ["onion rings"] },
  {
    key: "loaded_fries",
    re: /loaded|topped fries|cheesy fries|cheddar bacon fries/i,
    q: ["loaded fries cheese"],
  },
  { key: "curly_fries", re: /curly/i, q: ["curly fries"] },
  { key: "fries", re: /fries|frites|potato|wedges|بطاطا|بطاطس|بطاط/i, q: ["french fries"] },
  { key: "wings", re: /wings?\b|جوانح|اجنحة/i, q: ["chicken wings", "buffalo wings"] },
  {
    key: "nuggets",
    re: /nugg|popcorn|ناجتس|ناغتس|نغتس/i,
    q: ["chicken nuggets"],
    parent: "fried_chicken",
  },
  {
    key: "fried_chicken",
    re: /broast|crisp|strip|tender|بروستد|كريسبي|كرسبي|زنجر|زينجر|اسكالوب|إسكالوب|escalope/i,
    q: ["fried chicken", "chicken tenders"],
  },
  { key: "shrimp", re: /shrimp|prawn|crab|قريدس|جمبري/i, q: ["garlic shrimp", "fried shrimp"] },
  {
    key: "dip",
    re: /\bdips?\b|sauce|mayo|ketchup|chipotle|صلصة|مايونيز|^(bbq|cheddar|garlic|mix|buffalo|honey must[ae]rd|honey mustered|ranch|signature|volcano|thousand island|truffle|west sauce|louisiana|cocktail sauce|chilli sauce|toum)$/i,
    q: ["dipping sauces"],
  },
  // Deli and grocery (shelf dishes: photoDish shows them only when a packshot is picked, or as sold).
  {
    key: "yogurt",
    re: /ayran|laban|yogh?urt|لبن|زبادي/i,
    q: ["yogurt bowl", "ayran yogurt drink"],
    scope: "grocery",
  },
  {
    key: "condiment",
    re: /sauce|ketchup|mustard|mayo|pesto|molasses|syrup|dressing|صلصة|دبس/i,
    q: ["condiment bottles", "sauce jars"],
    scope: "grocery",
  },
  {
    key: "pantry",
    re: /sugar|salt|bouillon|maggi|spice|pepper|cumin|flour|croutons|porcini|tomatoes|anchov|tuc|crackers|سكر|ملح|طحين/i,
    q: ["pantry jars spices"],
    scope: "grocery",
  },
  {
    key: "personal_care",
    re: /vaseline|hair|shampoo|lotion|cream\b|deodorant|tooth/i,
    q: ["toiletries"],
    scope: "grocery",
  },
  {
    key: "cheese",
    re: /cheese|fromage|manchego|gouda|brie|emmental|cheddar|parmesan|mozzarella|halloumi|feta|blue|picon|جبنة|جبن/i,
    q: ["cheese board", "assorted cheese"],
    scope: "grocery",
  },
  {
    key: "cold_cuts",
    re: /turkey|salami|jambon|\bham\b|mortadel|bresaola|pastrami|charcut|volys|roast beef/i,
    q: ["cold cuts deli meats"],
    scope: "grocery",
  },
  {
    key: "cooking_oil",
    re: /corn oil|sunflower|afia|vegetable oil|cooking oil|sesame oil|huile d[e']/i,
    q: ["cooking oil bottle"],
    scope: "grocery",
  },
  { key: "olive_oil", re: /olive|huile|\boil\b|زيت/i, q: ["olive oil bottle"], scope: "grocery" },
  {
    key: "vinegar",
    re: /vinegar|balsami|vinaigre|خل/i,
    q: ["balsamic vinegar bottle"],
    scope: "grocery",
  },
  { key: "honey", re: /honey|miel|عسل/i, q: ["honey jar"], scope: "grocery" },
  { key: "jam", re: /\bjam\b|confiture|preserve|مربى/i, q: ["jam jar"], scope: "grocery" },
  {
    key: "nuts",
    re: /nuts?\b|cashew|almond|pistach|walnut|peanut|مكسرات|كاجو|لوز/i,
    q: ["mixed nuts bowl"],
    scope: "grocery",
  },
  { key: "chips", re: /chips|crisps|master potato/i, q: ["potato chips bowl"], scope: "grocery" },
  {
    key: "chocolate",
    re: /chocolat|unica|dabke|nutella|kinder|snickers|شوكولا/i,
    q: ["chocolate bar pieces"],
    scope: "both",
  },
  { key: "halva", re: /halaw|halva|tahini|طحينة|حلاوة/i, q: ["halva"], scope: "grocery" },
  {
    key: "milk",
    re: /milk|lait|حليب|nido|laban|ayran/i,
    q: ["milk bottle glass"],
    scope: "grocery",
  },
  { key: "eggs", re: /eggs?\b|بيض/i, q: ["eggs carton"], scope: "grocery", asSold: true },
  { key: "butter", re: /butter|beurre|زبدة/i, q: ["butter block"], scope: "grocery" },
  {
    key: "cereal",
    re: /cereal|fitness|corn ?flakes|granola|muesli/i,
    q: ["breakfast cereal bowl"],
    scope: "grocery",
  },
  {
    key: "canned_food",
    re: /canned|\btins?\b|chickpea|beans|tuna|california garden|al wadi|boiled|معلب|حمص حب/i,
    q: ["canned food tins"],
    scope: "grocery",
  },
  {
    key: "dry_pasta",
    re: /barilla|spaghetti|penne|vermicelli|شعيرية/i,
    q: ["dry pasta"],
    scope: "grocery",
  },
  {
    key: "rice_bag",
    re: /short grain|basmati|egyptian rice|\brice\b/i,
    q: ["uncooked rice"],
    scope: "grocery",
  },
  { key: "diapers", re: /pampers|diaper|nappies|حفاض/i, q: ["baby diapers"], scope: "grocery" },
  {
    key: "household",
    re: /toilet|tissue|paper|fairy|dish|clorox|bleach|ariel|laundry|detergent|soap|cleaner/i,
    q: ["cleaning products", "household supplies"],
    scope: "grocery",
  },
  { key: "grocery", re: /$^/, q: ["grocery bag"], scope: "grocery" },
];

export const DISH = new Map(DISHES.map((d) => [d.key, d]));

// A section's broad category, when neither the name nor the section's own dish placed the item. No guess for sections
// that mix things (appetizers, starters, sides, meals, kids, desserts, sweets, cups, plates): nothing is better there.
const BY_SECTION: [RegExp, string][] = [
  [/^mini$/i, "fatayer"],
  [/shake/i, "milkshake"],
  [/drink|beverage|soft|cold|مشروب/i, "soda"],
  [/coffee|hot bev|hot drink|latte|filtered/i, "cappuccino"],
  [/ice cream|gelato|بوظة/i, "ice_cream"],
  [/dip|sauce|side cup/i, "dip"],
  [/salad|سلطات/i, "salad"],
  [/burger/i, "burger"],
  [/grill|مشاوي/i, "grill"],
  [/sandwich|سندويش/i, "sandwich"],
  [/sub\b|subs|cold cut/i, "sub"],
  [/wrap/i, "wrap"],
  [/pizza/i, "pizza"],
  [/pasta/i, "pasta"],
  [/sushi|maki|hosomaki|futomaki|uramaki|gunkan/i, "sushi"],
  [/breakfast|saj|foron|manak/i, "manousheh"],
  [/crispy|broast/i, "fried_chicken"],
  [/dairy/i, "milk"],
  [/bakery|bread|baguette|croissant/i, "bread"],
  [/pantry|staple/i, "canned_food"],
  [/snack/i, "chips"],
  [/household|baby/i, "household"],
  [/charcut/i, "cheese"],
  [/store|products/i, "grocery"],
  [/rice|ارز/i, "smoked_rice"],
];

// Sections that name a family: inside one, the item is the family's dish its name names, else the one the section
// names (a "Nigiri" or "Chicken Burgers" section also refines a plain sushi or burger name), else the family's own.
// A drink stays a drink in a breakfast (saj) section.
type Family = { re: RegExp; keys: string[]; fallback: string; drinks?: boolean };
const PASTA = ["lasagna", "ravioli", "gnocchi", "risotto", "pasta_alfredo", "pasta", "noodles"];
const MANAKISH_KEYS = [
  "manousheh_kishk",
  "lahm_bi_ajeen",
  "manousheh_cheese",
  "manousheh",
  "fatayer",
];
const MANAKISH = new Set(MANAKISH_KEYS);
const FAMILIES: Family[] = [
  {
    re: /maki|nigiri|gunkan|sa[sc]h?imi|temaki|sushi|push pop|bell sets?/i,
    keys: ["sashimi", "nigiri", "edamame", "sushi"],
    fallback: "sushi",
  },
  { re: /\bdips?\b|\bsauces?\b|صلصات|صوص/i, keys: ["toum", "dip"], fallback: "dip" },
  {
    re: /foron|\bsaj\b|manak|manou?sh|mana2ish|مناقيش|منقوش|فرن/i,
    keys: MANAKISH_KEYS,
    fallback: "manousheh",
    drinks: true,
  },
  { re: /croissant/i, keys: ["sweet_roll", "croissant"], fallback: "croissant" },
  {
    re: /pizza|بيتزا/i,
    keys: ["pizza_margherita", "pizza_pepperoni", "calzone", "pizza", ...PASTA],
    fallback: "pizza",
  },
  { re: /pasta|باستا/i, keys: PASTA, fallback: "pasta" },
  {
    re: /burger|برغر|برجر/i,
    keys: ["burger_plate", "veggie_burger", "chicken_burger", "cheeseburger", "burger"],
    fallback: "burger",
  },
  { re: /loaded fries/i, keys: ["loaded_fries"], fallback: "loaded_fries" },
  { re: /\bsoups?\b|شوربات|شوربة/i, keys: ["soup"], fallback: "soup" },
];
// The section may make a plain name more specific, never turn it into another dish.
const REFINES: Record<string, string[]> = {
  burger: ["chicken_burger", "cheeseburger", "veggie_burger"],
  sushi: ["sashimi", "nigiri"],
};
function familyDish(f: Family, name: string, section: string): string {
  const pick = (text: string) => f.keys.find((k) => DISH.get(k)!.re.test(text));
  const byName = pick(name);
  const bySection = pick(`${name} ${section}`);
  if (byName && bySection && REFINES[byName]?.includes(bySection)) return bySection;
  return byName ?? bySection ?? f.fallback;
}

// Toppings and add-ons (what goes into a burger) keep a photo only when they are a side dish of their own (fries,
// coleslaw…), never the burger's or a chicken plate's; extras may also be a piece of chicken served on its own.
const ADD_ON = /add-?ons?|toppings?|burger bun/i;
const EXTRAS = /\bextras?\b|side cups?/i;
const SIDES = [
  "fries",
  "curly_fries",
  "loaded_fries",
  "onion_rings",
  "coleslaw",
  "pickles",
  "dip",
  "toum",
];
const PIECES = ["fried_chicken", "nuggets", "wings", "mozzarella_sticks"];

// The form an item is served in, from its name (or, when the name says none, its section).
const FORM_NAME: [Form, RegExp][] = [
  ["wrap", /\bwraps?\b|tortilla|(^|\s)راب($|\s)|عروس/i],
  ["sub", /\bsubs?\b|baguette sandwich|(^|\s)ساب($|\s)/i],
  ["sandwich", /sandwich|\bsand\.|ساندويش|سندويش|panini/i],
  ["platter", /platters?|\bplates?\b|صحن|tabliyeh|طبلية/i],
];
const FORM_SECTION: [Form, RegExp][] = [
  ["wrap", /\bwraps?\b/i],
  ["sub", /\bsubs?\b/i],
  ["sandwich", /sandwich|سندويش/i],
  ["platter", /platters|plates|صحون/i],
];
const formsOf = (text: string, table: [Form, RegExp][]) =>
  table.filter(([, re]) => re.test(text)).map(([f]) => f);
/** Whether a dish's photo shows it in this form. */
const showsForm = (key: string, f: Form) =>
  f === "platter" ? !DISH.get(key)?.handheld : !!DISH.get(key)?.shows?.includes(f);

export type ItemText = {
  name_en?: string | null;
  name_ar?: string | null;
  description?: string | null;
  section_en?: string | null;
  section_ar?: string | null;
  business_type?: string | null;
};

const clean = (s: string) => s.replace(/^[\s\-–•·]+/, "").trim();

const SHELF_TYPES = new Set([
  "grocery_supermarket",
  "minimarket",
  "home_essentials",
  "roastery_nuts",
]);
const SHELF_SECTIONS =
  /charcut|dd store|^products$|pantry|dairy|household|snacks? & sweets|bakery & bread|water & bev|coffee & tea/i;

/** A shop's shelf (packaged goods) rather than its kitchen. */
export function isShelf(item: ItemText): boolean {
  return SHELF_TYPES.has(item.business_type ?? "") || SHELF_SECTIONS.test(item.section_en ?? "");
}

/** The first dish whose pattern the text matches. */
const match = (dishes: Dish[], text: string) => dishes.find((d) => d.re.test(text))?.key;

/** The section's own dish: the only one it names (or one dish and its broader ones), refined by the item's name. */
function sectionDish(dishes: Dish[], section: string, name: string): string | undefined {
  const hits = dishes.filter((d) => d.key !== "none" && d.re.test(section)).map((d) => d.key);
  if (!hits.length) return undefined;
  const top = hits[0];
  if (hits.some((k) => !photoChain(top).includes(k) && !photoChain(k).includes(top)))
    return undefined;
  const both = `${name} ${section}`;
  return (
    dishes.find((d) => d.key !== top && photoChain(d.key).includes(top) && d.re.test(both))?.key ??
    top
  );
}

/**
 * The dish key of an item ("none" for what has no food photo: shisha, a service, a "+ fries" upgrade, a burger's patty).
 * The rules are in this file's header.
 */
export function dishOf(item: ItemText): string {
  const shelf = isShelf(item);
  const dishes = DISHES.filter((d) => (shelf ? d.scope : d.scope !== "grocery"));
  const name = clean(`${item.name_en ?? ""} ${item.name_ar ?? ""}`);
  const section = `${item.section_en ?? ""} ${item.section_ar ?? ""}`.trim();
  const byName = match(dishes, name);
  if (shelf) {
    if (byName) return byName;
    for (const [re, k] of BY_SECTION) if (re.test(section) && DISH.get(k)?.scope) return k;
    return "grocery";
  }
  if (byName === "none" || DISH.get("none")!.re.test(section)) return "none";
  // 3. Toppings and extras, then the families a section names.
  if (ADD_ON.test(section)) return byName && SIDES.includes(byName) ? byName : "none";
  if (EXTRAS.test(section))
    return byName && (SIDES.includes(byName) || PIECES.includes(byName)) ? byName : "none";
  const family = FAMILIES.find((f) => f.re.test(section));
  if (family && !(family.drinks && byName && DISH.get(byName)?.drink))
    return familyDish(family, name, section);
  // 2. The form wins over the filling (a manousheh rolled as a wrap is still a manousheh).
  if (byName && MANAKISH.has(byName)) return byName;
  const nameForms = formsOf(name, FORM_NAME);
  const forms = nameForms.length ? nameForms : formsOf(section, FORM_SECTION);
  const handForms = forms.filter((f) => f !== "platter");
  if (byName && forms.some((f) => showsForm(byName, f))) return byName;
  if (handForms.length) {
    if (handForms.length === 1) return handForms[0];
    return handForms.includes("wrap") && handForms.includes("sandwich") ? "sandwich" : handForms[0];
  }
  if (byName && forms.includes("platter")) return "none"; // a plate of a dish eaten by hand
  if (byName) return byName;
  // 4. The section's own dish, then its broad category; never the description or the shop's type.
  const own = sectionDish(dishes, section, name);
  if (own) return own;
  for (const [re, k] of BY_SECTION) if (re.test(section)) return k;
  return "none";
}

// Drinks sold as a branded or sized pack (a can, a bottle, a 6-pack): a glass is not the product.
const DRINK_BRAND =
  /pepsi|coca|coke\b|7 ?up|seven ?up|sprite|fanta|mirinda|miranda|perrier|pellegrino|lipton|nestea|red ?bull|monster|bonjus|mr\.? ?juic|griffon|sohat|tannourine|sannine|evian|volvic|aquafina|بيبسي|سفن ?اب|ميرندا|بيريه|بارييه/i;
const PACK_SIZE =
  /\d+([.,]\d+)? ?(ml|cl|l|ltr|liters?|litres?)\b|\bcans?\b|\bbottles?\b|\btins?\b|\bpacks?\b|pack of|\d+ ?x ?\d|\d+-pack/i;

/**
 * The dish whose photo may show the item ("none" when no dish photo can): its dish, except a shelf product (only its
 * packshot shows it, unless the photo shows it as sold) and a branded or sized drink.
 */
export function photoDish(item: ItemText): string {
  const key = dishOf(item);
  const d = DISH.get(key);
  if (isShelf(item)) return d?.asSold ? key : "none";
  const name = `${item.name_en ?? ""} ${item.name_ar ?? ""}`;
  if (d?.drink && (DRINK_BRAND.test(name) || PACK_SIZE.test(name))) return "none";
  return key;
}

/** The keys to try for a photo, the dish first, then its broader dishes. */
export function photoChain(key: string): string[] {
  const out: string[] = [];
  let k: string | undefined = key;
  while (k && !out.includes(k)) {
    out.push(k);
    k = DISH.get(k)?.parent;
  }
  return out;
}
