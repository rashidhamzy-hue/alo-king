// M1: the shape every language file fills. A key missing in one language is a type error, so ar, en and fr always hold the same
// messages. Code builds every fixed message from these; the model writes none of them (SYSTEM_BRIEF "Message design").
//
// Writing rules (checked on every template, in every language, by packages/agents/test/messages.rules.test.ts):
//  1. One message, one job; no line longer than about three phone lines.
//  2. Only these emojis, as signposts: 📍 🛒 🛵 ✅ 💵 🌙 ⚠️ 📦 🏠 🔢 (and 👑 in the greeting only); at most three per message.
//  3. WhatsApp bold (*text*) only for a heading (the first line) and the total.
//  4. Each amount of money on its own line (a short label before it is allowed), Western digits, `$` for dollars.
// Amounts are formatted here (usd, lbp) and only from numbers code got from the database.

export type Lang = "ar" | "en" | "fr";
export type PayMethod = "cod" | "whish" | "omt";
type S = string;

/** Dollars as WhatsApp shows them everywhere: $7.27. Western digits, two decimals. */
export const usd = (n: number): string => `${Number(n) < 0 ? "-" : ""}$${Math.abs(Number(n)).toFixed(2)}`;
/** Lira grouped with commas, Western digits: 650,000. The unit word comes from the language file. */
export const grouped = (n: number): string => Math.round(Number(n)).toLocaleString("en-US");
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
    prepayFirst: (how: S, cap: number) => S;
    prepay: (how: S) => S;
    replaces: (code: S) => S;
    consent: S;
    confirm: S; edit: S; cancel: S;
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
    closedKept: (opens: S) => S;
    closedKeptPin: (opens: S) => S;
    keptButton: S;
    keptOpen: S;
    keptGone: S;
    /** A product's price under the Concierge's words (`reply` with `price_of`): the name, then the price on its own line. */
    priced: (name: S, price: number, available: boolean) => S;
  };

  windows: {
    choose: S; button: S; now: S; none: S; gone: S; noneAt: S; noneAtAll: S; nowUnavailable: S; orChoose: S;
    freshForWindow: (names: S[]) => S;
    pickupNoWindow: S; restaurantNoWindow: S;
    notChangeable: (code: S) => S;
  };

  answer: {
    noOpenOrder: S;
    awaitingConfirmation: (code: S, when: S | null) => S;
    awaitingPayment: (code: S, when: S | null, total: number) => S;
    confirmedFor: (code: S, when: S) => S;
    preparingFor: (code: S, when: S) => S;
    preparing: (code: S, eta: number | null) => S;
    ready: (code: S, pickup: boolean) => S;
    onTheWay: (code: S, eta: number | null) => S;
    arrived: (code: S) => S;
    delivered: (code: S) => S;
    failed: (code: S) => S;
    other: (code: S) => S;
    hours: (open: S, close: S, openNow: boolean) => S;
    outOfArea: (said: S, served: S[]) => S;
    inArea: (village: S, fee: number, eta: number) => S;
    noPrevious: S;
    allMissing: (names: S[]) => S;
    /** The greeting with the repeat button: the one place 👑 may appear. */
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
    minimum: (min: number, now: number, gap: number) => S;
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
    /** A cancel the database refused (the order is being prepared or is on its way): a person is told and will call. */
    cancelRefused: (code: S) => S;
  };

  payment: { proofReceived: (code: S) => S; proofResend: S };

  /** Messages code starts outside a customer's turn. Each has a utility template (templates/templates.json) for after 24 hours. */
  notice: {
    orderCancelled: (code: S, reason: S) => S;
    riderAtDoor: (code: S) => S;
    paymentReceived: (code: S, summary: S) => S;
    onTheWay: (code: S) => S;
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
  };
}
