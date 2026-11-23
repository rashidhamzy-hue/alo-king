// M1: the shape every language file fills. A key missing in one language is a type error, so ar, en and fr always hold the same
// messages. Code builds every fixed message from these; the model writes none of them (SYSTEM_BRIEF "Message design").
//
// Writing rules (CX2, approved by the founder 18 November 2026, docs/MESSAGES.md; checked on every template, in every language, by
// packages/agents/test/messages.rules.test.ts):
//  1. One message, one job; no line longer than about three phone lines. A message of more than one line opens with a bold heading line.
//  2. Only these 22 emojis: 📍 🛒 🛵 ✅ 💵 🌙 ⚠️ 📦 🏠 🔢 ⏱️ 🔁 🕘 👋 🙏 🔎 ✏️ ❌ 💬 ☀️ 👇 📝; one at the start of a line, never inside
//     or at the end of one; at most six in an order card, three elsewhere. 👑 is retired.
//  3. WhatsApp bold (*text*): headings, the order number (always bold), the total, the gap to the minimum, a button's name to tap.
//     Italic (_text_) only for the consent and privacy lines.
//  4. At most one amount a line, at its end after « · » (or alone); Western digits, `$` for dollars. Choices are list messages.
// Amounts are formatted here (usd, lbp) and only from numbers code got from the database.

export type Lang = "ar" | "en" | "fr";
export type PayMethod = "cod" | "whish" | "omt";
type S = string;

/** Dollars as WhatsApp shows them everywhere: $7.27. Western digits, two decimals. */
export const usd = (n: number): string => `${Number(n) < 0 ? "-" : ""}$${Math.abs(Number(n)).toFixed(2)}`;
/** Lira grouped with commas, Western digits: 650,000. The unit word comes from the language file. */
export const grouped = (n: number): string => Math.round(Number(n)).toLocaleString("en-US");
/** PD1: "a", "a and b", "a, b and c" with the language's own "and" (Arabic: «أ، ب وج», the و joined to the last word). */
export const list = (items: string[], and: string): string => {
  const xs = items.filter(Boolean);
  if (xs.length <= 1) return xs[0] ?? "";
  const sep = and === "و" ? "، " : ", ";
  return `${xs.slice(0, -1).join(sep)} ${and === "و" ? "و" : and + " "}${xs[xs.length - 1]}`;
};
/** B1b (SIM1 fix 7): a list of names written over as many lines as it needs, none longer than `max` (message rule 1). */
export const wrapNames = (head: string, names: string[], sep: string, end = ".", max = 110): string => {
  const lines: string[] = []; let cur = head;
  names.forEach((n, i) => {
    const piece = n + (i === names.length - 1 ? end : sep.trimEnd());
    if (cur && (cur + " " + piece).length > max) { lines.push(cur); cur = piece; } else cur = cur ? `${cur} ${piece}` : piece;
  });
  if (cur) lines.push(cur);
  return lines.join("\n");
};

/** The return card's lines grouped under two headings (one emoji each), so a long return never passes three emojis. */
export const returnGroups = (head: string, back: string, waste: string, lines: { qty: number; name: string; restock: boolean }[]): string => {
  const kept = lines.filter((l) => l.restock), gone = lines.filter((l) => !l.restock);
  const rows = (ls: typeof lines) => ls.map((l) => `${l.qty} × ${l.name}`);
  return [head, ...(kept.length ? ["", back, ...rows(kept)] : []), ...(gone.length ? ["", waste, ...rows(gone)] : [])].join("\n");
};

export interface Messages {
  lang: Lang;
  /** How a list of names is joined, and the unit after a lira amount. */
  join: (items: string[]) => S;
  lbp: (n: number) => S;
  /** A label and one amount on one line: "التوصيل: $1.00", "Livraison : $1.00". */
  amount: (label: S, usd: number) => S;
  days: { names: S[]; today: S; tomorrow: S; dateSep: S };

