// Legal pages, English (DECISIONS §37.4). Written against what the product does today (cash on delivery, WhatsApp, voice notes,
// "delete my data", Law 81/2018). They are the pilot version: the lawyer reviews them before launch (owner issue #72).
export type LegalSlug = "terms" | "privacy" | "refund" | "cookies";
export type LegalDoc = {
  slug: LegalSlug;
  title: string;
  description: string;
  intro: string;
  sections: { h: string; p?: string[]; ul?: string[] }[];
};
export type LegalCopy = {
  updatedOn: string; // ISO date
  draftNote: string;
  entityHeading: string;
  entityText: string;
  docs: LegalDoc[];
};

export const legalEn: LegalCopy = {
  updatedOn: "2026-10-13",
  draftNote: "Pilot version. Alo King SARL is being formed; these pages will be updated, and re-dated, when the company is registered and our lawyer has reviewed them.",
  entityHeading: "Who we are",
  entityText: "Alo King SARL (in formation), Lebanon. You can reach us on WhatsApp or through the contact page.",
  docs: [
    {
      slug: "terms",
      title: "Terms of use",
      description: "The rules for ordering through Alo King on WhatsApp and on this website.",
      intro: "Alo King lets you order food and everyday essentials from shops in Lebanon by chatting on WhatsApp. By ordering through Alo King you accept these terms.",
      sections: [
        {
          h: "What Alo King is",
          p: [
            "Alo King is a way to order from independent shops. The shop prepares and sells your order. Alo King passes your order to the shop, shows you the total, and follows the order until it is delivered or collected.",
            "An assistant helps read what you write or say. It only proposes: the prices, fees and totals always come from our server and the shop's own menu, and an order is placed only when you tap Confirm.",
          ],
        },
        {
          h: "Prices, fees and currency",
          ul: [
            "The shop sets its menu prices. We never add to them.",
            "The delivery fee depends on the road distance from the shop and is shown before you confirm.",
            "Totals are shown in US dollars and in Lebanese pounds at the rate in force when you order. That rate is locked on your order.",
            "A final total can change only where the shop weighs items (for example meat by the kilo). If the change is large, we ask for your tap again.",
          ],
        },
        {
          h: "Paying",
          p: ["You pay cash on delivery, to the person who hands you your order, in the currency the shop accepts. A limit applies to cash orders, and we tell you if your order is over it. Online payment will be added later, with its own terms."],
        },
        {
          h: "Delivery code",
          p: ["For some orders (for example a first cash order, or a larger one) we give you a short code. Give it to the person handing over your order. It protects you and the shop."],
        },
        {
          h: "Cancelling",
          p: [
            "You can cancel before the shop accepts your order, and for a short time after. After that, we send your request to the shop, which can agree if it has not started preparing the order. Tap “My order” in the chat, then Cancel.",
          ],
        },
        {
          h: "Your part",
          ul: [
            "Give us a correct location and a phone that can be reached.",
            "Be reachable when the order arrives. Repeated missed deliveries can lead us to stop cash orders for your number.",
            "Do not misuse the service: no abuse, no false orders, no attempts to break it.",
          ],
        },
        {
          h: "Our responsibility",
          p: [
            "We work to make ordering reliable, but shops are responsible for the food and goods they sell, and for preparing them safely. Allergen and diet information is shown only when the shop has declared it; always check with the shop if you have an allergy.",
            "To the extent the law allows, Alo King is not liable for indirect losses. Nothing here limits rights you have under Lebanese law.",
          ],
        },
        {
          h: "Changes and law",
          p: ["We may update these terms and will change the date at the top. Lebanese law applies, and the courts of Beirut have jurisdiction, without removing any right a consumer has under mandatory law."],
        },
      ],
    },
    {
      slug: "privacy",
      title: "Privacy",
      description: "What data Alo King keeps, why, who processes it, and how to delete it. Voice notes and Law 81/2018.",
      intro: "We keep the minimum needed to take your order. This page explains what that is, in line with Lebanese Law 81/2018 on electronic transactions and personal data.",
      sections: [
        {
          h: "What we collect",
          ul: [
            "Your WhatsApp number and profile name, and the language you write in.",
            "Your messages to Alo King, and voice notes if you send them.",
            "Your delivery locations: the pin you share, an optional building, floor and note.",
            "Your orders: what you ordered, from which shop, the totals and the status.",
            "Your choices if you tell us them (for example a diet), and whether you agreed to marketing.",
          ],
        },
        {
          h: "Why we use it",
          ul: [
            "To take, price, deliver and follow your orders, and to answer you.",
            "To keep the service safe and to find and fix problems.",
            "To improve how well the assistant understands Lebanese Arabic, Arabizi, French and English.",
            "To send you offers only if you opted in. You can stop them at any time by sending STOP.",
          ],
        },
        {
          h: "Voice notes",
          p: [
            "We turn a voice note into text so the assistant can read your order, then show you the summary to confirm. Voice notes are processed by our speech and AI providers for that purpose.",
            "When you correct the assistant (“no, I said two”), we may keep the note, its text and your correction as an example to make the assistant more accurate. “Delete my data” removes them too.",
          ],
        },
        {
          h: "Who sees your data",
          ul: [
            "The shop and the person delivering your order see what they need to prepare and deliver it: your name, your items and your delivery location. Your phone number is shared only where delivery needs it.",
            "Our service providers process data for us: WhatsApp (Meta) and our WhatsApp provider, our database and hosting providers, AI and speech providers, a routing provider that computes road distance from coordinates, and an error-monitoring service that removes phone numbers and tokens from reports.",
            "We do not sell your data. We do not publish your locations.",
          ],
        },
        {
          h: "Where it is stored and for how long",
          p: [
            "Our database runs in the European Union. We keep order records as long as accounting and law require. Chat history and your saved details are kept while you use Alo King, and until you ask us to delete them.",
          ],
        },
        {
          h: "Your rights",
          ul: [
            "Send “delete my data” on WhatsApp. We ask you to confirm, then erase your history, addresses and details. Records we must keep for accounts remain, without your personal details where the law allows.",
            "Send “forget my history” to clear what the assistant remembers about your usual orders.",
            "Ask to see, correct or export your data through the contact page.",
            "Send STOP to end marketing messages immediately.",
          ],
        },
        {
          h: "Children",
          p: ["Alo King is for adults. If you believe a child has used it, tell us and we will delete the data."],
        },
        {
          h: "Contact",
          p: ["Questions or complaints about your data: use the contact page. Alo King SARL (in formation) is responsible for the data described here."],
        },
      ],
    },
    {
      slug: "refund",
      title: "Refund policy",
      description: "What happens when an order is cancelled, wrong, missing items or does not arrive.",
      intro: "Most orders are paid in cash on delivery, so most problems are fixed before money changes hands. This is what we do when something goes wrong.",
      sections: [
        {
          h: "Cash on delivery",
          ul: [
            "If the order is cancelled, rejected or not delivered, you pay nothing.",
            "If an item is missing or wrong when it arrives, do not pay for it. Tell the person delivering, then tell us on WhatsApp.",
          ],
        },
        {
          h: "When something is wrong with your order",
          ul: [
            "Tap “A person” in the chat, or message us, with your order code.",
            "Tell us what is wrong, and add a photo if you can.",
            "We contact the shop. If the shop agrees, the remedy is a correction, a replacement or a credit on the order.",
          ],
        },
        {
          h: "Orders that cannot be cancelled",
          p: ["Once the shop has started preparing your order, it may refuse a cancellation. Food that was prepared correctly as ordered is not refundable because of a change of mind."],
        },
        {
          h: "Online payments",
          p: ["When online payment is added, refunds will go back to the same method, and this page will say how long it takes."],
        },
        {
          h: "Our promise",
          p: ["We answer every message about a problem. Many cases are settled in the chat the same day."],
        },
      ],
    },
    {
      slug: "cookies",
      title: "Cookies",
      description: "How this website uses cookies and similar storage. We use almost none.",
      intro: "This website is built to need almost no cookies.",
      sections: [
        {
          h: "What we store",
          ul: [
            "Your language choice is in the web address (/ar, /en or /fr). We do not need a cookie for it.",
            "We do not use analytics cookies. If we add visit counting, it will be cookieless and carry no personal data.",
            "Error reports, if the site breaks, are scrubbed of phone numbers and tokens.",
          ],
        },
        {
          h: "Advertising",
          p: ["We do not use advertising or tracking cookies today. If we add an advertising tool one day, we will ask you first and update this page."],
        },
        {
          h: "Third parties",
          p: ["Opening WhatsApp from this site hands you over to WhatsApp, which has its own policies. Fonts and images are served from our own site."],
        },
        {
          h: "Your control",
          p: ["You can clear site data in your browser at any time. The site works without it."],
        },
      ],
    },
  ],
};
