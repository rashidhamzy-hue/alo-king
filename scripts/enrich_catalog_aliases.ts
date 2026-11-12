// Generates Lebanese Arabic, Arabizi and short English aliases for every SKU in supabase/seed/catalog.csv
// and writes supabase/seed/product_aliases.csv. Deterministic: a reviewed lexicon, no model call at run time,
// so the output is diffable and a person can correct the lexicon and re-run.
//   node scripts/enrich_catalog_aliases.ts
// Review rule: an alias is what a Chouf customer would say or type for this item, not a translation of the label.
import { readFileSync, writeFileSync } from "node:fs";

type Rule = { match: RegExp; not?: RegExp; ar: string[]; az?: string[]; en?: string[] };

// What people call the thing. Order matters only for the brand combinations (first two Arabic terms are combined).
const TERMS: Rule[] = [
  // dairy and eggs
  { match: /labneh/, ar: ["لبنة", "لبنه"], az: ["labneh", "labne", "lebneh"] },
  { match: /\blaban\b/, ar: ["لبن", "سطل لبن"], az: ["laban"] },
  { match: /ayran/, ar: ["عيران", "لبن عيران"], az: ["ayran", "3ayran"] },
  { match: /kashkaval/, ar: ["قشقوان", "جبنة قشقوان"], az: ["kashkawan", "ashawan", "2ash2awan"] },
  { match: /mozzarella/, ar: ["موزاريلا", "جبنة موزاريلا", "جبنة بيتزا"], az: ["mozzarella", "mozarella"] },
  { match: /hallou/, ar: ["حلوم", "جبنة حلوم"], az: ["halloum", "7alloum", "halloumi"] },
  { match: /akkawi/, ar: ["عكاوي", "جبنة عكاوي", "جبنة بيضا"], az: ["akkawi", "3akkawi"] },
  { match: /double creme/, ar: ["دوبل كريم", "جبنة دوبل كريم", "جبنة بيضا"], az: ["double creme", "doubl krem"] },
  { match: /edam/, ar: ["ايدام", "جبنة ايدام", "جبنة صفرا"], az: ["edam"] },
  { match: /portions|kiri|picon/, ar: ["جبنة مثلثات", "جبنة مربعات", "جبنة دهن"], az: ["jebneh"] },
  { match: /cheese|kashkaval|hallou|akkawi|double creme|edam/, ar: ["جبنة", "جبنه"], az: ["jebneh", "jibneh"] },
  { match: /butter/, ar: ["زبدة", "زبده"], az: ["zebdeh", "zibdeh"] },
  { match: /cooking cream/, ar: ["كريما طبخ", "كريما", "كريمة للطبخ"], az: ["crema", "krema"] },
  { match: /whipping cream/, ar: ["كريما خفق", "كريما", "كريم شانتيه"], az: ["crema", "chantilly"] },
  { match: /greek yogurt/, ar: ["لبن يوناني", "يوغرت", "زبادي يوناني"], az: ["yogurt", "greek yogurt"] },
  { match: /\beggs?\b/, ar: ["بيض", "كرتونة بيض", "بيضات"], az: ["bayd", "beid"] },
  { match: /powder|klim/, ar: ["حليب بودرة", "حليب ناشف"], az: ["halib boudra"] },
  { match: /milk|lait(?! labneh| laban| halloum)/, not: /powder|klim|pain au lait|liban lait/, ar: ["حليب", "علبة حليب"], az: ["halib", "7alib"] },
  // cereals, bakery
  { match: /corn flakes/, ar: ["كورن فليكس", "سيريال"], az: ["cornflakes", "corn flakes"] },
  { match: /cereal bar/, ar: ["سيريال بار", "لوح سيريال"] },
  { match: /pita|arabic bread/, ar: ["خبز", "ربطة خبز", "خبز عربي"], az: ["khebez", "khobz", "5ebez", "rabtet khebez"] },
  { match: /piston|guette/, ar: ["خبز فرنجي", "فرنجي", "باغيت"], az: ["khebez franji", "franji", "baguette"] },
  { match: /pain au lait/, ar: ["بان او ليه", "خبز حليب"], az: ["pain au lait"] },
  { match: /tortilla/, ar: ["تورتيلا", "خبز تورتيلا"], az: ["tortilla"] },
  { match: /hot dog/, ar: ["خبز هوت دوغ", "هوت دوغ"], az: ["hot dog"] },
  { match: /tannour|oat bread|high fiber bread/, ar: ["خبز تنور", "خبز اسمر", "خبز شوفان"], az: ["khebez tannour", "khebez asmar"] },
  // deli, ready to eat, poultry
  { match: /turkey breast/, ar: ["صدر حبش", "حبش", "تركي"], az: ["habash", "7abash", "turkey"] },
  { match: /mortadel/, ar: ["مرتديلا", "مرتديلا بقر"], az: ["mortadella"] },
  { match: /pepperoni/, ar: ["بيبيروني", "ببروني"], az: ["pepperoni"] },
  { match: /garlic/, ar: ["توم", "ثوم", "كريم توم"], az: ["toum"] },
  { match: /hommos/, ar: ["حمص", "حمص بطحينة"], az: ["hommos", "hummus", "7ommos"] },
  { match: /chicken legs/, ar: ["فخاد دجاج", "فخاد", "وراك دجاج"], az: ["fkhad djej"] },
  { match: /chicken (filet|fillet|breast)/, not: /breaded|frozen/, ar: ["صدر دجاج", "فيليه دجاج", "سفاين دجاج"], az: ["sder djej", "filet djej"] },
  { match: /breaded chicken/, ar: ["اسكالوب", "اسكالوب دجاج", "دجاج بانيه"], az: ["escalope"] },
  { match: /tender|strips/, ar: ["تندرز", "ستربس دجاج", "كريسبي"], az: ["tenders", "crispy"] },
  { match: /sawda/, ar: ["سودة دجاج", "سودا"], az: ["sawda"] },
  { match: /nuggets/, ar: ["ناغتس", "ناجتس دجاج"], az: ["nuggets"] },
  { match: /chicken/, not: /stock|luncheon|noodles|cube/, ar: ["دجاج", "فروج"], az: ["djej"] },
  // water and drinks
  { match: /sparkling/, ar: ["مي غازية", "صودا"], az: ["soda", "sparkling"] },
  { match: /water/, not: /sparkling|tuna/, ar: ["مي", "مياه", "قناني مي"], az: ["may", "mayy", "water"] },
  { match: /gallon|10l/, ar: ["غالون مي", "قنينة مي كبيرة"], az: ["gallon may"] },
  { match: /pepsi.*diet/, ar: ["بيبسي دايت", "دايت بيبسي"], az: ["pepsi diet", "diet pepsi"] },
  { match: /pepsi/, not: /diet/, ar: ["بيبسي", "بيبسي عادي"], az: ["pepsi"] },
  { match: /7up/, ar: ["سفن اب", "سفن"], az: ["seven up", "7up", "sevenup"] },
  { match: /mirinda/, ar: ["ميرندا"], az: ["mirinda", "miranda"] },
  { match: /energy drink/, ar: ["مشروب طاقة"], az: ["energy drink"] },
  { match: /juice.*pineapple/, ar: ["عصير اناناس"], az: ["3asir ananas"] },
  { match: /juice.*mango/, ar: ["عصير منغا", "عصير مانجو"], az: ["3asir manga"] },
  { match: /juice.*apple/, ar: ["عصير تفاح"], az: ["3asir teffe7"] },
  { match: /juice|nectar/, ar: ["عصير"], az: ["3asir", "aseer", "juice"] },
  { match: /ice tea/, ar: ["ايس تي", "شاي مثلج"], az: ["ice tea", "iced tea"] },
  // hot beverages
  { match: /3in1/, ar: ["نسكافيه ٣ ب ١", "تلاتة بواحد", "نسكافيه"], az: ["3in1", "3 in 1"] },
  { match: /2in1/, ar: ["نسكافيه ٢ ب ١", "تنين بواحد", "نسكافيه"], az: ["2in1", "2 in 1"] },
  { match: /instant coffee/, ar: ["نسكافيه", "قهوة سريعة التحضير"], az: ["nescafe"] },
  { match: /najjar.*cardamom/, ar: ["قهوة مع هال", "بن مع هال"], az: ["ahweh ma3 hal"] },
  { match: /najjar|star café/, not: /instant/, ar: ["قهوة", "بن", "قهوة مطحونة"], az: ["ahweh", "2ahwe", "bin"] },
  { match: /creamer/, ar: ["كوفي مايت", "مبيض قهوة"], az: ["coffee mate"] },
  { match: /cappuc/, ar: ["كابتشينو"], az: ["cappuccino"] },
  { match: /\btea\b/, not: /ice tea/, ar: ["شاي", "شاي اكياس"], az: ["shay", "chai", "tea"] },
  { match: /hot chocolate/, ar: ["شوكولا ساخنة", "هوت شوكليت"], az: ["hot chocolate"] },
  // snacks
  { match: /nutella|hazelnut/, ar: ["نوتيلا", "شوكولا دهن"], az: ["nutella"] },
  { match: /wafer|kit kat/, ar: ["ويفر", "شوكولا"], az: ["wafer"] },
  { match: /chocolate|cocoa coated|kinder|snickers|albeni|metro/, not: /hot chocolate|nutella|biscuit/, ar: ["شوكولا", "شوكولاتة", "لوح شوكولا"], az: ["chocola", "chocolate"] },
  { match: /tahina/, not: /hommos/, ar: ["طحينة", "طحينه"], az: ["tahini", "t7ine"] },
  { match: /\bjam\b/, ar: ["مربى", "مربى فريز"], az: ["mrabba"] },
  { match: /biscuit|cookie|bake rolz/, ar: ["بسكويت", "بسكوت"], az: ["biskot", "baskot", "biscuit"] },
  { match: /chips|puffs/, ar: ["شيبس", "تشيبس"], az: ["chips"] },
  { match: /peanuts \d/, ar: ["فستق", "فستق سوداني", "فستق عبيد"], az: ["festo2", "fosto2"] },
  { match: /cashew/, ar: ["كاجو"], az: ["kajou", "cashew"] },
  { match: /\bgum\b/, ar: ["علكة", "علكه"], az: ["3elke", "gum"] },
  { match: /mentos/, ar: ["منتوس", "ملبس"], az: ["mentos"] },
  // pantry
  { match: /stock cube/, ar: ["مكعبات مرقة", "ماجي", "مرقة دجاج"], az: ["maggi"] },
  { match: /noodles/, ar: ["اندومي", "نودلز"], az: ["indomie", "noodles"] },
  { match: /spaghetti/, ar: ["سباغيتي", "معكرونة", "معكرونه"], az: ["spaghetti", "ma3karone"] },
  { match: /tagliatelle/, ar: ["تالياتيلي", "معكرونة"], az: ["tagliatelle", "ma3karone"] },
  { match: /vermicelli/, ar: ["شعيرية", "شعيريه"], az: ["sh3ayriyeh"] },
  { match: /thyme/, ar: ["زعتر", "زعتر حلبي"], az: ["za3tar", "zaatar"] },
  { match: /red split lentils|majrouch/, ar: ["عدس احمر", "عدس مجروش", "عدس"], az: ["3adas a7mar", "3adas"] },
  { match: /green lentils/, ar: ["عدس اخضر", "عدس", "عدس حب"], az: ["3adas akhdar", "3adas"] },
  { match: /basmati/, ar: ["رز بسمتي", "رز", "ارز بسمتي"], az: ["rez basmati", "rez"] },
  { match: /italian rice/, ar: ["رز", "رز ايطالي", "رز مصري"], az: ["rez", "riz"] },
  { match: /corn flour/, ar: ["نشا", "نشاء"], az: ["nesha"] },
  { match: /\bflour\b/, not: /corn flour/, ar: ["طحين", "كيلو طحين"], az: ["t7in", "flour"] },
  { match: /burghul/, ar: ["برغل", "برغل خشن"], az: ["burghul", "bur8ol"] },
  { match: /sweet corn/, ar: ["ذرة", "درة", "علبة ذرة"], az: ["dara", "corn"] },
  { match: /fava|foul/, ar: ["فول", "فول مدمس", "علبة فول"], az: ["foul"] },
  { match: /sardine/, ar: ["سردين", "علبة سردين"], az: ["sardine"] },
  { match: /tuna/, ar: ["تونا", "طون", "علبة تونا"], az: ["tuna", "ton"] },
  { match: /chick peas/, ar: ["حمص حب", "حمص مسلوق", "علبة حمص"], az: ["hommos 7ab"] },
  { match: /luncheon/, ar: ["لانشون", "مرتديلا علب"], az: ["luncheon"] },
  { match: /olives/, ar: ["زيتون"], az: ["zaytoun"] },
  { match: /pickles/, ar: ["كبيس", "مخلل", "كبيس مشكل"], az: ["kabis"] },
  // cooking
  { match: /sunflower oil/, ar: ["زيت", "زيت دوار الشمس", "زيت قلي"], az: ["zet", "zeit"] },
  { match: /olive oil/, ar: ["زيت زيتون"], az: ["zet zaytoun"] },
  { match: /tomato paste/, ar: ["رب بندورة", "رب البندورة", "معجون بندورة"], az: ["rob banadoura"] },
  { match: /strained tomatoes/, ar: ["صلصة بندورة", "عصير بندورة"], az: ["salsa banadoura"] },
  { match: /vinegar/, ar: ["خل", "خل ابيض"], az: ["khal", "5al"] },
  { match: /mayonnaise/, ar: ["مايونيز"], az: ["mayonnaise", "mayo"] },
  { match: /ketchup/, ar: ["كاتشاب", "كتشب"], az: ["ketchup"] },
  { match: /molasses/, ar: ["دبس رمان"], az: ["debs remman"] },
  { match: /hot sauce/, ar: ["صلصة حارة", "شطة"], az: ["hot sauce"] },
  { match: /\bsalt\b/, not: /chips/, ar: ["ملح"], az: ["mele7", "meleh"] },
  { match: /ghee/, ar: ["سمنة", "سمنه"], az: ["samneh"] },
  { match: /sugar \d|sugar$/, not: /zero sugar|no sugar/, ar: ["سكر", "كيلو سكر"], az: ["sekkar", "sukkar"] },
  { match: /jelly/, ar: ["جيلو", "جيلي"], az: ["jello", "jelly"] },
  { match: /vanill/, ar: ["فانيلا", "سكر فانيلا"], az: ["vanilla"] },
  { match: /bicarbonate/, ar: ["بيكربونات", "كربونة"], az: ["karbone"] },
  { match: /baking powder/, ar: ["بيكنغ باودر", "خميرة حلويات"], az: ["baking powder"] },
  // frozen
  { match: /ice cream|dolsi (vegas|amarena)/, ar: ["بوظة", "بوظه", "ايس كريم"], az: ["bouza", "ice cream"] },
  { match: /crab/, ar: ["كراب", "سوريمي"], az: ["crab"] },
  { match: /peas & carrots/, ar: ["بازيلا وجزر", "بازيلا"], az: ["bazella w jazar"] },
  { match: /green peas/, ar: ["بازيلا", "بازيلاء"], az: ["bazella"] },
  { match: /fries/, ar: ["بطاطا مقلية", "بطاطا مجلدة", "فرايز"], az: ["batata me2liye", "fries"] },
  { match: /fish|pangasius/, ar: ["سمك فيليه", "فيليه سمك", "سمك"], az: ["samak", "filet samak"] },
  { match: /mulukhieh/, ar: ["ملوخية", "ملوخيه"], az: ["mloukhiyeh"] },
  { match: /pizza/, not: /puffs|mozzarella/, ar: ["بيتزا", "بيتزا مجلدة"], az: ["pizza"] },
  { match: /rice cake/, ar: ["كعك رز", "رايس كيك"], az: ["rice cake"] },
  { match: /protein crackers/, ar: ["كراكرز بروتين"], az: ["protein crackers"] },
  // household
  { match: /toilet cleaner/, ar: ["منظف حمام", "فلاش"], az: ["flash"] },
  { match: /interfold|facial tissue/, ar: ["محارم", "كلينكس", "علبة محارم", "مناديل"], az: ["mhareem", "ma7arem", "kleenex"] },
  { match: /trash bags/, ar: ["اكياس زبالة", "كياس زبالة", "اكياس نفايات"], az: ["kyes zbeleh"] },
  { match: /dishwash/, ar: ["دوا جلي", "سائل جلي", "صابون جلي"], az: ["dawa jali"] },
  { match: /bleach/, ar: ["كلور", "جافيل", "ماء جافيل"], az: ["javel", "clor"] },
  { match: /sandwich bag/, ar: ["اكياس سندويش", "كياس سندويش"], az: ["kyes sandwich"] },
  { match: /fabric softener/, ar: ["منعم غسيل", "كومفورت", "معطر غسيل"], az: ["comfort"] },
  { match: /kitchen towel/, ar: ["محارم مطبخ", "ورق مطبخ"], az: ["mhareem matbakh"] },
  { match: /laundry detergent|gel detergent/, ar: ["دوا غسيل", "سائل غسيل", "مسحوق غسيل"], az: ["dawa ghasil"] },
  { match: /floor detergent/, ar: ["دوا مسح", "منظف ارضيات"], az: ["dawa mase7"] },
  { match: /sponge/, ar: ["اسفنجة", "ليفة جلي"], az: ["sfenje"] },
  { match: /toilet paper/, ar: ["ورق تواليت", "ورق حمام", "محارم تواليت"], az: ["wara2 twalet"] },
  // personal care, baby, pet
  { match: /wet wipes/, ar: ["محارم مبللة", "مناديل مبللة"], az: ["wet wipes", "mhareem mballale"] },
  { match: /feminine pads/, ar: ["فوط نسائية", "فوط صحية"], az: ["pads"] },
  { match: /liquid soap/, ar: ["صابون سائل", "صابون ايدين"], az: ["saboun"] },
  { match: /cotton buds/, ar: ["عيدان قطن", "اعواد قطن"], az: ["cotton buds"] },
  { match: /cotton round/, ar: ["قطن", "قطن دوائر"], az: ["cotton"] },
  { match: /toothpaste/, ar: ["معجون اسنان", "معجون سنان"], az: ["ma3joun snen"] },
  { match: /cream bar/, ar: ["صابون", "صابونة"], az: ["saboun"] },
  { match: /baby shampoo/, ar: ["شامبو اطفال", "شامبو بيبي"], az: ["baby shampoo"] },
  { match: /shampoo/, not: /baby/, ar: ["شامبو"], az: ["shampoo"] },
  { match: /roll on/, ar: ["مزيل عرق", "رول اون", "ديودوران"], az: ["deodorant", "roll on"] },
  { match: /diapers/, ar: ["حفاضات", "حفاضات اطفال", "بامبرز"], az: ["7afadat", "pampers"] },
  { match: /gatto/, ar: ["اكل بسين", "اكل قطط", "طعام قطط"], az: ["akel bsein"] },
  { match: /cat litter/, ar: ["رمل بسين", "رمل قطط"], az: ["ramel bsein"] },
  // local produce and butcher (Arabic name already in the catalog; these add spellings and Arabizi)
  { match: /^potato/, ar: ["بطاطا", "بطاطه"], az: ["batata"] },
  { match: /^tomato/, ar: ["بندورة", "بندوره", "طماطم"], az: ["banadoura"] },
  { match: /^cherry tomatoes/, ar: ["بندورة كرزية", "بندورة شيري"], az: ["banadoura cherry"] },
  { match: /^cucumber/, ar: ["خيار"], az: ["khyar", "5yar"] },
  { match: /^onion, red/, ar: ["بصل احمر"], az: ["basal a7mar"] },
  { match: /^onion$/, ar: ["بصل"], az: ["basal"] },
  { match: /^lemon/, ar: ["حامض", "ليمون حامض"], az: ["7amod", "hamod"] },
  { match: /^orange for juice/, ar: ["ليمون عصير", "برتقال عصير", "ليمون"], az: ["laymoun 3asir"] },
  { match: /^orange, valencia/, ar: ["برتقال", "ليمون ابو صرة"], az: ["laymoun", "bourtou2an"] },
  { match: /^zucchini/, ar: ["كوسا", "كوسى"], az: ["kousa"] },
  { match: /^carrot/, ar: ["جزر"], az: ["jazar"] },
  { match: /^banana/, ar: ["موز"], az: ["moz", "mawz"] },
  { match: /^parsley/, ar: ["بقدونس", "باقة بقدونس"], az: ["ba2dounes"] },
  { match: /^green beans/, ar: ["لوبيا", "لوبيه"], az: ["loubieh"] },
  { match: /^lettuce/, ar: ["خس", "خسة"], az: ["khass", "5ass"] },
  { match: /^green pepper/, ar: ["فليفلة", "فليفلة خضرا"], az: ["flayfleh"] },
  { match: /^eggplant/, ar: ["باذنجان", "بتنجان"], az: ["batenjen"] },
  { match: /^coriander/, ar: ["كزبرة", "كزبره"], az: ["kezebra"] },
  { match: /^cauliflower/, ar: ["زهرة", "قرنبيط"], az: ["zahra", "arnabit"] },
  { match: /^cabbage/, ar: ["ملفوف"], az: ["malfouf"] },
  { match: /^apple/, ar: ["تفاح", "تفاح احمر"], az: ["teffe7", "teffeh"] },
  { match: /^rocca/, ar: ["روكا", "جرجير"], az: ["rocca"] },
  { match: /^mint/, ar: ["نعنع", "باقة نعنع"], az: ["na3na3"] },
  { match: /^radish/, ar: ["فجل"], az: ["fejel"] },
  { match: /^garlic$/, ar: ["توم", "ثوم", "راس توم"], az: ["toum"] },
  { match: /^minced beef/, ar: ["لحمة مفرومة", "لحمة", "لحمه مفرومه"], az: ["la7me mafroume", "lahme"] },
  { match: /^kafta/, ar: ["كفتة", "كفته"], az: ["kafta"] },
  { match: /taouk/, ar: ["طاووق", "شيش طاووق", "طاوق"], az: ["taouk", "tawouk"] },
  { match: /^beef cubes/, ar: ["راس عصفور", "لحمة مكعبات", "لحمة"], az: ["ras 3asfour"] },
];