  card: {
    heading: (code: S) => S;
    item: (qty: S, name: S, extras: S[]) => S;
    more: (n: number) => S;
    /** CX2: the items' sum, the first line of the totals block, and the note on a card whose items went in the message before. */
    items: S; itemsAbove: S;
    delivery: (village: S | null) => S;
    smallOrder: S;
    dues: S;
    credit: S;
    total: S;
    orLbp: (lbp: number) => S;
    address: (where: S) => S;
    pickup: S;
    eta: (minutes: number) => S;
    deliverNow: S;
    window: (label: S) => S;
    payment: (method: PayMethod) => S;
    payName: Record<PayMethod, S>;
    changeFor: S;
    /** WEB2: cash in lira; the amount the customer will hand over, on the next line (in LBP). */
    changeForLbp: S;
    prepayFirst: (how: S, cap: number) => S;
    prepay: (how: S) => S;
    replaces: (code: S) => S;
    /** CFG1: this card is a lapsed order opened again (orders.reopened_from): the old order's code. */
    reopenedFrom: (code: S) => S;
    consent: S;
    confirm: S; edit: S; cancel: S;
    /** FD2: a food order names its place under the heading («🍗 من: <place>»), and the food service fee's line (when above 0). */
    from: (place: S) => S;
    serviceFee: S;
  };

  /** The fixed replies to the card's buttons (2.8 adds the window). */
  tap: {
    confirmed: (code: S) => S;
    confirmedFor: (code: S, when: S) => S;
    replaced: (code: S, old: S, when: S) => S;
    awaitingPayment: (code: S, when: S | null, total: number, channel: S) => S;
    channel: (method: "whish" | "omt", to: S | null) => S;
    draft: (code: S) => S;
    cancelled: (code: S) => S;
    cancelledCredit: (code: S, credit: number) => S;
    slotFull: (code: S, when: S | null) => S;
    slotClosed: (code: S, when: S | null) => S;
    changeOpen: (code: S, when: S | null) => S;
    tooLate: (code: S, when: S | null) => S;
    inProgress: (code: S) => S;
    needsLocation: S;
  };

  fixed: {
    audioUnusable: S; handoff: S; optOut: S; optIn: S; outOfStock: S; error: S;
    /** LV1: the reply to "Claim <listing_id>" (read by code). We will be in touch; nothing about the listing changes and nothing can be ordered. */
    listingClaimed: (name: S) => S;
    notAvailable: (shops: S[]) => S;
    oneMoment: S; offTopic: S;
    askPhone: S; badPhone: S; phoneSaved: S;
    askPin: S;
    /** B1b (coordinator decision 3): a first order without a pin, accepted with the village and a landmark typed. */
    noPinCall: (village: S) => S; askVillageLandmark: S;
    /** The note on the order for the rider and ops (staff language). */
    noPinNote: S;
    /** B1b (SIM1 fix 8): the answer to a thank-you or a goodbye. */
    welcome: S;
    pinReceived: (village: S) => S;
    askAddress: S;
    pinVillage: (pin: S, said: S) => S;
    askVillage: S; pinOutside: S;
    pinSaved: (village: S) => S;
    fxPaused: S; pinVillageRefused: S;
    /** B1c: `items` ("2 × name"), the basket kept, so the customer sees it and never says it again to have it added. */
    closedKept: (opens: S, items?: S[]) => S;
    closedKeptPin: (opens: S, items?: S[]) => S;
    keptButton: S;
    keptOpen: S;
    keptGone: S;
    /** A product's price under the Concierge's words (`reply` with `price_of`): the name, then the price on its own line. */
    priced: (name: S, price: number, available: boolean) => S;
  };

  windows: {
    choose: S; button: S; now: S; none: S; gone: S; noneAt: S; noneAtAll: S; nowUnavailable: S; orChoose: S;
    freshForWindow: (names: S[]) => S;
    pickupNoWindow: S;
    notChangeable: (code: S) => S;
  };

