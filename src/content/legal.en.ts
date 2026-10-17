// Legal pages, English (DECISIONS §37.4). Written against what the product does today (cash on delivery, WhatsApp, voice notes,
// "delete my data", Law 81/2018). They are the pilot version: the lawyer reviews them before launch (owner issue #72).
export type LegalSlug =
  "terms" | "privacy" | "refund" | "cookies" | "merchant-terms" | "collection-mandate";
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
  draftNote:
    "Pilot version. Alo King SARL is being formed; these pages will be updated, and re-dated, when the company is registered and our lawyer has reviewed them.",
  entityHeading: "Who we are",
  entityText:
    "Alo King SARL (in formation), Lebanon. You can reach us on WhatsApp or through the contact page.",
  docs: [
    {
      slug: "terms",
      title: "Terms of use",
      description: "The rules for ordering through Alo King on WhatsApp and on this website.",
      intro:
        "Alo King lets you order food and everyday essentials from shops in Lebanon by chatting on WhatsApp. By ordering through Alo King you accept these terms.",
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
          p: [
            "You pay cash on delivery, to the person who hands you your order, in the currency the shop accepts. A limit applies to cash orders, and we tell you if your order is over it. Online payment will be added later, with its own terms.",
          ],
        },
        {
          h: "Delivery code",
          p: [
            "For some orders (for example a first cash order, or a larger one) we give you a short code. Give it to the person handing over your order. It protects you and the shop.",
          ],
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
          p: [
            "We may update these terms and will change the date at the top. Lebanese law applies, and the courts of Beirut have jurisdiction, without removing any right a consumer has under mandatory law.",
          ],
        },
      ],
    },
    {
      slug: "privacy",
      title: "Privacy",
      description:
        "What data Alo King keeps, why, who processes it, and how to delete it. Voice notes and Law 81/2018.",
      intro:
        "We keep the minimum needed to take your order. This page explains what that is, in line with Lebanese Law 81/2018 on electronic transactions and personal data.",
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
            "To improve how well the assistant understands Lebanese Arabic (in Arabic or Latin letters), French and English.",
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
          p: [
            "Alo King is for adults. If you believe a child has used it, tell us and we will delete the data.",
          ],
        },
        {
          h: "Contact",
          p: [
            "Questions or complaints about your data: use the contact page. Alo King SARL (in formation) is responsible for the data described here.",
          ],
        },
        {
          h: "Merchants and drivers",
          p: [
            "If you claim or register a business on this website, we keep your name, your WhatsApp number, the business details you give and the papers you upload (a commercial registration, a permit, a company document, a photo of the shop sign). We use them only to check that the business is yours and to reply to you. A person at Alo King reads them. You can ask us to delete your claim and your papers at any time.",
            "If you apply to drive, we keep your name, number, area, vehicle, licence answer, languages and times, and your note. We use them only to contact you about the application. Say so on WhatsApp and we delete it.",
            "While you are in the middle of a claim, your browser keeps the claim number and the phone number you typed in its session storage, so a reload does not lose your place. It is erased when you close the tab.",
          ],
        },
      ],
    },
    {
      slug: "refund",
      title: "Refund policy",
      description:
        "What happens when an order is cancelled, wrong, missing items or does not arrive.",
      intro:
        "Most orders are paid in cash on delivery, so most problems are fixed before money changes hands. This is what we do when something goes wrong.",
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
          p: [
            "Once the shop has started preparing your order, it may refuse a cancellation. Food that was prepared correctly as ordered is not refundable because of a change of mind.",
          ],
        },
        {
          h: "Online payments",
          p: [
            "When online payment is added, refunds will go back to the same method, and this page will say how long it takes.",
          ],
        },
        {
          h: "Our promise",
          p: [
            "We answer every message about a problem. Many cases are settled in the chat the same day.",
          ],
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
          p: [
            "We do not use advertising or tracking cookies today. If we add an advertising tool one day, we will ask you first and update this page.",
          ],
        },
        {
          h: "Third parties",
          p: [
            "Opening WhatsApp from this site hands you over to WhatsApp, which has its own policies. Fonts and images are served from our own site. The map on the business registration page loads its tiles from OpenStreetMap, which then sees your IP address; it loads only when you ask for the map.",
          ],
        },
        {
          h: "Your control",
          p: ["You can clear site data in your browser at any time. The site works without it."],
        },
      ],
    },
    {
      slug: "merchant-terms",
      title: "Merchant terms",
      description:
        "The terms for shops that claim or register on Alo King and take orders through WhatsApp.",
      intro:
        "These terms are between your business and Alo King. They apply when you claim a shop, register a new one, or take orders through Alo King. They are the pilot version and our lawyer will review them before launch.",
      sections: [
        {
          h: "Who may join",
          ul: [
            "You must be the owner of the business, or authorised by the owner to act for it. Claiming a business that is not yours, or giving false documents, ends your access and can be reported.",
            "We check ownership by a code sent to the shop's own phone number, or by your registration or permit and a photo of the shop sign. A person at Alo King approves claims that need documents.",
            "Two people claiming the same shop, a sale of a business, a lost phone and a request to remove a listing each follow the steps we show you in the claim flow. Until they are settled, we can freeze the listing.",
          ],
        },
        {
          h: "Your page and your menu",
          ul: [
            "Your listing starts with public details such as name, address and location. Each is marked “please confirm” until you confirm or correct it. Nothing is shown to customers as yours until you claim it.",
            "You set your menu, prices, opening hours, delivery area and delivery fee within the bands we publish. We never change a price, an item's availability or your hours without your tap. The assistant only proposes; you confirm.",
            "Allergen and diet labels are only what you declare. Estimates of calories and nutrients are marked as estimates until you confirm them. You are responsible for what you declare.",
            "You may invite staff by phone number with a role: owner, manager, cashier, kitchen or driver. Only owners and managers change prices and menu.",
          ],
        },
        {
          h: "Orders",
          ul: [
            "Alo King sends each order to your shop through the channels you choose. You accept or reject it. When an order is not answered, we try your backup channel, then a call, then an operator, and after five minutes we cancel it and tell the customer.",
            "If orders are missed three times in a row, we pause your shop until you reactivate it. Your pause is yours: we do not lift a pause you set yourself.",
            "You prepare the order as accepted and keep the ready time you gave. You may reject an order for a reason such as an item running out. Repeatedly rejecting or missing orders can lead us to suspend your listing.",
            "Where items are sold by weight, the final price follows the real weight. A large increase waits for the customer's tap.",
          ],
        },
        {
          h: "Fees",
          ul: [
            "Alo King charges a fee for each order that is delivered or collected. The fee, and any free period, are shown on our For businesses page, and you see them before you go live.",
            "We add nothing to your menu prices and charge nothing monthly for your page.",
            "A change of fee applies only to orders placed after the change, and we tell you before it starts.",
            "Fees are recorded on your account. How they are settled, from Alo King Credit or by monthly statement, will be set out before online payment starts.",
          ],
        },
        {
          h: "Payments and cash",
          p: [
            "Today every order is paid in cash on delivery, to the person who hands over the order, in the currencies your shop accepts. The customer sees dollars and Lebanese pounds at the rate locked on the order.",
            "Online payment is not switched on. When it is, it follows the collection mandate, which you accept separately.",
          ],
        },
        {
          h: "Customers and their data",
          ul: [
            "Use a customer's name, number and address only to prepare and deliver their order and to deal with problems about it. Do not add them to your own lists, share them or message them for marketing.",
            "Marketing to customers goes only through Alo King, only to customers who agreed to it, and stops the moment they say STOP.",
            "Alo King protects personal data as Lebanese Law 81/2018 requires. A customer can ask us to delete their data.",
          ],
        },
        {
          h: "Ending",
          p: [
            "You can pause, close or ask to remove your listing at any time. Orders already accepted must still be honoured. We can suspend or remove a listing for false information, repeated missed orders, unsafe food or breaking these terms. Records that must be kept for accounts stay, without personal details where the law allows.",
          ],
        },
        {
          h: "Law",
          p: [
            "These terms are governed by Lebanese law. They will be updated, with a new date, when the company is registered and the lawyer has reviewed them.",
          ],
        },
      ],
    },
    {
      slug: "collection-mandate",
      title: "Collection mandate",
      description:
        "How Alo King will collect online payments on behalf of a shop, once online payment is switched on.",
      intro:
        "This mandate is for the day online payment is switched on. Until then every order is paid in cash on delivery, nothing is collected for you, and this page has no effect. We publish it now so you can read it before you join.",
      sections: [
        {
          h: "What you authorise",
          p: [
            "When a customer pays an order online (by card or by a payment service we offer), you authorise Alo King to receive that payment on your behalf, as your agent, for orders placed at your shop through Alo King and for those orders only.",
            "The customer's payment is recorded in our ledger as money owed to you, less our fee and any refund. The payment is not Alo King's income.",
          ],
        },
        {
          h: "What we do with the money",
          ul: [
            "Each payment, fee, refund and payout is a separate entry in an append-only ledger, in dollars and in Lebanese pounds at the rate locked on the order. Entries are never edited; a correction is a new entry.",
            "We pay you what the ledger shows you are owed, on the settlement schedule we will publish before online payment starts, with a statement for each period.",
            "Before online payment is switched on, we will tell you how the money received for you is held, in the way our lawyer and our bank confirm.",
          ],
        },
        {
          h: "Refunds and problems",
          ul: [
            "If an order is cancelled, rejected, or wrong because of the shop, the customer is refunded and the amount comes off what we owe you. If the problem is ours, it does not.",
            "If a customer disputes a payment, we tell you and show you what we hold. Until it is settled we may hold back the disputed amount.",
            "Where an order is paid online and an item is sold by weight, the customer is charged for the real weight, and any difference is refunded or collected with their tap.",
          ],
        },
        {
          h: "Limits and your rights",
          ul: [
            "We may set a limit on what we pay out at once while a shop is new, and we tell you the limit.",
            "You can ask to see every entry that concerns you, and to have any of them explained.",
            "You can withdraw this mandate at any time for new orders. Orders already paid are settled as above.",
          ],
        },
        {
          h: "Status of this page",
          p: [
            "The exact collection model depends on the rules of the Banque du Liban and on our lawyer's advice, which we are waiting for. This page will be completed and re-dated before online payment is switched on, and you will be asked to accept the final text.",
          ],
        },
      ],
    },
  ],
};