// How people write the brand. Keys are lowercase brand names as they appear in the catalog.
const BRANDS: Record<string, string[]> = {
  "pepsi": ["بيبسي"], "7up": ["سفن اب"], "mirinda": ["ميرندا"], "nescafe": ["نسكافيه"], "najjar": ["نجار"], "lipton": ["ليبتون"],
  "nutella": ["نوتيلا"], "kinder": ["كيندر"], "kit kat": ["كيت كات"], "oreo": ["اوريو"], "snikers": ["سنيكرز"], "maggi": ["ماجي"],
  "indomie": ["اندومي"], "barilla": ["باريلا"], "candia": ["كانديا"], "tannourine": ["تنورين"], "sohat": ["صحة"], "rim": ["ريم"],
  "nestle": ["نستله"], "puck": ["بوك"], "kiri": ["كيري"], "picon": ["بيكون"], "lurpak": ["لورباك"], "président": ["بريزيدان"],
  "leentaanayel": ["تعنايل", "لين تعنايل"], "liban lait": ["ليبان ليه"], "dairy khoury": ["خوري"], "hawa chicken": ["هوا تشيكن", "هوا"],
  "tanmia": ["تنمية"], "wilco": ["ويلكو"], "plein soleil": ["بلان سولاي"], "yamama": ["يمامة"], "deroni": ["ديروني"], "cortas": ["قرطاس"],
  "al wadi al akhdar": ["الوادي الاخضر"], "chtoura garden": ["شتورا غاردن"], "siblou": ["سيبلو"], "master": ["ماستر"], "dolsi": ["دولسي"],
  "comfort": ["كومفورت"], "omo": ["اومو"], "odex": ["اودكس"], "sanita": ["سانيتا"], "colgate": ["كولجيت"], "dove": ["دوف"], "nivea": ["نيفيا"],
  "head & shoulders": ["هيد اند شولدرز"], "johnson": ["جونسون"], "oui oui": ["وي وي"], "loulou": ["لولو"], "private": ["برايفت"],
  "kellogg's": ["كيلوغز"], "klim": ["كليم"], "coffee mate": ["كوفي مايت"], "tchibo": ["تشيبو"], "dark blue": ["دارك بلو"], "domo": ["دومو"],
  "zer": ["زير"], "lina": ["لينا"], "gold medal": ["غولد ميدال"], "mentos": ["منتوس"], "clorets": ["كلوريتس"], "castania": ["كاستانيا"],
  "al ousra": ["الاسرة"], "perla": ["بيرلا"], "vimax": ["فيماكس"], "wooden bakery": ["وودن بيكري"], "pain d'or": ["بان دور"],
  "foody's": ["فوديز"], "ulker": ["اولكر"], "tiffany": ["تيفاني"], "nadec": ["نادك"], "top": ["توب"], "uno": ["اونو"], "wellplus": ["ويل بلس"],
  "well plus": ["ويل بلس"], "spartan": ["سبارتان"], "germex": ["جرمكس"], "taj": ["تاج"], "abou rached": ["ابو راشد"], "abo rashed": ["ابو راشد"],
  "maxim's": ["مكسيمز"], "dolly's": ["دوليز"], "pomi": ["بومي"], "al koura products": ["الكورة"], "al wazir": ["الوزير"], "aruba": ["اروبا"],
  "tora bika": ["تورا بيكا"], "cafe21": ["كافيه ٢١"], "maestro": ["مايسترو"], "vitalis": ["فيتاليس"], "talaya": ["تلايا"], "nejmeh": ["نجمة"],
  "aqua family": ["اكوا فاميلي"], "take n bake": ["تيك ان بيك"], "liban frites": ["ليبان فريت"], "al forno": ["الفورنو"], "mazaraana": ["مزارعنا"],
  "happy basket": ["هابي باسكت"], "al arabiya": ["العربية"], "zain": ["زين"], "intaj": ["انتاج"], "rosana": ["روزانا"], "april": ["ابريل"],
  "lu": ["لو"], "edita": ["اديتا"], "gipsy": ["جيبسي"], "amalfi": ["امالفي"], "miglior": ["ميليور"], "mr juicy": ["مستر جوسي"],
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
// Fold spelling variants that people mix freely, so "لبنه" and "لبنة" do not need separate rows at query time.
export const foldArabic = (s: string) => s.replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/[ً-ْـ]/g, "").trim();