  answer: {
    noOpenOrder: S;
    /** B1c: "where is my order?" with no open order and nothing in hand, from a customer with a closed order: that order is offered. */
    noOpenRepeat: (items: S[], more: number) => S;
    awaitingConfirmation: (code: S, when: S | null) => S;
    awaitingPayment: (code: S, when: S | null, total: number) => S;
    confirmedFor: (code: S, when: S) => S;
    preparingFor: (code: S, when: S) => S;
    preparing: (code: S, eta: number | null) => S;
    ready: (code: S, pickup: boolean) => S;
    /** CX2: `cash`, for cash on delivery, the amount the rider collects (orders.total_usd, as rider_job). */
    onTheWay: (code: S, eta: number | null, cash?: number | null) => S;
    arrived: (code: S) => S;
    delivered: (code: S) => S;
    failed: (code: S) => S;
    other: (code: S) => S;
    hours: (open: S, close: S, openNow: boolean) => S;
    /** CX2: never a list of villages (the founder's chat, 07:38): it asks for the village or the location (a location request). */
    outOfArea: (said: S) => S;
    inArea: (village: S, fee: number, eta: number) => S;
    noPrevious: S;
    allMissing: (names: S[]) => S;
    /** The greeting with the repeat button (👋; CX2 retired 👑). */
    repeatOffer: (items: S[], more: number) => S;
    repeatButton: S;
    stale: S;
    someMissing: (names: S[]) => S;
    /** "How much in lira?" (founder decision 2): today's rate from current_fx(), and the open order in lira at its own rate. */
    lira: (rate: number, order: { code: S; usd: number; lbp: number } | null) => S;
    noRate: S;
  };

  /**
   * B1a (SIM1 fixes 1, 3, 4 and 9): the basket the customer is building, said by code. The minimum and the gap come from the
   * quote (quote_order's below_minimum issue); the model never words them. `changed` heads a new card that changed the basket.
   */
  basket: {
    /** The minimum order, the basket now and what is missing, each on its own line; buttons follow. */
    minimum: (min: number, now: number, gap: number, items?: S[]) => S;
    /** B1c, CX2: the customer named only the kind or the brand («ربطة خبز», "Pepsi"): which one, as a list message of `count` rows
     *  (each a product's short name, its full name and price under it, built by code, choice.ts). */
    which: (said: S, count: number) => S;
    whichButton: S;
    /** B1c: the shop's house default was given for a generic word: which product it is, and that the customer may change it. */
    houseDefault: (said: S, name: S) => S;
    /** "What is the minimum?" with no basket yet. */
    minimumIs: (min: number) => S;
    cancelButton: S;
    /** The customer let the basket go: nothing is sent. */
    cleared: S;
    /** "Where is my order?" while a basket is being built and no order exists yet. */
    soFar: (items: S[]) => S;
    /** A new card after a change: the rows (+ added, − removed, qty from → to) are built by code. */
    changed: (rows: S[]) => S;
    /** Items of the basket no longer available when it was about to go. */
    unavailable: (names: S[]) => S;
    /** SELL1 (0226): a packaged item that has no label reading yet cannot be sold: said by code, never a date, never a reason about the product. */
    comingSoon: (names: S[]) => S;
    /** A cancel the database refused (the order is being prepared or is on its way): a person is told and will call. */
    cancelRefused: (code: S) => S;
  };

  payment: { proofReceived: (code: S) => S; proofResend: S };
  /** WEB2: the website's sign-in and its card, answered by code before any model (turn.ts). */
  web: {
    /** The link code arrived from this number: the website is signed in. */
    linked: S;
    /** The code is older than its minutes, or its website session ended. */
    codeExpired: S;
    /** Another number already used this code. */
    codeUsed: S;
    /** We do not know this code. */
    codeUnknown: S;
    /** "Sign out": every website session of this number ended (n of them), or none was signed in. */
    signedOut: (n: number) => S;
    notSignedIn: S;
    /** "Card AK-xxxx" for an order that no longer waits for its Confirm, or that is not theirs. */
    cardNotWaiting: (code: S) => S;
    cardUnknown: S;
  };

