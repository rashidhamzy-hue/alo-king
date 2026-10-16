// The dish an item is, for its illustrative photo (DECISIONS §39.12, session 5e): one real food photo per dish, shared by
// every item of that dish that has no photo of its own (the shop's own photo or a packshot comes first). The keys follow
// the dish library's names and categories (public.dish_library) where it has the dish, plus the international dishes
// the demo menus carry (burgers, pizza, sushi, coffee…). Each key has the photo search used to find candidates
// (scripts/demo/photo-scout.ts) and the key to fall back to when no photo was picked for it.
// The item's name decides first (Arabic and English), then its section and description, then the shop's business type.

export type Dish = {
  key: string;
  /** Matched against the item's names (and then its section and description). */
  re: RegExp;
  /** Photo search terms (English), best first. */
  q: string[];
  /** The broader dish whose photo stands in when this one has none. */
  parent?: string;
  /** Shop shelves only (`grocery`), dishes only (default), or both. */
  scope?: "grocery" | "both";
};

// First match wins: specific dishes before general ones ("chicken burger" before "burger", "iced latte" before "latte").
export const DISHES: Dish[] = [
  // Not food: never a dish photo (left without an item photo, so the catalogue skips them).
  { key: "none", re: /argil|shisha|narghil|hookah|cake service|^\s*\+/i, q: [], scope: "both" },
  // Drinks.
  {
    key: "water_gallon",
    re: /gallon|10 ?l(iters?|itres?)?\b|refill/i,
    q: ["water cooler bottle", "water jug"],
    scope: "both",
  },
  {
    key: "sparkling_water",
    re: /sparkling|perrier|san pellegrino|soda water/i,
    q: ["sparkling water glass", "sparkling water bottle"],
    parent: "water",
    scope: "both",
  },
  {
    key: "water",
    re: /\bwater\b|mineral|sohat|tannourine|\bmiyah|مياه|مي معدنية|^مي$/i,
    q: ["bottled water", "water bottle"],
    scope: "both",
  },
  {
    key: "energy_drink",
    re: /energy|red ?bull|monster/i,
    q: ["energy drink can"],
    parent: "soda",
    scope: "both",
  },
  {
    key: "iced_tea",
    re: /ice[d]? ?tea|lipton ice|شاي مثلج|ايس تي/i,
    q: ["iced tea glass", "iced tea"],
    parent: "juice",
    scope: "both",
  },
  {
    key: "soda",
    re: /pepsi|\bcola\b|coca|coke\b|7 ?up|seven ?up|sprite|fanta|mirinda|miranda|soft ?drinks?|\bsoda\b|بيبسي|كولا|سفن ?اب|ميرندا|مشروبات غازية/i,
    q: ["soda can", "soft drink glass"],
    scope: "both",
  },
  {
    key: "orange_juice",
    re: /orange|برتقال/i,
    q: ["orange juice glass", "fresh orange juice"],
    parent: "juice",
    scope: "both",
  },
  {
    key: "lemonade",
    re: /lemonade|lemon ?mint|ليموناضة/i,
    q: ["lemonade glass mint"],
    parent: "juice",
  },
  {
    key: "milkshake",
    re: /milk ?shake|shake\b|frisco|ميلك ?شيك/i,
    q: ["milkshake", "chocolate milkshake"],
  },
  {
    key: "smoothie",
    re: /protein|smoothie|green charge|pink energy|berry ginger|blue cream|date fuel|apple spice/i,
    q: ["fruit smoothie", "green smoothie"],
    parent: "juice",
  },
  {
    key: "juice",
    re: /juice|juicy|^cocktail|kiwi|عصير|كوكتيل/i,
    q: ["fresh fruit juice", "juice glass"],
    scope: "both",
  },
  { key: "frappe", re: /frapp/i, q: ["iced frappe", "frappuccino"], parent: "iced_latte" },
  {
    key: "iced_latte",
    re: /iced (latte|americano|mocha|coffee|spanish|caramel|vanilla|hazelnut|white|salted|matcha)|ice latte|spanish iced|cold brew/i,
    q: ["iced latte", "iced coffee glass"],
  },
  {
    key: "turkish_coffee",
    re: /turkish|najjar|ahweh|قهوة/i,
    q: ["turkish coffee cup", "arabic coffee"],
    scope: "both",
  },
  {
    key: "espresso",
    re: /espresso|macchiato|ristretto|cortado/i,
    q: ["espresso cup"],
    parent: "cappuccino",
  },
  {
    key: "hot_chocolate",
    re: /hot chocolate|chocolat chaud/i,
    q: ["hot chocolate mug"],
    parent: "cappuccino",
  },
  {
    key: "cappuccino",
    re: /cappuccino|\blatte\b|flat white|mocha|au lait/i,
    q: ["cappuccino", "latte art"],
  },
  {
    key: "coffee",
    re: /coffee|americano|french press|filter|nescaf|نسكافيه/i,
    q: ["black coffee cup"],
    parent: "cappuccino",
    scope: "both",
  },
  { key: "tea", re: /\btea\b|\bchai\b|شاي|lipton/i, q: ["cup of tea"], scope: "both" },
  // Lebanese bakery.
  {
    key: "manousheh_kishk",
    re: /kish[e]?k|kechek|كشك/i,
    q: ["kishk manakish", "manakish"],
    parent: "manousheh",
  },
  {
    key: "lahm_bi_ajeen",
    re: /lahm|lahme|لحم ب?عجين|لحمة\b.*عجين|meshrouha lahmeh/i,
    q: ["lahm bi ajeen", "sfiha"],
    parent: "manousheh",
  },
  {
    key: "manousheh_cheese",
    re: /akkawi|kashkawan|kaskawan|jebneh|cheese (manoush|saj|pie)|manakish jebneh|منقوشة جبنة|عكاوي|قشقوان/i,
    q: ["cheese manakish", "cheese flatbread"],
    parent: "manousheh",
  },
  {
    key: "manousheh",
    re: /zaatar|za'?atar|manoush|manakish|mana2ish|saj|foron|زعتر|منقوش|مناقيش/i,
    q: ["manakish zaatar", "zaatar flatbread"],
  },
  {
    key: "fatayer",
    re: /fatayer|spinach|سبانخ|فطاير|mshakal|\bpies?\b/i,
    q: ["fatayer spinach pies", "lebanese pies"],
    parent: "manousheh",
  },
  { key: "croissant", re: /croissant|كرواسان/i, q: ["croissant"], scope: "both" },
  {
    key: "bread",
    re: /baguette|ciabat|piston|bread|pita|markouk|\bbuns?\b|خبز|كعك|ka'?ak/i,
    q: ["fresh bread loaves", "baguette"],
    scope: "both",
  },
  // Sweets.
  { key: "mochi", re: /mochi/i, q: ["mochi"], parent: "dessert" },
  { key: "cheesecake", re: /cheese ?cake/i, q: ["cheesecake slice"], parent: "dessert" },
  { key: "brownie", re: /brownie/i, q: ["chocolate brownie"], parent: "dessert" },
  {
    key: "cake",
    re: /cake|loaf|\btart\b|gateau|كيك/i,
    q: ["slice of cake", "loaf cake"],
    parent: "dessert",
    scope: "both",
  },
  {
    key: "cookies",
    re: /cookie|biscuit|oaty/i,
    q: ["chocolate chip cookies"],
    parent: "dessert",
    scope: "both",
  },
  { key: "muffin", re: /muffin/i, q: ["muffin"], parent: "dessert" },
  {
    key: "waffle",
    re: /waffle|وافل/i,
    q: ["waffle with fruit", "belgian waffle"],
    parent: "dessert",
  },
  { key: "crepe", re: /crep|nutella|كريب/i, q: ["chocolate crepe"], parent: "dessert" },
  {
    key: "frozen_yogurt",
    re: /frozen yogh?urt|greek yogh?urt|^blueberry$|^mango$/i,
    q: ["frozen yogurt cup", "yogurt bowl berries"],
    parent: "dessert",
  },
  {
    key: "oatmeal",
    re: /oat ?meal|\boat\b|porridge/i,
    q: ["oatmeal bowl fruit"],
    parent: "dessert",
  },
  {
    key: "ice_cream",
    re: /ice ?cream|gelato|italian \d|\bballs?\b|cornet|merry cream|بوظة|ايس ?كريم|آيس/i,
    q: ["ice cream scoops", "ice cream cone"],
  },
  {
    key: "pudding",
    re: /custard|meghli|mouhalabieh|pudding|مغلي|مهلبية|كاسترد/i,
    q: ["rice pudding cup", "custard dessert"],
    parent: "dessert",
  },
  {
    key: "dessert",
    re: /cake|loaf|\btart\b|dessert|sweet|cup\b|choco|lotus|oreo|bomb|كيك|حلو/i,
    q: ["chocolate cake slice", "dessert cup"],
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
  { key: "shanklish", re: /shank?l[e]?[e]?sh|شنكليش/i, q: ["shanklish"], parent: "labneh" },
  {
    key: "vine_leaves",
    re: /\bvine\b|vine leaves|grape leaves|warak|wara2|ورق عنب/i,
    q: ["stuffed grape leaves", "dolma"],
  },
  {
    key: "kibbeh_nayyeh",
    re: /\braw\b|nayy?eh|tab[e]?lah|tablieh|frakeh|kebbeh nayyeh|نيئ|نية$/i,
    q: ["kibbeh nayyeh"],
    parent: "kibbeh",
  },
  { key: "kibbeh", re: /keb+[e]?h|kib+[e]?h|kebbe|كبة|كبه/i, q: ["kibbeh", "fried kibbeh"] },
  {
    key: "sambousek",
    re: /sambo?u?s[e]?k|cheese rolls?|rkakat|rakakat|رقاقات|سمبوسك/i,
    q: ["sambousek", "cheese rolls fried"],
  },
  {
    key: "makanek",
    re: /makanek|maqanek|sujuk|soujouk|مقانق|سجق/i,
    q: ["makanek lebanese sausages"],
    parent: "grill",
  },
  { key: "foul", re: /\bfoul\b|ful medames|فول/i, q: ["ful medames"] },
  { key: "falafel", re: /falafel|فلافل/i, q: ["falafel", "falafel plate"] },
  { key: "koushari", re: /ko?ushari|koshari|كشري/i, q: ["koshari"] },
  { key: "shish_barak", re: /shish barak|ششبرك/i, q: ["shish barak"], parent: "kibbeh" },
  {
    key: "toum",
    re: /toum|garlic (sauce|cream|dip)|ثوم/i,
    q: ["toum garlic sauce"],
    parent: "dip",
  },
  {
    key: "mozzarella_sticks",
    re: /mozzarella (stick|brick)|halou?mi brick|jalape(n|ñ|ň)o.*(cheese|trian|bites)|cheddar jalape|cheesy bites/i,
    q: ["mozzarella sticks"],
    parent: "fries",
  },
  {
    key: "pickles",
    re: /pickle|^jalape(n|ñ|ň)os?$|مخلل|كبيس/i,
    q: ["pickles jar", "pickled vegetables"],
  },
  { key: "coleslaw", re: /coleslaw|كولسلو/i, q: ["coleslaw"], parent: "salad" },
  {
    key: "caesar_salad",
    re: /caesar|سيزر/i,
    q: ["caesar salad", "chicken caesar salad"],
    parent: "salad",
  },
  { key: "greek_salad", re: /greek/i, q: ["greek salad"], parent: "salad" },
  { key: "salad", re: /salad|rocca|roca|سلطة|سلطات|kale/i, q: ["green salad bowl", "fresh salad"] },
  // Grills and roast chicken.
  { key: "grill", re: /$^/, q: ["lebanese grilled meat skewers", "grilled meat platter"] },
  {
    key: "mixed_grill",
    re: /mix(ed)? grill|mashawi|مشاوي|charcoal grilled mixed/i,
    q: ["mixed grill platter", "lebanese mixed grill"],
    parent: "grill",
  },
  {
    key: "shish_taouk",
    re: /taouk|tawo+k|tawouk|طاووق|طاوق/i,
    q: ["shish tawook", "chicken skewers"],
    parent: "grill",
  },
  {
    key: "kafta",
    re: /kafta|kofta|كفتة|كفته/i,
    q: ["kafta skewers", "kofta kebab"],
    parent: "grill",
  },
  {
    key: "kebab",
    re: /kab[a]?b|kebab|orfali|كباب/i,
    q: ["kebab skewers", "shish kebab"],
    parent: "grill",
  },
  { key: "lamb_chops", re: /chops|ريش|kastaletta/i, q: ["lamb chops grilled"], parent: "grill" },
  {
    key: "liver",
    re: /liver|sawda|سودة|كبدة/i,
    q: ["fried chicken liver", "liver dish"],
    parent: "grill",
  },
  {
    key: "shawarma_plate",
    re: /shawarma.*(plat|plate|box)|شاورما.*(مقطع|صحن)|arabic box/i,
    q: ["shawarma plate"],
    parent: "shawarma",
  },
  { key: "shawarma", re: /shawarma|شاورما|شاورمة/i, q: ["shawarma wrap", "shawarma sandwich"] },
  { key: "smoked_rice", re: /rice|رز|ارز|أرز/i, q: ["chicken and rice", "rice dish"] },
  {
    key: "grilled_chicken",
    re: /grilled chicken|half chicken|فروج|دجاج مشوي|جوانح مشوية|chicken plate|power chicken|chicken breast/i,
    q: ["grilled chicken plate"],
    parent: "grill",
  },
  // Burgers, sandwiches and fried chicken.
  {
    key: "chicken_burger",
    re: /chicken.*burger|burger.*chicken|crispy (burger|cheddar)|zinger|تشكن برغر|تشيز تشكن|smoky crispy|korean crispy|bbq crispy|dynamite crispy|fried chicken$|spicy fried chicken|grilled chicken$|light grilled chicken|chicken fillet/i,
    q: ["crispy chicken burger", "chicken burger"],
    parent: "burger",
  },
  {
    key: "cheeseburger",
    re: /cheese ?burger|double cheese|تشيز برغر/i,
    q: ["cheeseburger"],
    parent: "burger",
  },
  {
    key: "burger",
    re: /burger|برغر|برجر|smash|angus|mushroom|caramelized|entrecote|american|lebanese$|classic$|truffle|patty|crunch$/i,
    q: ["beef burger", "gourmet burger"],
  },
  { key: "hot_dog", re: /hot ?dog/i, q: ["hot dog"], parent: "sub" },
  { key: "wrap", re: /wrap|tortilla|راب|عروس/i, q: ["chicken wrap", "tortilla wrap"] },
  {
    key: "sub",
    re: /\bsubs?\b|philly|cheesesteak|fajita|francisco|سوبريم|فرنسيسكو|فيلادلفيا|فاهيتا|baguette sandwich|alfredo \(|teriyaki|pesto|pepperoni sub/i,
    q: ["submarine sandwich", "sub sandwich"],
  },
  {
    key: "sandwich",
    re: /sandwich|ساندويش|سندويش|panini|toast|club|turkey|halloumi|melt|سندويشات/i,
    q: ["deli sandwich", "sandwich"],
  },
  {
    key: "steak",
    re: /steak|entrecote|grilled meat|لحمة مشوية|power beef|grilled angus/i,
    q: ["grilled steak"],
    parent: "grill",
  },
  {
    key: "wings",
    re: /wings?\b|جوانح|اجنحة/i,
    q: ["chicken wings", "buffalo wings"],
    parent: "fried_chicken",
  },
  { key: "nuggets", re: /nugg|popcorn|ناجتس/i, q: ["chicken nuggets"], parent: "fried_chicken" },
  {
    key: "fried_chicken",
    re: /broast|crisp|strip|tender|بروستد|كريسبي|زنجر|اسكالوب|escalope/i,
    q: ["fried chicken", "chicken tenders"],
  },
  { key: "onion_rings", re: /onion ring/i, q: ["onion rings"], parent: "fries" },
  {
    key: "loaded_fries",
    re: /loaded|topped|cheesy fries|cheddar bacon fries/i,
    q: ["loaded fries cheese"],
    parent: "fries",
  },
  { key: "curly_fries", re: /curly/i, q: ["curly fries"], parent: "fries" },
  { key: "fries", re: /fries|frites|potato|wedges|بطاطا|بطاطس/i, q: ["french fries"] },
  { key: "shrimp", re: /shrimp|prawn|crab|قريدس|جمبري/i, q: ["garlic shrimp", "fried shrimp"] },
  {
    key: "dip",
    re: /\bdips?\b|sauce|mayo|ketchup|chipotle|صلصة|مايونيز|^(bbq|cheddar|honey mustard|signature|volcano|thousand island|truffle|west sauce|louisiana|cocktail sauce|chilli sauce|toum)$/i,
    q: ["dipping sauces"],
  },
  // Pizza, pasta, Asian.
  {
    key: "pizza_margherita",
    re: /margh?er[i]?ta|margarita|مارغريتا/i,
    q: ["margherita pizza"],
    parent: "pizza",
  },
  {
    key: "pizza_pepperoni",
    re: /pep+eroni|salami|sausage|ببروني/i,
    q: ["pepperoni pizza"],
    parent: "pizza",
  },
  {
    key: "pizza",
    re: /pizza|بيتزا|ranch|bbq chicken|vegetarian|vegeterian/i,
    q: ["pizza", "chicken pizza"],
  },
  {
    key: "pasta_alfredo",
    re: /alfredo|fettuc+ine|ألفريدو/i,
    q: ["fettuccine alfredo"],
    parent: "pasta",
  },
  {
    key: "pasta",
    re: /pasta|spaghetti|penne|lasagn|macaroni|chinese|تشاينيز|معكرونة/i,
    q: ["spaghetti pasta plate"],
  },
  { key: "noodles", re: /noodle|soba|ramen/i, q: ["yakisoba noodles"], parent: "pasta" },
  { key: "sashimi", re: /sashimi/i, q: ["salmon sashimi"], parent: "sushi" },
  { key: "nigiri", re: /nigiri|gunkan|tobiko/i, q: ["nigiri sushi"], parent: "sushi" },
  { key: "edamame", re: /edamame/i, q: ["edamame"], parent: "sushi" },
  {
    key: "sushi",
    re: /sushi|maki|uramaki|futomaki|hosomaki|tempura roll|salmon skin|^cucumber$|brexley|^nature$|\(8 ?pcs\)/i,
    q: ["sushi rolls", "sushi platter"],
  },
  // Deli and grocery (when no packshot matched).
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
  { key: "eggs", re: /eggs?\b|بيض/i, q: ["eggs carton"], scope: "grocery" },
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
  {
    key: "cooking_oil",
    re: /corn oil|sunflower|afia|vegetable oil/i,
    q: ["cooking oil bottle"],
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

const BY_SECTION: [RegExp, string][] = [
  [/^mini$/i, "fatayer"],
  [/shake/i, "milkshake"],
  [/drink|beverage|soft|cold|مشروب/i, "soda"],
  [/coffee|hot bev|latte|filtered/i, "cappuccino"],
  [/dessert|sweet|ice cream|cup|حلو/i, "dessert"],
  [/dip|sauce|side cup/i, "dip"],
  [/salad|سلطات/i, "salad"],
  [/burger|add-?on|bun/i, "burger"],
  [/appeti|starter|side|مقبلات/i, "fries"],
  [/grill|plate|platter|meat|مشاوي|صحون/i, "grill"],
  [/sandwich|سندويش/i, "sandwich"],
  [/sub\b|subs|cold cut/i, "sub"],
  [/wrap/i, "wrap"],
  [/pizza|pasta/i, "pizza"],
  [/sushi|maki|hosomaki|futomaki|uramaki|gunkan/i, "sushi"],
  [/breakfast|saj|foron|manak/i, "manousheh"],
  [/meal|combo|kids|crispy|broast|chicken/i, "fried_chicken"],
  [/dairy/i, "milk"],
  [/bakery|bread|baguette|croissant/i, "bread"],
  [/pantry|staple/i, "canned_food"],
  [/snack/i, "chips"],
  [/household|baby/i, "household"],
  [/charcut/i, "cheese"],
  [/store|products/i, "grocery"],
  [/rice|ارز/i, "smoked_rice"],
];

const BY_TYPE: Record<string, string> = {
  bakery_manakish: "manousheh",
  sweets_pastry: "dessert",
  ice_cream: "ice_cream",
  cafe: "cappuccino",
  grocery_supermarket: "grocery",
  minimarket: "grocery",
  home_essentials: "household",
  butcher: "grill",
  poultry: "grilled_chicken",
  fast_food: "burger",
  restaurant: "mixed_grill",
};

export const DISH = new Map(DISHES.map((d) => [d.key, d]));

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

/** The dish key of an item ("none" for what has no food photo: shisha, a service, a "+ fries" combo upgrade). */
export function dishOf(item: ItemText): string {
  const shelf = isShelf(item);
  const dishes = DISHES.filter((d) => (shelf ? d.scope : d.scope !== "grocery"));
  const name = clean(`${item.name_en ?? ""} ${item.name_ar ?? ""}`);
  for (const d of dishes) if (d.re.test(name)) return d.key;
  if (shelf) return "grocery";
  const section = `${item.section_en ?? ""} ${item.section_ar ?? ""}`;
  const around = `${section} ${item.description ?? ""}`;
  if (DISH.get("none")!.re.test(section)) return "none";
  for (const d of dishes) if (d.key !== "none" && d.re.test(around)) return d.key;
  for (const [re, k] of BY_SECTION) if (re.test(section)) return k;
  return BY_TYPE[item.business_type ?? ""] ?? "mixed_grill";
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