const [header, ...rows] = parseCsv(readFileSync("supabase/seed/catalog.csv", "utf8"));
const col = (name: string) => header!.indexOf(name);
const out: string[] = ["sku,alias,lang"];
const uncovered: string[] = [];
let total = 0;

for (const r of rows) {
  if (!r[col("SKU")]) continue;
  const sku = r[col("SKU")]!, item = r[col("Item")]!, brand = r[col("Brand")]!.toLowerCase(), nameAr = r[col("Arabic name")] ?? "";
  const name = item.toLowerCase();
  const seen = new Set<string>();
  const add = (alias: string, lang: string) => {
    const a = lang === "ar" ? foldArabic(alias) : alias.toLowerCase().trim();
    const k = lang + "|" + a;
    if (!a || seen.has(k)) return;
    seen.add(k); out.push([sku, esc(a), lang].join(",")); total++;
  };
  if (nameAr) add(nameAr, "ar");
  const termAr: string[] = [];
  for (const t of TERMS) {
    if (!t.match.test(name) || (t.not && t.not.test(name))) continue;
    t.ar.forEach((a) => { add(a, "ar"); termAr.push(a); });
    (t.az ?? []).forEach((a) => add(a, "arabizi"));
    (t.en ?? []).forEach((a) => add(a, "en"));
  }
  const brandAr = BRANDS[brand] ?? [];
  brandAr.forEach((b) => add(b, "ar"));
  for (const b of brandAr.slice(0, 1)) for (const t of termAr.slice(0, 2)) add(`${t} ${b}`, "ar");   // "لبنة تعنايل"
  if (brand && brand !== "local (unbranded)") add(brand, "en");
  if (termAr.length === 0) uncovered.push(`${sku} ${item}`);
}

writeFileSync("supabase/seed/product_aliases.csv", out.join("\n") + "\n");
console.log(`aliases: ${total} for ${rows.filter((r) => r[0]).length} SKUs; SKUs with no spoken-term rule: ${uncovered.length}`);
uncovered.forEach((u) => console.log("  no rule:", u));