  /**
   * CX1 (the customer pack, docs/strategy/02 section 1 and 03 section B): the first-ever welcome with its privacy line, the card's two
   * choices (a missing item, the note the customer pays with and the change kept as credit), self-service cancel, the handover code
   * and pickup at the hub. Every amount comes from the database.
   */
  cx: {
    /** The welcome: what we do and the hours; `privacy` is its last line, the words kept with the customer's consent. */
    welcome: (open: S | null, close: S | null) => S;
    privacy: S;
    orderButton: S; areaButton: S;
    orderAsk: S; areaAsk: S;
    /** On the card: what happens if an item is missing, and the note for cash. */
    missingLine: (pref: "best_match" | "ask" | "remove") => S;
    /** WEB2: an item whose own missing-item choice differs from the order's (chosen on the website's checkout). */
    missingItemLine: (name: S, pref: "best_match" | "ask" | "remove") => S;
    keepLine: S;
    /** The list under the confirmation: its button, sections and rows (WhatsApp: titles of at most 24 characters). */
    choicesButton: S; choicesMissing: S; choicesNote: S; choicesOrder: S;
    missingRow: Record<"best_match" | "ask" | "remove", S>;
    exactRow: S; noteRow: (note: number) => S; keepRow: S; cancelRow: S;
    /** The answers to a row. */
    missingSet: (pref: "best_match" | "ask" | "remove") => S;
    exactSet: S;
    noteSet: (note: number, change: number) => S;
    keepSet: (change: number) => S;
    needsNote: S; noteTooSmall: (total: number) => S; choiceTooLate: (code: S) => S;
    /** "Cancel my order" in words: what a cancel gives back, with a button that cancels. */
    cancelAsk: (code: S, credit: number) => S;
    cancelYes: S;
    /** Picking started: nothing is cancelled by the tap; a person decides, and the exact amount is said. */
    cancelAfterPick: (code: S, refundable: number, kept: S[]) => S;
    cancelAfterPickCash: (code: S) => S;
    cancelOnTheWay: (code: S) => S;
    /** The handover code, told with the confirmation of a prepaid order. */
    handoverCode: (code: S) => S;
    /** CFG1: every pickup order has a code; it is given to the hub, not to a rider. */
    handoverCodePickup: (code: S) => S;
    /** CFG1: the button under the lapsed-order notice (and the tap that opens it again). */
    reopenButton: S;
    /** Pickup at the hub: the card's line, "not available yet", and the "ready" notice. */
    pickupAt: (place: S) => S;
    pickupOff: S;
    pickupReady: (code: S, place: S) => S;
  };

  /** CX2: the question after delivery (feedback.ts), in the customer's language; its buttons and the two answers. */
  feedback: { ask: (code: S) => S; fineButton: S; problemButton: S; fine: S; problem: (code: S) => S };

  /** TEST1 (staging's friends' test, test_mode): the one line every card and status message of a test order carries, and the short
   *  answer to anyone not on the tester list (no price, no menu). */
  testMode: { line: S; notOpen: S };

  /** 1.21 (K1), in the customer's language since TEST1: the body of the WhatsApp catalogue's messages (the whole catalogue, one
   *  category's list, one product). */
  catalog: { all: S; list: (category: S) => S; one: S };

  /** Messages code starts outside a customer's turn. Each has a utility template (templates/templates.json) for after 24 hours.
   *  CX2: inside the 24-hour window the free message goes; the template only outside it. */
  notice: {
    /** `reopenable`: the card lapsed on its timer and the message carries the Reopen button (CFG1). */
    orderCancelled: (code: S, reason: S, reopenable?: boolean) => S;
    riderAtDoor: (code: S) => S;
    /** CFG1: one reminder, at settings.timers.confirm_reminder_min, for a card still waiting on the customer's tap. */
    confirmReminder: (code: S) => S;
    paymentReceived: (code: S, summary: S) => S;
    onTheWay: (code: S, cash?: number | null) => S;
    riderWaiting: (code: S) => S;
    delayed: (code: S) => S;
    calledOff: (code: S, credit: number) => S;
  };

  /** What changed at the shelf (2.2): the order is ready, with what was taken off or swapped, and the new total. */
  shelf: {
    ready: (code: S) => S;
    notFound: (items: S[]) => S;
    swapped: (missing: S, qty: S, by: S, price: number) => S;
    newTotal: (total: number, lbp: number | null) => S;
    credit: (amount: number) => S;
    /** One line for the template's {{2}}: the same facts, comma-separated, no amounts (the total is {{3}}). */
    summary: (removed: S[], swapped: { name: S; by: S }[]) => S;
  };

  /** The substitute question (2.2) and the answers to its two buttons. */
  sub: {
    question: (code: S, qty: S, missing: S, missingPrice: number, substitute: S, price: number, diff: number, minutes: number) => S;
    keep: S; remove: S;
    kept: (code: S, total: number) => S;
    removed: (code: S, total: number) => S;
    late: (code: S, total: number) => S;
  };

  /**
   * HO1 (docs/strategy/05 section D): a person is added to a chat; the bot is never removed from it. The six customer lines of a
   * case (opened, reminder, still on it, resumed, after hours, resolved), the answers to their buttons, the fixed lines for a
   * technical failure (never a hand-off), and the reply a person starts from in the Inbox (`draft`, edited before it is sent).
   */
  support: {
    opened: S; reminder: S; stillOnIt: S; resumed: S; afterHours: (opens: S) => S; resolved: S;
    callbackButton: S; keepOrderingButton: S; voiceNoteButton: S;
    callbackNoted: S; keepOrdering: S; voiceNoteAsk: S;
    /** The model stayed unavailable (or the turn failed) twice, a minute apart: buttons Browse and Talk to a person. */
    technical: S;
    /** The hourly cap on model turns: a fixed menu, no model call. */
    capMenu: S;
    /** The ask loop ended with nothing for the customer (agent_did_not_finish): one question with buttons. */
    stalled: S;
    browseButton: S; myOrderButton: S; personButton: S;
    /** A tap whose handler failed: the error line and a button that repeats the tap. */
    buttonError: S; retryButton: S;
    /** A food fact the records do not hold (invariant 15: unknown is never safe). Not a case. */
    notOnRecord: S;
    /** Browse tapped while the WhatsApp catalog cannot be shown. */
    browseInWords: S;
    draft: (kind: "person_requested" | "order_problem" | "complaint" | "refund" | "payment" | "safety" | "other", code: S | null) => S;
  };

  /** The ops line: pickers, riders and the ops lead. Staff read Arabic today (STAFF_LANG); en and fr are kept in step. */
  /**
   * PD1 (g): the honest answer when nothing fits (docs/PRODUCT_DATA_STANDARD.md, "Why the two voice notes failed"). Written by code:
   * what we do not carry yet (noted), what we cannot confirm yet, and at most three real items by their exact name, each priced by
   * quote_order. Never a catalogue button, never a fact: a phrase is quoted as part of a name ("with 'Zero Sugar' in their name").
   */
  honest: {
    /** The kinds the customer asked for that we do not carry, in their own words. */
    notCarried: (kinds: S[]) => S;
    /** CX2: what the customer said that the planner could not find (misheard, or not ours), in their own words: never dropped in silence. */
    notFound: (said: S[]) => S;
    /** A fact asked about a kind we carry, which no approved record confirms yet. */
    cannotConfirm: (fact: S, kinds: S[]) => S;
    /** What each fact is called in that sentence. */
    fact: Record<"sugar" | "protein" | "gluten" | "lactose" | "fat" | "salt" | "fragrance", S>;
    /** The heading of the items whose own name holds the phrase. */
    named: (phrases: S[]) => S;
    /** The last line: with items listed, or with none. */
    closeItems: S; closeNone: S;
    /** SR1: the heading of the items that pass the facts asked, each followed by its facts with their source (search.ts factLine). */
    fits: (kinds: S[]) => S;
    /** SR1: a kind whose items the approved facts show do not fit (none is unknown: each checked one fails). */
    noneFits: (kinds: S[]) => S;
    /** SR1: the last line after items that fit. */
    closeFits: S;
  };
  /**
   * 1.14, B1e: the offer to remember a restriction the customer stated, in their language. `onOrder`: a basket, a card or an order is in
   * hand, so the restriction is on it; otherwise it is noted for the order to come (QA1: «سجّلنا … على طلبك» about no order, in Arabic
   * to an English message).
   */
  remember: { offer: (restrictions: S[], onOrder: boolean) => S; yes: S; no: S; kept: S; notKept: S };
  /** SR1 (6): a basket built by code (0215), said before its card; the card is the customer's to confirm (invariant 4). */
  built: {
    dish: (dish: S, people: number) => S;
    lunchbox: (units: number) => S;
    budget: (maxUsd: number) => S;
    /** Kinds left out: not carried, not on sale now, or none that passes what the customer stated. */
    missing: (kinds: S[]) => S;
    overBudget: (maxUsd: number) => S;
    tooMany: (max: number) => S;
    none: S;
  };
  /** FD2: ordering food from a place (food.ts), and what the customer hears when staff call the place ahead (0250). */
  food: {
    secondOrder: (place: S) => S;
    menu: (place: S, more: boolean) => S;
    dishesButton: S;
    whichDish: (words: S, place: S) => S;
    notOnMenu: (words: S[], place: S) => S;
    choose: (dish: S, group: S, required: boolean) => S;
    chooseButton: S;
    noThanks: S;
    closed: (place: S, opens: S | null) => S;
    /** Ingredients or allergens we have no approved record of: we ask the place; never "safe" (invariant 15). */
    askPlace: (dish: S, place: S) => S;
    /** A time asked for a food order (replaces windows.restaurantNoWindow): it comes when ready, about this long. */
    arrives: (place: S | null, minutes: number | null) => S;
    accepted: (code: S, place: S, minutes: number) => S;
    itemMissing: (code: S, place: S, item: S) => S;
    keepRest: S; cancelOrder: S; acceptPrice: S;
    closedNow: (code: S, place: S) => S;
    priceLower: (code: S, place: S, item: S, total: number) => S;
    priceUp: (code: S, place: S, item: S, was: number, now: number, total: number) => S;
    dropped: (code: S, total: number) => S;
    priceAccepted: (code: S, total: number) => S;
    answerCancelled: (code: S) => S;
    notWaiting: (code: S) => S;
  };

  ops: {
    newPick: (code: S) => S;
    startButton: (code: S) => S;
    pickWait: (code: S, minutes: number) => S;
    noRider: (code: S) => S;
    noOrders: S; taken: S;
    busy: (code: S) => S;
    notPickable: (code: S, status: S) => S;
    noOpenPick: S;
    noSuchLine: (n: number) => S;
    removed: (name: S, total: number) => S;
    removedLine: (total: number) => S;
    ready: (code: S) => S;
    readyForRider: (code: S) => S;
    waiting: (code: S, names: S[]) => S;
    waitingOffer: (name: S, minutes: number) => S;
    waitingDecide: (name: S) => S;
    chooseSub: (name: S) => S;
    chooseSubButton: S;
    /** A substitute's list row: how its price compares with the missing line (one amount, so one line). */
    subRow: (diff: number) => S;
    removeRow: S;
    subAsked: (minutes: number) => S;
    subKept: (code: S, name: S) => S;
    subRemoved: (code: S, name: S) => S;
    subNotSent: S;
    empty: (code: S) => S;
    emptyOps: (code: S) => S;
    unknown: S;
    noReturns: S;
    returnsWaiting: (codes: S[]) => S;
    returnBack: (code: S) => S;
    countReturn: S;
    returnDone: (code: S, back: number, waste: number) => S;
    returnAlready: (code: S) => S;
    returnCard: (code: S, lines: { qty: number; name: S; restock: boolean }[]) => S;
    returnDefault: S; returnAllFit: S; returnAllWaste: S;
    opsOnly: S; noRiders: S;
    riderRow: (name: S, cash: number, busy: boolean) => S;
    riderCannot: S;
    riderConfirm: (name: S) => S;
    riderConfirmButton: S;
    riderOff: (name: S, requeued: number, stranded: S[], cashUsd: number, cashLbp: number) => S;
    sendBack: (code: S) => S;
    cashReceivedButton: S;
    riderAlreadyOff: (name: S) => S;
    riderOffToRider: S;
    calledOff: (code: S) => S;
    notCalledOff: (code: S, why: S) => S;
    cashIn: (u: number, l: number) => S;
    error: S;
    pickError: (err: S) => S;
    pickCard: (code: S, lines: { n: number; qty: number; name: S; note: S | null }[], missing: { qty: number; name: S; pending: boolean }[], notes: S | null) => S;
    pickAsk: (code: S) => S;
    pickDone: S; pickMissing: S;
    whichMissing: (code: S) => S;
    whichMissingButton: S;
    foundAll: (found: number, of: number) => S;
    queue: (rows: { code: S; items: number; village: S | null }[]) => S;
    someone: S; theRider: S; aRider: S; theTeam: S;
    // riders
    offer: (drops: number, pickups: S, minutes: number | null, stops: { village: S | null; code: S; paid: boolean; total: number; lbp: number | null }[], collect: number) => S;
    accept: S; decline: S;
    pickup: (codes: S[], stops: { done: boolean; source: S; village: S | null }[]) => S;
    picked: S;
    drop: (s: { code: S; customer: S; village: S; directions: S | null; phone: S | null; notes: S | null; paid: boolean; total: number; lbp: number | null; changeFor: number | null }) => S;
    arrived: S; delivered: S; noAnswer: S;
    cashAsk: (code: S, total: number, lbp: number | null) => S;
    exactButton: S;
    shiftStarted: S; shiftAlready: S; notOnShift: S; offerGone: S; accepted: S; declined: S; cashUnclear: S; noJob: S;
    dropAsk: S; shiftBlocked: S; softCap: S; hardCap: S; riderUnknown: S;
    shiftClosed: S;
    closeWithCash: (cash: number) => S;
    dropHub: S; dropOmt: S;
    dropDeclared: (u: number, l: number, omt: boolean) => S;
    dropAlert: (omt: boolean) => S;
    stillPicking: (codes: S[]) => S;
    collected: (cash: number) => S;
    waitMore: (minutes: number) => S;
    noAnswerLogged: (returnToHub: boolean) => S;
    noAnswerAlert: (ref: S) => S;
    mismatch: (total: number) => S;
    riderError: S;
    riderErrorAlert: (err: S) => S;
    proofAlert: (method: S, code: S, total: number, reused: boolean) => S;
    turnCap: (limit: number) => S;
    /** CX1: the handover code at the door (a prepaid order), and change the customer keeps as credit. */
    askCode: (code: S) => S;
    wrongCode: (left: number) => S;
    codeLocked: (code: S) => S;
    codeLockedAlert: (code: S) => S;
    codeOk: (code: S) => S;
    keepChange: (note: number) => S;
    /** FD2: a confirmed food order waits for staff to call the place (the console's Food page). */
    foodCall: (code: S, place: S) => S;
  };
}
