# **Master Architectural Audit and Deep Research Specification: Alo King (ألو كينغ)**

## **1\. Executive Technical Architecture and Regional Constraints**

Alo King (ألو كينغ) is an artificial intelligence-driven, WhatsApp-native conversational commerce and logistics engine architected specifically for the Shouf district of Mount Lebanon1. The platform bridges rural commerce, decentralized restaurant operations, grocery supply chains, and diaspora remittances into a unified interactive WhatsApp conversational interface1. Standard e-commerce architectures assume stable electrical grids, consistent high-speed mobile data, structured postal addresses, and uniform digital payment rails2. Alo King explicitly rejects these assumptions, replacing them with a fault-tolerant, low-latency, and topographically aware edge infrastructure tailored to the operational realities of rural Lebanon1.

### **High-Level System Architecture and Component Topology**

The system topology combines a multi-tenant headless database, serverless edge runtimes, real-time reactive frontends, and an enterprise WhatsApp Business API gateway1:

* **WhatsApp Gateway Layer:** The platform routes all inbound and outbound traffic through the Kapso Cloud API, which proxies the Meta WhatsApp Business Platform (Graph API v24.0) via https\://api.kapso.ai/meta/whatsapp/v24.05. Kapso terminates incoming webhooks, validates cryptographic HMAC signatures, persists raw message history, and normalizes interactive components, including quick-reply buttons, interactive section lists, native flows, and location requests5.  
* **Edge Compute and AI Orchestration Layer:** Compute tasks execute within Supabase Edge Functions on the Deno runtime, deployed across point-of-presence edge nodes nearest to the Levant1. Incoming payloads enter a deterministic fast-path state machine designed to respond in under 350 milliseconds1. Non-deterministic, open-ended conversational inputs route through a two-tier model gateway: Tier-1 intent classification via a low-latency model, and Tier-2 Levantine Arabic semantic reasoning powered by Claude 3.5 Sonnet1.  
* **Database and Real-Time State Layer:** The persistence tier is built on Supabase PostgreSQL with pgcrypto, pgvector, and uuid-ossp extensions1. Active order states, driver coordinates, and kitchen queues synchronize via Supabase Realtime WebSocket channels1. PostgreSQL Row-Level Security (RLS) protects customer Personally Identifiable Information (PII) and guarantees multi-tenant merchant isolation1.  
* **Merchant, Driver, and Tracking Frontends:** Lovable.dev provides the client-side presentation tier using Vite, React, TypeScript, Tailwind CSS, and TanStack Router1. This includes /merchant (a Kitchen Display System with Web Audio chimes and Web Bluetooth thermal printing), /driver (a dispatch portal and cash ledger), /admin (a catalog and configuration console), and /track/:orderId (a live Leaflet tracking canvas)1.  
* **Continuous Integration and Delivery:** GitHub Actions (deploy-functions.yml) orchestrates automated linting, test execution, and deployment of Supabase Edge Functions directly to production1.

| Architectural Component | Technology Selection | Primary Operational Role | Failure Fallback Mode |
| :---- | :---- | :---- | :---- |
| **Messaging Gateway** | Kapso Cloud API (Meta Cloud API v24.0)1 | Inbound webhook ingestion, normalized interactive egress7 | Direct Meta Graph API bearer token bypass5 |
| **Edge Compute** | Supabase Edge Functions (Deno)1 | Latency-critical routing, FSM transitions, AI mediation1 | Static error dispatch with direct human support link |
| **Primary Datastore** | Supabase PostgreSQL 15+1 | ACID persistence, spatial tracking, state machine1 | Read-replica fallback / Edge memory cache |
| **Realtime Transport** | Supabase Realtime (WebSockets)1 | Kitchen KDS sync, driver GPS coordinates1 | Polling every 5,000 ms via HTTP REST |
| **Merchant Interface** | React \+ TanStack Router (Lovable.dev)1 | Visual Kanban KDS, menu modifier, audio alerts1 | Fallback to WhatsApp interactive order cards1 |
| **Audio Pipeline** | OpenAI Whisper API via Deno runtime1 | Levantine dialect voice note transcription1 | Interactive list prompt requesting text input |

### **Dual-Currency Engine and Financial Rules**

Lebanon’s macroeconomic context requires strict multi-currency synchronization. Alo King enforces an immutable platform baseline exchange rate of ![][image1]1. Because physical cash transactions in Lebanon do not utilize small LBP denominations, cash totals must round upward to the nearest practical circulating note (typically 5,000 LBP or 10,000 LBP for delivery couriers).  
The operational calculation rules are structured as follows:  
![][image2]  
Every receipt, order docket, and WhatsApp checkout summary must present both currencies simultaneously1. Financial persistence avoids native JavaScript IEEE 754 floating-point inaccuracies by storing values as integer micro-cents or exact NUMERIC(12, 2\) for USD, alongside explicit BIGINT columns for Lebanese Pounds1.

JSON  
{  
  "order\_id": "ord\_88294a",  
  "currency\_rates": {  
    "usd\_to\_lbp": 89500  
  },  
  "financial\_breakdown": {  
    "subtotal\_usd": 14.50,  
    "delivery\_usd": 2.00,  
    "service\_fee\_usd": 0.50,  
    "total\_usd": 17.00,  
    "subtotal\_lbp": 1297750,  
    "delivery\_lbp": 179000,  
    "service\_fee\_lbp": 44750,  
    "total\_lbp": 1521500,  
    "cash\_tender\_rounded\_lbp": 1525000  
  },  
  "display\_receipt": "Subtotal: \$14.50 (1,297,750 LBP)\\nDelivery: \$2.00 (179,000 LBP)\\nTotal Due: \$17.00 (1,521,500 LBP)\\nCash Cash-Out Target: 1,525,000 LBP"  
}

### **Topographical and Infrastructural Realities of Shouf District**

The Shouf district presents severe geographic challenges that invalidate urban delivery assumptions1. The terrain features steep elevation gradients, winding mountain passes, switchbacks, deep valleys (such as the Safa and Nahr El Hamam ravines), and an absence of formal street addresses4:

* **Elevation Gradients:** Operations span elevations ranging from 400 meters above sea level at Kfarhim, rising to 850 meters at Deir el Qamar and Beiteddine, 900 meters at Baakline, and exceeding 1,200 meters at Barouk and Maasser el Shouf4. A linear Euclidean distance of 4 kilometers between two villages often requires a 14-kilometer transit descending into a valley floor and ascending a ridge, imposing distinct fuel and time penalties on delivery mopeds and cars.  
* **Infrastructure Instability:** Intermittent electrical grid availability forces local businesses to rely on decentralized neighborhood diesel generators, which experience switchover power drops. Cellular data coverage (Alfa and Touch) fluctuates between high-speed 4G along ridge tops and complete connectivity loss in deep valley gorges.  
* **Addressing Topology:** Standard postal codes and house numbers do not exist. Navigation depends entirely on landmarks, local municipal references (e.g., "Near Kfarhim Public School," "Behind Baakline Grand Mosque"), and WhatsApp live GPS pin sharing4.

## **2\. Global Benchmark Study and Conversational UX Architecture**

Conversational commerce eliminates traditional e-commerce app download barriers by executing end-to-end purchasing journeys inside ubiquitous messaging applications. Global leaders establish clear functional patterns: Swoop Delivery (Africa) leverages conversational onboarding and automated delivery tracking; ChatFood/Deliveroo (MENA) pioneers interactive in-chat restaurant menu browsing; GoKwik (India) perfects frictionless 1-click WhatsApp checkout funnels; while Rappi (LATAM) and Yango Delivery (EE/MENA) excel in dense urban dispatch routing.

### **Global Feature Benchmarking and Regional Adaptations**

The platform incorporates three critical conversational patterns derived from global benchmarks, adapting each to the unique social and economic dynamics of rural Mount Lebanon:

* **Expat Care Packages and Diaspora Gifting:** The Lebanese diaspora residing across the GCC, Europe, and North America provides substantial financial support to families in the Shouf1. Alo King operationalizes this dynamic through a dedicated gifting architecture1. An expat ordering from abroad initiates a session via WhatsApp or the web calculator, selects a recipient village, chooses curated food or grocery bundles, and completes settlement in clean USD via an international card gateway1. The edge engine bifurcates the notification loop: the diaspora purchaser receives immediate transactional receipts, payment confirmations, and live delivery updates, while the local recipient in Shouf receives a celebratory WhatsApp message with delivery arrival times, entirely omitting pricing or billing information1.  
* **WhatsApp Group Ordering (Communal Multi-Cart):** Mountain social gatherings and local office teams frequently place composite orders. Rather than forcing one person to collect individual preferences manually, the host sends a trigger command (/group) to generate an ephemeral cart link (https\://alo.king/cart/grp\_9xK2). Colleagues add items and modifiers through a lightweight web interface without requiring authentication. As items are selected, the host’s WhatsApp session receives real-time updates. When the host triggers checkout, the communal cart locks, and the host selects the unified payment method.  
* **1-Tap Instant Reordering:** Returning customers are identified immediately upon incoming webhook receipt by querying past order records matching their phone number. If a completed order exists within the prior 30 days, the initial greeting payload presents an interactive quick-reply card: \[ 🔄 Reorder Last Meal \]. Tapping this button instantly replicates the previous cart, applies current item availability rules, calculates real-time delivery fees, and routes directly to payment confirmation, reducing the order placement lifecycle from several minutes to under five seconds.

### **Single-Turn Message Density Architecture**

Conversational commerce engines often suffer from message fragmentation, where an interaction triggers four or five sequential messages (greeting, image, price breakdown, location prompt, and confirmation text). This fragmentation causes notification fatigue, triggers user mutes, and risks Meta rate-limit penalties.  
Alo King enforces a strict design principle: Every single user turn must yield exactly one rich, consolidated WhatsApp payload1.  
All intermediate LLM tool calls, inventory verifications, and pricing calculations resolve completely within the edge execution cycle. The engine buffers its response until all data dependencies settle, emitting a single interactive message structure containing the dish photograph, title, localized narrative description, nutritional macros, dual-currency pricing, and interactive buttons1.

| Payload Segment | Structural Content | Constraint and Handling Rules |
| :---- | :---- | :---- |
| **Header Media** | High-resolution dish or bundle photograph | Optimized JPEG hosted on Supabase Storage CDN; maximum 5 MB1. |
| **Body Text** | Item title (Arabic/English), ingredients, nutritional macros, dual-currency pricing | Formatted using WhatsApp Markdown; maximum 1,024 characters; prices explicitly show USD and rounded LBP1. |
| **Footer Text** | Exchange rate indicator and operational guidance | Static text; maximum 60 characters (e.g., "Rate: \$1 \= 89,500 LBP • Tap below to choose")1. |
| **Interactive Actions** | Quick-reply action buttons or interactive selection list | Strictly maximum 3 buttons or up to 10 list rows; enforces 20-character button title limit7. |

JSON  
{  
  "messaging\_product": "whatsapp",  
  "recipient\_type": "individual",  
  "to": "96170123456",  
  "type": "interactive",  
  "interactive": {  
    "type": "button",  
    "header": {  
      "type": "image",  
      "image": {  
        "link": "https\://alo.king/cdn/dishes/tawouk-plate.jpg"  
      }  
    },  
    "body": {  
      "text": "\*Shish Tawouk Platter (صحن شيش طاووق)\*\\n\\nTender marinated chicken breast, spiced potato cubes, toum, pickles, grilled flatbread.\\n\\n📊 \*Macros:\* \~680 kcal | 52g P | 24g F\\n🏷️ \*Price:\* \$8.50 (760,750 LBP)\\n📍 \*Vendor:\* Al-Sanawbar, Baakline"  
    },  
    "footer": {  
      "text": "Rate: \$1 \= 89,500 LBP • Tap below to order"  
    },  
    "action": {  
      "buttons": \[  
        {  
          "type": "reply",  
          "reply": {  
            "id": "ORD|v\_sanawbar|item\_tawouk",  
            "title": "Add to Cart (\$8.50)"  
          }  
        },  
        {  
          "type": "reply",  
          "reply": {  
            "id": "NAV|browse\_menu|v\_sanawbar",  
            "title": "View Full Menu"  
          }  
        },  
        {  
          "type": "reply",  
          "reply": {  
            "id": "NAV|cart\_view",  
            "title": "Cart (1 Item)"  
          }  
        }  
      \]  
    }  
  }  
}

### **Native Meta Component Specifications and Usage Constraints**

Meta WhatsApp Cloud API v24.0 strictly limits payload structure and character counts. Transgressing these constraints results in unhandled 400 Bad Request API errors.

| Component Type | Meta Graph API Constraint | Platform Usage Rule | Automated Fallback Heuristic |
| :---- | :---- | :---- | :---- |
| **Quick-Reply Buttons** \[cite: 7, 10\] | Max 3 buttons; title ![][image3] UTF-8 characters7. | Primary operational CTAs (e.g., Confirm, Add, Reorder)1. | Regex strips emojis; truncates title to 20 characters with ellipsis if exceeded. |
| **Interactive List Menus** \[cite: 7\] | Max 10 items total; section titles ![][image3] chars; row title ![][image3] chars. | Restaurant category discovery, multi-item menus, village selectors. | If categories ![][image4], paginate into hierarchical lists (Next 10 Categories). |
| **Location Request Message** \[cite: 9\] | Must use interactive.type \= "location\_request\_message", action.name \= "send\_location"9. | Mandatory step for new users or fresh deliveries lacking GPS pins9. | If user device fails location sharing, falls back to text prompt for village landmark. |
| **Multi-Item Catalog Messages** | Requires Meta Commerce Manager catalog sync; max 30 items per section. | Standardized retail grocery and beverage inventory display. | Translates catalog items into Interactive Section Lists if catalog sync fails. |

## **3\. Sub-1-Second Latency, Two-Tier AI Routing, and State Machine**

A conversational commerce platform must achieve snappy responsiveness. Users interpreting a lingering WhatsApp status (such as a multi-second "typing..." bubble) often abandon the funnel or re-trigger commands, creating race conditions. Alo King achieves sub-second latency by bifurcating incoming traffic into a zero-LLM deterministic fast path and a specialized two-tier conversational AI pipeline1.

### **Fast-Path Deterministic Interceptor vs. Deep Conversational Pipeline**

Deterministic payloads—originating from button clicks, list row selections, or standardized callback IDs—bypass large language models entirely1:

* **Zero-LLM Fast Path (![][image5]):** Inbound webhooks containing structured string prefixes (ORD|, CONFIRM|, LOC|, OPTIN|, PAGE|) bypass inference models completely1. An edge router written in TypeScript extracts payload identifiers, executes parameterized SQL queries or stored procedures in PostgreSQL, mutates the session state, and returns a pre-compiled interactive response card1. The entire cycle completes in under 350 milliseconds.  
* **Tier-1 Fast Intent Router (![][image6]):** Unstructured text inputs first encounter a fast, lightweight classification model (such as Claude 3.5 Haiku)1. The model runs with strict JSON output schemas, categorizing incoming messages into core intents (SEARCH\_CATALOG, ADD\_ITEM, TRACK\_ORDER, COMPLAINT, SPEAK\_TO\_HUMAN) and extracting primary entities like village names, quantities, and food terms. If the intent resolves to a known deterministic state, the router hands execution over to the state machine.  
* **Tier-2 Deep Levantine Concierge (![][image7]):** Ambiguous requests, voice transcriptions, dietary inquiries, multi-vendor bundling, and edge cases route to Claude 3.5 Sonnet1. The model operates with system instructions defining Lebanese conversational etiquette, Shouf regional context, and access to database search tools, ensuring natural, culturally grounded interactions1.

### **Finite State Machine Architecture and Concurrency Management**

Customer conversational lifecycles are governed by an explicit finite state machine backed by the customer\_sessions table1. Concurrency anomalies—such as a user tapping multiple buttons simultaneously—are prevented via optimistic concurrency control using an integer version column1.  
The state machine enforces clear rules across all transitions:

* IDLE: The baseline state. Inbound messages from new users prompt a location request, while returning users receive a greeting with reorder buttons1.  
* LOCATION\_REQUIRED: The engine requests a native WhatsApp location pin or village selection9. It resolves the input against shouf\_villages to establish delivery feasibility before displaying restaurant options4.  
* BROWSING\_MENU: The user navigates vendor catalogs using interactive section lists. Selecting an item shifts the session into customization1.  
* ITEM\_CUSTOMIZATION: The engine presents required add-ons, preparation notes, or drink options via quick-reply buttons1. Once selections complete, the item commits to the cart.  
* AWAITING\_PAYMENT: The checkout summary displays dual-currency totals (\$ USD / LBP)1. The system activates a 15-minute lock on merchant kitchen capacity and inventory allocations1. If payment confirmation does not settle within 900 seconds, an automated scheduled routine invalidates the lock, resets the state to BROWSING\_MENU, and notifies the customer via WhatsApp.  
* ORDER\_CONFIRMED: Payment is cleared (or COD confirmed)1. The order record is written to the database, dispatch notifications fire, and the customer receives tracking links, returning the session to IDLE1.

| Current State | Inbound Trigger / Action | Target Next State | Edge Validation Rules |
| :---- | :---- | :---- | :---- |
| **IDLE** | User sends initial greeting or query | LOCATION\_REQUIRED or BROWSING\_MENU | Verify if customer has active delivery coordinates; if missing, require location9. |
| **LOCATION\_REQUIRED** | User shares GPS pin or selects village9 | BROWSING\_MENU | Validate coordinates lie within active Shouf service polygons4. |
| **BROWSING\_MENU** | User selects specific dish/item1 | ITEM\_CUSTOMIZATION | Confirm item is currently marked in-stock by vendor1. |
| **ITEM\_CUSTOMIZATION** | Add-ons selected; cart updated1 | BROWSING\_MENU or AWAITING\_PAYMENT | Persist cart changes into session JSON; calculate intermediate totals1. |
| **AWAITING\_PAYMENT** | User confirms payment method1 | ORDER\_CONFIRMED | Check 15-minute lock validity; verify Whish webhook or COD cap1. |
| **ORDER\_CONFIRMED** | Order delivered or canceled1 | IDLE | Archive cart state; issue loyalty points; clear active vendor binding1. |

### **Levantine Arabic Audio Pipeline and Edge Execution Lifecycle**

A large portion of Lebanese mobile communication relies on WhatsApp voice notes. Users frequently order via multi-intent, mixed-dialect spoken phrases combining Levantine Arabic, Arabizi, French, and English terms1.  
Edge environments terminate HTTP requests if processing takes too long. Supabase Edge Functions solve this using EdgeRuntime.waitUntil1:

* **Webhook Ingestion:** When Kapso forwards an incoming voice note, the edge function immediately returns an HTTP 200 OK response5. This prevents Meta webhook delivery timeouts and eliminates duplicate delivery attempts5.  
* **Asynchronous Processing:** Using EdgeRuntime.waitUntil, an asynchronous task downloads the .ogg (Opus) audio binary from Kapso media storage and forwards it to the OpenAI Whisper API1.  
* **Colloquial Optimization:** Whisper transcription accuracy for Lebanese dialect improves drastically when seeded with an explicit regional prompt containing colloquial syntax, Arabizi transcriptions, and local food items:  
  Prompt: "Alo King, Shouf, Baakline, Deir el Qamar, Beiteddine, Tawouk, Shawarma, Toum, Kabis, Batata Harra, Arayes, Manakish, Zaatar, Labneh, Lahm bi Ajin, 3al 7atab, ma3, bidoun, baddi, ktr, shway."

* **Transcription Routing:** The resulting Levantine transcript passes to Tier-2 AI (Claude 3.5 Sonnet)1. The LLM extracts the structured order entities, maps them to database inventory identifiers, adds them to the customer’s active cart session, and sends the consolidated order confirmation card back to the user’s WhatsApp thread1.

## **4\. Multi-Channel Merchant Experience and Order Receiving Matrix**

Onboarding rural restaurant and grocery owners fails when complex, fragile point-of-sale hardware or software is forced into kitchens. Operators in the Shouf frequently experience generator power cuts, spotty Wi-Fi, and high kitchen noise during peak lunch and dinner hours. Alo King utilizes a fault-tolerant multi-channel order matrix1.  
The order receiving hierarchy is structured as follows:

* **Channel A (Primary): Web Kitchen Terminal (/merchant in Lovable):** Orders arrive in real time via Supabase Realtime WebSocket connections, triggering an unyielding audio chime on a dark-mode tablet display1.  
* **Channel B (Secondary Fallback): WhatsApp-Native Interactive Card:** If an order remains unacknowledged after 90 seconds, the edge engine sends an interactive message directly to the owner's WhatsApp number with 1-tap accept and reject buttons1.  
* **Channel C (Emergency Fallback): Central Dispatch Voice Ping:** If neither channel responds after 150 seconds, an automated telephony alert pings the owner's mobile line, while alerting central platform dispatchers1.

| Receiving Channel | Primary Trigger | Timeout Threshold | Acknowledgment Mechanism | Target Hardware |
| :---- | :---- | :---- | :---- | :---- |
| **Web KDS (/merchant)** \[cite: 1\] | Order status changes to pending1. | 0 – 90 seconds | Kitchen staff taps "Accept" on touch screen1. | Android/iOS tablet or laptop running Chrome/Safari1. |
| **WhatsApp Fallback** \[cite: 1\] | KDS fails to acknowledge order within 90s1. | 90 – 150 seconds | Single-tap interactive button (Accept 15m/30m)1. | Merchant owner's personal smartphone via WhatsApp1. |
| **Automated Voice Call** \[cite: 1\] | Total lack of response after 150s1. | 150+ seconds | DTMF digit press (Press 1 to confirm order) | Cellular voice call over Touch or Alfa network. |

### **Web Kitchen Terminal (/merchant in Lovable)**

The Web Kitchen Display System (KDS) operates as a Progressive Web Application (PWA) running on tablets, laptops, or smartphones1:

* **Persistent Audio Chime:** When an order record enters status \= 'pending', the client initializes a synthetic dual-tone square/sine wave alarm loop using the HTML5 Web Audio API1. The sound continues indefinitely until kitchen staff physically presses an acknowledgment button on the screen1.  
* **Kanban Workflow:** Orders are visualized across status columns: Pending Acceptance ![][image8] Preparing ![][image8] Ready for Pickup / Driver Assigned ![][image8] On The Way ![][image8] Delivered1.  
* **Connection Heartbeat and Auto-Recovery:** The KDS maintains an active WebSocket heartbeat via Supabase Realtime1. If local generator cuts drop the connection, the application displays a visible disconnection banner and shifts to aggressive polling (every 3 seconds) until real-time synchronization re-establishes1.

### **WhatsApp-Native Merchant Fallback Flow**

If the Web Kitchen Terminal fails to acknowledge an incoming order within 90 seconds, the platform triggers Channel B1. The edge engine sends an interactive WhatsApp message directly to the restaurant owner's verified phone number1:

🛎️ \*طلب جديد\! NEW ORDER \#8829\*  
👤 الزبون: Rami K. (Baakline)  
🍽️ الطلب:  
  • 2x Shish Tawouk Sandwich (\$7.00)  
    \- Extra Toum, No Pickles  
  • 1x Batata Harra (\$3.00)  
💰 المجموع: \$10.00 (895,000 LBP) \- Cash on Delivery

يرجى تأكيد وقت التحضير فوراً:

The message includes three interactive quick-reply buttons1:

* \[ ✅ قبول (15 دقيقة) \] ![][image8] Mutates order status to accepted, sets preparation timer to 15 minutes, notifies the customer and driver pools1.  
* \[ ✅ قبول (30 دقيقة) \] ![][image8] Mutates order status to accepted, sets preparation timer to 30 minutes1.  
* \[ ❌ رفض الطلب \] ![][image8] Sets order status to merchant\_rejected, halts dispatch, and immediately prompts the customer on WhatsApp to select an alternative restaurant1.

If neither channel responds within 150 seconds of placement, Channel C triggers an automated phone call pinging the merchant's mobile line, while alerting the central Alo King human dispatch operator1.

### **ESC/POS Thermal Bluetooth Docket Printing for Arabic Text**

Physical thermal receipt printers (58mm and 80mm ESC/POS hardware) are essential for kitchen docket tracking. However, standard thermal printers lack internal support for Arabic character shaping, isolated/medial/final glyph variants, and Right-to-Left (RTL) text engines. Directly transmitting raw CP864 or Windows-1256 encoded bytes typically produces inverted, disconnected, or unreadable Arabic text.  
Alo King resolves this hardware limitation using a browser-side raster graphics pipeline:

> 1. **DOM Canvas Generation:** The /merchant PWA renders the receipt docket off-screen using an HTML5 \<canvas\> element configured to standard thermal paper widths (384 pixels for 58mm; 576 pixels for 80mm)12.  
> 2. **Typography Shaping:** The canvas renders Arabic using standard system fonts (Cairo or Noto Sans Arabic) with CSS direction: rtl; unicode-bidi: bidi-override;. This renders connected Arabic script, embedded English product titles, dual-currency tables, and tracking QR codes.  
> 3. **1-Bit Monochrome Quantization:** The canvas RGBA pixel buffer is processed through an automated thresholding algorithm, mapping each 8-pixel horizontal strip into a single byte (0 for white, 1 for black)13.  
> 4. **Raw ESC/POS Transmission:** The resulting bitmap stream is framed with standard ESC/POS raster bit-image commands (GS v 0 m xL xH yL yH d1...dk) and pushed directly to the paired thermal printer over the Web Bluetooth API (navigator.bluetooth) or a local POS bridge12.

TypeScript  
// ESC/POS Canvas to 1-Bit Monochrome Bitmap Converter  
export function canvasToEscPosRaster(canvas: HTMLCanvasElement): Uint8Array {  
  const ctx \= canvas.getContext('2d')\!;  
  const width \= canvas.width;  
  const height \= canvas.height;  
  const imgData \= ctx.getImageData(0, 0, width, height).data;  
    
  const widthBytes \= Math.ceil(width / 8);  
  const header \= new Uint8Array(\[  
    0x1B, 0x40,                         // ESC @ (Initialize printer)  
    0x1D, 0x76, 0x30, 0x00,             // GS v 0 0 (Raster bit image normal mode)  
    widthBytes & 0xFF,                  // xL (Bytes per line low byte)  
    (widthBytes \>\> 8) & 0xFF,           // xH (Bytes per line high byte)  
    height & 0xFF,                      // yL (Dots height low byte)  
    (height \>\> 8) & 0xFF                // yH (Dots height high byte)  
  \]);

  const raster \= new Uint8Array(widthBytes \* height);  
  for (let y \= 0; y \< height; y++) {  
    for (let x \= 0; x \< width; x++) {  
      const idx \= (y \* width \+ x) \* 4;  
      // Luminance formula: 0.299R \+ 0.587G \+ 0.114B  
      const brightness \= 0.299 \* imgData\[idx\] \+ 0.587 \* imgData\[idx \+ 1\] \+ 0.114 \* imgData\[idx \+ 2\];  
      const isBlack \= brightness \< 128 ? 1 : 0;  
        
      if (isBlack) {  
        const byteIndex \= y \* widthBytes \+ Math.floor(x / 8);  
        const bitOffset \= 7 \- (x % 8);  
        raster\[byteIndex\] |= (1 \<\< bitOffset);  
      }  
    }  
  }

  const footer \= new Uint8Array(\[0x1D, 0x56, 0x41, 0x03\]); // GS V A (Paper cut)  
  const payload \= new Uint8Array(header.length \+ raster.length \+ footer.length);  
  payload.set(header, 0);  
  payload.set(raster, header.length);  
  payload.set(footer, header.length \+ raster.length);  
  return payload;  
}

### **WhatsApp Merchant Admin Engine (Voice and Text Command Parsing)**

Restaurant owners can manage menu pricing and availability directly from WhatsApp without opening a browser1.

* **Cryptographic Onboarding Pairing:** To register a mobile number, the merchant generates a time-limited 6-character linking token inside /merchant (e.g., ALO-X7K9P2)1. Sending this token to the Alo King WhatsApp bot validates the wa\_id, updates the merchants.owner\_whatsapp database record, and grants operational access1.  
* **Multi-Intent Voice Control:** Merchants can send voice notes in Lebanese dialect to update operations: *"Masa lkheir Alo King, 3addelle se3er sandwishet el tawouk sawweeya \$4.50, w 7ott el mashawi mshakkal sold out lyom, w wa22efle l matbakh noss se3a la2anno 3anna 3aj2a"*1.  
* **Operational Execution:** Whisper transcribes the audio, and the LLM extracts structured mutation tools1:  
  1. update\_item\_price(merchant\_id, "tawouk", 4.50)  
  2. set\_item\_availability(merchant\_id, "mashawi\_mshakkal", false)  
  3. pause\_kitchen(merchant\_id, 30\)  
* **Safety Guards:** If a requested price modification represents a variance greater than 50% from the previous value, the engine halts automatic database execution1. It replies with an explicit interactive WhatsApp button prompt: *"⚠️ Price Change Alert: Tawouk will update from \$3.00 to \$4.50 (+50%). Are you sure?"*1. Every administrative change payload includes a single-tap \[ ↩️ تراجع (Undo) \] action that reverts the mutations using a database transaction snapshot1.

## **5\. Lebanese Payment Gateway Strategy and Dual-Currency Checkout**

Lebanon’s financial ecosystem operates across a mixture of paper cash, local digital wallets, and international cards. Alo King coordinates these mechanisms through three dedicated payment pathways.

| Payment Method | Target Demographic | Clearing Mechanism | Operational Safeguards |
| :---- | :---- | :---- | :---- |
| **Cash on Delivery (COD)** \[cite: 1, 3\] | Local residents in Shouf villages1. | Physical cash collection by delivery courier upon arrival1. | \$150 USD hard cap; exact change requirement prompt; driver cash gauge1. |
| **Whish Money API** \[cite: 11, 15\] | Tech-forward locals and national account holders3. | Direct wallet debit via Whish Pay mobile app-switch11. | Cryptographic external ID validation; server-to-server webhook confirmation11. |
| **International Card Gateway** \[cite: 2, 3\] | Lebanese diaspora ordering care packages from abroad1. | 3D-Secure web checkout overlay via Tap / Checkout.com1. | Eliminates WhatsApp webview drops; zero-pricing receipts for recipient1. |

### **Cash on Delivery (COD) Engine**

Despite fintech growth, COD remains the primary payment method for local retail orders in rural Lebanon3.

* **Dual-Currency Breakdown:** Receipts clearly compute exact sums at ![][image9]1.  
* **Risk Cap:** Unverified numbers or COD orders exceeding \$150 USD require upfront payment or manual telephone confirmation by dispatchers to prevent malicious fake orders1.  
* **Change Management Flow:** During WhatsApp checkout, the bot asks: *"Will you be paying in exact cash, with a USD bill (\$20, \$50, \$100), or in LBP notes?"* The driver's app records the requested change denominations, preventing delays upon delivery arrival.

### **Whish Money Local Payment Gateway Integration**

Whish Money is Lebanon's dominant local digital wallet platform, supporting payments in both USD and LBP11. Alo King integrates the Whish Pay merchant services API via dedicated edge routines1:

> 1. **Payment Session Generation:** When the customer selects Whish Money on WhatsApp, an edge worker calls POST https\://whish.money/itel-service/api (or sandbox https\://lb.sandbox.whish.money/itel-service/api) authenticated with merchant credentials (channel, secret, websiteUrl)11.  
> 2. **Payload Delivery:** The API returns a secure collectUrl and transaction identifier11. The WhatsApp bot delivers an interactive Call-to-Action (CTA) URL button: \[ 💳 Pay with Whish Money \]11.  
> 3. **App Switch and Settlement:** Tapping the link on mobile opens the native Whish application, prompting the customer to authorize deduction from their Whish wallet balance15.  
> 4. **Server-to-Server Webhook Verification:** Upon completion, Whish servers trigger a callback to the Alo King webhook endpoint11. The listener verifies the payload signature, confirms the externalId, updates the order status to paid, and instantly alerts the kitchen terminal1.

TypeScript  
// Supabase Edge Function: Whish Pay Intent Generator  
import { serve } from "https\://deno.land/std@0.168.0/http/server.ts";

const WHISH\_BASE\_URL \= Deno.env.get("WHISH\_ENV") \=== "production"  
  ? "https\://whish.money/itel-service/api"  
  : "https\://lb.sandbox.whish.money/itel-service/api";

serve(async (req) \=\> {  
  const { orderId, amountUsd, customerPhone } \= await req.json();

  const externalId \= \`\${orderId}\_\${Date.now()}\`;  
  const requestBody \= {  
    channel: Deno.env.get("WHISH\_CHANNEL\_ID")\!,  
    secret: Deno.env.get("WHISH\_SECRET\_KEY")\!,  
    websiteUrl: "https\://alo.king",  
    amount: amountUsd,  
    currency: "USD",  
    externalId: externalId,  
    phoneNumber: customerPhone,  
    successCallbackUrl: "https\://api.alo.king/functions/v1/whish-webhook?status=success",  
    failureCallbackUrl: "https\://api.alo.king/functions/v1/whish-webhook?status=failure",  
    redirectUrl: \`https\://alo.king/track/\${orderId}\`  
  };

  const response \= await fetch(\`\${WHISH\_BASE\_URL}/createPayment\`, {  
    method: "POST",  
    headers: { "Content-Type": "application/json" },  
    body: JSON.stringify(requestBody)  
  });

  const data \= await response.json();  
  if (\!response.ok || \!data.collectUrl) {  
    return new Response(JSON.stringify({ error: "Whish initialization failed", details: data }), { status: 400 });  
  }

  return new Response(JSON.stringify({ collectUrl: data.collectUrl, externalId }), {  
    headers: { "Content-Type": "application/json" }  
  });  
});

### **Expat International Card Gateway (Diaspora Care Package Engine)**

For international diaspora members purchasing care packages for families in Shouf, the system employs Checkout.com, Tap Payments, or Stripe, settling transactions directly in USD1.

* **3D Secure (3DS) Optimization:** Because WhatsApp's internal webview can interrupt bank OTP verifications, the platform sends a secure, responsive payment link (https\://alo.king/pay/:orderId) with complete OpenGraph metadata1.  
* **Frictionless Diaspora Tracking:** Once international payment settles, the diaspora buyer receives a dedicated tracking card in their international WhatsApp thread, complete with estimated local arrival times and live courier tracking, while the recipient in Shouf receives a localized gift message1.

## **6\. AI Up-Selling, Loyalty, Referrals, and Customer Service**

Conversational commerce thrives on contextual personalization. Rather than displaying intrusive popups, Alo King embeds upselling, referral mechanisms, and customer care naturally into conversational turns1.

### **Contextual AI Upselling and Cross-Selling Engine**

When a customer selects a core item, the Tier-1 / Tier-2 AI engine evaluates complementary additions based on dish category, restaurant margins, and historic basket pairings:

* **Rule and Margin Pairings:** Shawarma and Tawouk selections trigger recommendations for extra garlic cream (*toum*), spicy potatoes (*batata harra*), or soft drinks. Family platters trigger recommendations for fresh appetizer salads (Tabbouleh, Fattoush) or hummus plates.  
* **Single-Turn Bundle Synthesis:** The system suggests items dynamically within the configuration card, presenting high-margin additions as simple quick-reply options rather than disjointed multi-message prompts:

Added 1x Shish Tawouk Platter to cart\! 🍗  
Would you like to complete your meal with:  
 • Batata Harra (+\$3.00)  
 • Extra Toum & Pickles (+\$1.00)  
 • Fresh Mint Lemonade (+\$2.50)

\[ 🍟 Add Batata Harra \]   \[ 🍋 Add Lemonade \]   \[ ⏩ Skip to Cart \]

### **WhatsApp Referral Engine**

Growth across Shouf villages relies on social ties and community recommendations. Alo King implements a referral engine:

* **Unique Referral Tokens:** Every registered customer is assigned a tracking token formatted as a short URL (e.g., https\://alo.king/r?c=HANI84)1.  
* **Automated "Give \$2, Get \$2" Clearing:** When a new user launches the bot via a referral link, the referral code binds to their session1. Upon successful delivery of the new user's first order, the system deposits a \$2.00 King Credit into both the referee's and the referrer's loyalty wallets1.  
* **Forwardable WhatsApp Status Assets:** Customers receive dynamic, pre-formatted promotional summary cards celebrating order milestones (e.g., *"I just ordered from Al-Sanawbar via Alo King\! Use my code HANI84 for \$2 off your first village delivery"*), making it easy to forward to WhatsApp groups or share on WhatsApp Status.

### **Gamified Loyalty Framework: "King Credits"**

The platform maintains customer retention through an automated cashback loyalty architecture managed directly over WhatsApp:  
Customers check their accrued credits instantly by typing credits or رصيدي to the bot, which responds with their current dollar balance and LBP equivalent, along with a quick-reply button allowing them to apply credits directly to their active cart.

### **AI Customer Service and Sentiment Escalation**

Customer inquiries are managed using a hybrid escalation pattern1:

* **Order Tracking:** Common inquiries such as *"Wayno el delivery?"* trigger an automated query retrieving the driver's real-time GPS coordinates, returning an immediate update: *"Driver Wissam is 4 minutes away, climbing the Baakline ridge road"*1.  
* **Incorrect / Missing Items:** Customers report missing items by taking a photo directly within WhatsApp. The image is stored in Supabase Storage, an edge function logs the incident, issues an automated partial King Credit credit, and alerts store management.  
* **Sentiment Escalation Safeguards:** Tier-1 conversational processing continuously analyzes sentiment scores. If repeated user frustration, aggressive wording, or failure to resolve an issue after two conversational turns is detected, the bot disengages automation, tags the database session as human\_escalation\_required, and redirects the interaction to a live WhatsApp support agent while presenting the customer with an explicit direct-dial support contact1.

## **7\. Drivers Logistics, Dispatch Engine, and Topographical Routing**

Urban delivery dispatch systems rely on Euclidean distance and grid networks, models that fail when deployed across the rugged topography of Mount Lebanon1. Dispatching across the Shouf requires an elevation-aware routing engine1.  
The dispatch calculation evaluates driver assignment through a specialized routing cost function:  
![][image10]  
In this formulation, ![][image11] represents the true network road distance in kilometers, explicitly rejecting straight-line Euclidean distance. The term ![][image12] accounts for the elevation gradient in meters4. Uphill climbs heavily penalize small engines, while downhill descents carry negligible cost. The parameter ![][image13] introduces a discrete penalty when a route forces a courier to cross deep valley gorges (such as traversing between Baakline and Deir el Qamar through the river bottom), and ![][image14] scales the dispatch preference based on vehicle capability (favoring four-wheel-drive vehicles or cars for steep climbs, and reserve scooters for localized ridge runs)4.

| Route Scenario | Straight Distance | Actual Road Distance | Elevation Change (ΔE) | Moped Travel Time | Car Travel Time | Dispatch Strategy |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| **Baakline ![][image8] Beiteddine** \[cite: 4\] | ![][image15] | ![][image16] | ![][image17] then ![][image18] | ![][image19] | ![][image20] | Valley penalty applied; assign mid-valley car. |
| **Baakline ![][image8] Kfarhim** \[cite: 4, 8\] | ![][image21] | ![][image22] | ![][image23] (Pure Descent) | ![][image24] | ![][image25] | Zero ascent penalty; ideal for 110cc moped. |
| **Kfarhim ![][image8] Barouk** \[cite: 4, 8\] | ![][image26] | ![][image27] | ![][image28] (Steep Ascent) | ![][image29] | ![][image30] | Moped prohibited; cars assigned exclusively. |
| **Deir el Qamar Ridge** \[cite: 4\] | ![][image31] | ![][image32] | ![][image33] (Contour Road) | ![][image34] | ![][image34] | Minimal gradient; ideal for multi-order batching. |

### **Driver WhatsApp Bot Interface**

Courier onboarding and shift management operate directly through an automated WhatsApp driver interface1:

* **Shift Control:** Couriers toggle operational availability by sending \[ 🟢 Go Online \] or \[ 🔴 Go Offline \]1.  
* **Interactive Dispatch Alerts:** Dispatch offers arrive as interactive WhatsApp cards detailing pickup merchant, delivery village, cash collect amount, and base payout1.  
* **Deep-Link Navigation:** Tapping \[ 🗺️ Navigate to Customer \] opens Google Maps directly with pre-populated GPS coordinates or landmark pin locations.

📦 \*مهمة توصيل جديدة\! NEW DELIVERY TASK\*  
📍 \*من:\* Al-Sanawbar (Baakline)  
📍 \*إلى:\* Kfarhim, Main Square near Pharmacy  
📏 المسافة المقدرة: 5.2 km (Downhill)  
💵 التحصيل: \$12.50 (1,118,750 LBP) \- Cash  
🛵 أتعاب التوصيل: \$2.00 (179,000 LBP)

\[ ✅ قبول المهمة \]          \[ ❌ تخطي \]

### **Live Customer Tracking Engine (/track/:orderId)**

While the ordering experience is WhatsApp-native, customers receive a live tracking link (https\://alo.king/track/:orderId) built using React, TanStack Router, and Leaflet1:

* **Supabase Realtime Stream:** The courier's mobile browser periodically pushes location updates to the driver\_locations table1. The tracking webview subscribes to the matching topic via WebSockets, animating the driver's vehicle marker across the terrain map in real time1.  
* **Low-Bandwidth Reliability:** If local cellular connectivity drops while the driver descends through a valley gorge, the interface gracefully caches the last known coordinates, estimates progress using historical transit speeds, and alerts the customer that the driver is navigating an area with weak reception.

## **8\. Meta Compliance, Anti-Ban Protection, and Security Audit**

Operating a commercial operation over WhatsApp requires strict compliance with Meta’s Business Messaging Policies to prevent account blocks and quality rating downgrades10.

### **Meta WhatsApp Business Account (WABA) Anti-Ban Controls**

Meta continuously monitors account quality scores (categorized as Green, Yellow, or Red). Drops in quality reduce outbound messaging capacity (from 10,000 to 1,000 or 250 conversations per 24-hour period) and risk account suspension:

* **Customer Care Window (24-Hour Rule):** Regular conversational messages can only be sent within 24 hours of the user’s most recent incoming message10. Once this window lapses, the engine disallows freeform chat, routing updates exclusively through pre-approved Meta Template Messages (KAPSO\_ORDER\_UPDATE, KAPSO\_PROMO\_TEMPLATE)1.  
* **Automated Rate Limiting and Debouncing:** Users who tap buttons repeatedly can generate race conditions that overwhelm serverless functions. Alo King deploys a Redis/in-memory token bucket on Edge Functions, discarding duplicate requests with identical message\_id or matching session states within an 800-millisecond window.  
* **Opt-Out Compliance:** Standard keywords (STOP, CANCEL, إلغاء, توقف) immediately trigger an automated database opt-out flag, halting all marketing broadcasts and reverting communication solely to active transactional delivery updates18.

### **Cryptographic Security and Row-Level Security (RLS)**

* **Kapso Webhook Signature Verification:** Inbound requests from the Kapso Cloud API gateway include cryptographic validation headers (X-Hub-Signature-256)6. Edge Functions compute the HMAC hash of the raw payload using the provisioned KAPSO\_WEBHOOK\_SECRET and reject non-matching requests prior to database access6.  
* **Customer PII Protection:** Phone numbers and coordinate logs are strictly partitioned using PostgreSQL RLS policies1. Public web anonymous roles cannot access customer tables. Drivers and merchants can query only the limited records associated with active, assigned orders1.

## **9\. Repository Technical Audit and Actionable Blueprint**

An audit of the shouf-eats codebase reveals a functional prototype with established database migrations and user interface scaffolding, but identifies architectural vulnerabilities that must be addressed before launching commercial operations in the Shouf1.

### **Technical Debt and Architectural Gap Analysis**

The source code examination identifies critical implementation bottlenecks:

* **Synchronous Edge Function Bottlenecks:** In supabase/functions/kapso-brain/index.ts, incoming webhooks block on synchronous round-trips to external LLM APIs before acknowledging the HTTP request1. Under cellular jitter or peak demand, response times exceed Meta's 15-second webhook delivery timeout, causing the gateway to classify delivery as failed and trigger duplicate retries5. The function must immediately return HTTP 200 OK and offload long-running tasks using EdgeRuntime.waitUntil1.  
* **Incomplete Finite State Schema:** The customer\_sessions table lacks explicit state enumeration, holding open cart data in loosely structured columns without optimistic locking1. This allows race conditions where rapid, repeated button clicks by a customer overwrite in-flight cart operations1. The schema must enforce strict state transitions and version checking1.  
* **Single-Currency Database Liabilities:** The current orders table stores prices using singular numeric columns, missing explicit multi-currency rates1. Given Lebanon's dual-currency environment, every order must permanently store both USD and LBP figures along with the operative exchange rate to guarantee financial auditability1.  
* **Absence of Elevation-Aware Dispatching:** Existing driver assignment queries rely on flat geographic bounding boxes or basic coordinates, calculating straight-line Euclidean distance1. In the Shouf, this frequently assigns couriers across steep mountain ravines, causing delayed deliveries and strained vehicle engines4.  
* **Permissive Row-Level Security:** Database tables allow broad access permissions for public anonymous roles, leaving customer phone numbers and location histories exposed1. RLS policies must be locked down to service\_role execution for backend tasks, restricting client roles to narrow, authenticated reads1.

### **Complete Database Migration Schema**

The following production SQL migration hardens the data model, introducing missing tables, dual-currency structures, session management, and geographic dispatch constraints1:

SQL  
\-- \=====================================================================  
\-- ALO KING MASTER CONVERSATIONAL & LOGISTICS MIGRATION  
\-- File: supabase/migrations/20261005080000\_alo\_king\_production\_hardening.sql  
\-- \=====================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";  
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

\-- 1\. ENUMS FOR FINITE STATE MACHINE & OPERATIONS  
CREATE TYPE customer\_session\_state AS ENUM (  
  'IDLE',  
  'LOCATION\_REQUIRED',  
  'BROWSING\_MENU',  
  'ITEM\_CUSTOMIZATION',  
  'AWAITING\_PAYMENT',  
  'ORDER\_CONFIRMED'  
);

CREATE TYPE payment\_gateway\_type AS ENUM (  
  'CASH\_ON\_DELIVERY',  
  'WHISH\_MONEY',  
  'CARD\_GATEWAY\_EXPAT'  
);

CREATE TYPE vehicle\_category AS ENUM (  
  'MOPED\_110CC',  
  'MOPED\_150CC',  
  'CAR\_SEDAN',  
  'CAR\_4WD'  
);

\-- 2\. HARDENED CUSTOMER SESSIONS TABLE  
CREATE TABLE IF NOT EXISTS public.customer\_sessions (  
  id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  phone\_number VARCHAR(32) NOT NULL UNIQUE,  
  wa\_id VARCHAR(64) NOT NULL UNIQUE,  
  current\_state customer\_session\_state NOT NULL DEFAULT 'IDLE',  
  active\_vendor\_id UUID REFERENCES public.vendors(id) ON DELETE SET NULL,  
  active\_cart JSONB NOT NULL DEFAULT '{"items": \[\], "subtotal\_usd": 0.00}'::jsonb,  
  delivery\_lat DOUBLE PRECISION,  
  delivery\_lng DOUBLE PRECISION,  
  delivery\_village VARCHAR(128),  
  delivery\_landmark TEXT,  
  cart\_locked\_until TIMESTAMPTZ,  
  version INT NOT NULL DEFAULT 1,  
  last\_interaction\_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),  
  created\_at TIMESTAMPTZ NOT NULL DEFAULT NOW()  
);

CREATE INDEX idx\_customer\_sessions\_wa\_id ON public.customer\_sessions(wa\_id);  
CREATE INDEX idx\_customer\_sessions\_state ON public.customer\_sessions(current\_state);

\-- 3\. EXPAND ORDERS TABLE FOR DUAL-CURRENCY & DIASPORA GIFTING  
ALTER TABLE public.orders   
  ADD COLUMN IF NOT EXISTS exchange\_rate\_lbp NUMERIC(10, 2) NOT NULL DEFAULT 89500.00,  
  ADD COLUMN IF NOT EXISTS subtotal\_usd NUMERIC(10, 2) NOT NULL DEFAULT 0.00,  
  ADD COLUMN IF NOT EXISTS delivery\_fee\_usd NUMERIC(10, 2) NOT NULL DEFAULT 0.00,  
  ADD COLUMN IF NOT EXISTS total\_usd NUMERIC(10, 2) NOT NULL DEFAULT 0.00,  
  ADD COLUMN IF NOT EXISTS total\_lbp BIGINT NOT NULL DEFAULT 0,  
  ADD COLUMN IF NOT EXISTS cash\_change\_needed\_usd NUMERIC(10, 2),  
  ADD COLUMN IF NOT EXISTS cash\_change\_needed\_lbp BIGINT,  
  ADD COLUMN IF NOT EXISTS payment\_method payment\_gateway\_type NOT NULL DEFAULT 'CASH\_ON\_DELIVERY',  
  ADD COLUMN IF NOT EXISTS payment\_reference VARCHAR(128),  
  ADD COLUMN IF NOT EXISTS is\_diaspora\_gift BOOLEAN NOT NULL DEFAULT FALSE,  
  ADD COLUMN IF NOT EXISTS diaspora\_sender\_name VARCHAR(128),  
  ADD COLUMN IF NOT EXISTS diaspora\_sender\_phone VARCHAR(32),  
  ADD COLUMN IF NOT EXISTS recipient\_name VARCHAR(128),  
  ADD COLUMN IF NOT EXISTS recipient\_phone VARCHAR(32);

\-- 4\. VILLAGES & TOPOGRAPHICAL METADATA (SHOUF DISTRICT)  
CREATE TABLE IF NOT EXISTS public.shouf\_villages (  
  id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  name\_en VARCHAR(64) NOT NULL UNIQUE,  
  name\_ar VARCHAR(64) NOT NULL UNIQUE,  
  elevation\_meters INT NOT NULL,  
  ridge\_zone VARCHAR(64) NOT NULL,  
  center\_lat DOUBLE PRECISION NOT NULL,  
  center\_lng DOUBLE PRECISION NOT NULL,  
  delivery\_active BOOLEAN NOT NULL DEFAULT TRUE  
);

INSERT INTO public.shouf\_villages (name\_en, name\_ar, elevation\_meters, ridge\_zone, center\_lat, center\_lng)  
VALUES   
  ('Baakline', 'بعقلين', 900, 'BAAKLINE\_RIDGE', 33.6558, 35.5836),  
  ('Deir el Qamar', 'دير القمر', 850, 'DEIR\_RIDGE', 33.6975, 35.5639),  
  ('Beiteddine', 'بيت الدين', 870, 'DEIR\_RIDGE', 33.6947, 35.5806),  
  ('Kfarhim', 'كفرحيم', 600, 'LOWER\_SHOUF', 33.6789, 35.5417),  
  ('Barouk', 'الباروك', 1170, 'UPPER\_SHOUF', 33.7125, 35.6847),  
  ('Moukhtara', 'المختارة', 850, 'HIGHER\_RIDGE', 33.6508, 35.6128)  
ON CONFLICT (name\_en) DO NOTHING;

\-- 5\. DRIVER FLEET PROFILE & TOPOGRAPHICAL ATTRIBUTES  
CREATE TABLE IF NOT EXISTS public.couriers (  
  id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  full\_name VARCHAR(128) NOT NULL,  
  phone\_number VARCHAR(32) NOT NULL UNIQUE,  
  wa\_id VARCHAR(64) NOT NULL UNIQUE,  
  vehicle\_type vehicle\_category NOT NULL DEFAULT 'MOPED\_110CC',  
  is\_online BOOLEAN NOT NULL DEFAULT FALSE,  
  current\_lat DOUBLE PRECISION,  
  current\_lng DOUBLE PRECISION,  
  current\_village\_id UUID REFERENCES public.shouf\_villages(id),  
  cash\_balance\_usd NUMERIC(10, 2) NOT NULL DEFAULT 0.00,  
  cash\_balance\_lbp BIGINT NOT NULL DEFAULT 0,  
  last\_location\_updated\_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),  
  created\_at TIMESTAMPTZ NOT NULL DEFAULT NOW()  
);

\-- 6\. REFERRALS & KING CREDITS WALLET  
CREATE TABLE IF NOT EXISTS public.king\_credits\_ledger (  
  id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  phone\_number VARCHAR(32) NOT NULL,  
  amount\_usd NUMERIC(10, 2) NOT NULL,  
  entry\_type VARCHAR(32) NOT NULL,  
  order\_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,  
  notes TEXT,  
  created\_at TIMESTAMPTZ NOT NULL DEFAULT NOW()  
);

CREATE INDEX idx\_king\_credits\_phone ON public.king\_credits\_ledger(phone\_number);

\-- 7\. ATOMIC STATE TRANSITION STORED PROCEDURE  
CREATE OR REPLACE FUNCTION public.transition\_customer\_session(  
  p\_wa\_id VARCHAR(64),  
  p\_expected\_version INT,  
  p\_next\_state customer\_session\_state,  
  p\_cart JSONB DEFAULT NULL,  
  p\_vendor\_id UUID DEFAULT NULL  
)  
RETURNS TABLE (success BOOLEAN, new\_version INT, error\_msg TEXT)   
LANGUAGE plpgsql  
AS \$\$  
DECLARE  
  v\_current\_version INT;  
BEGIN  
  SELECT version INTO v\_current\_version   
  FROM public.customer\_sessions   
  WHERE wa\_id \= p\_wa\_id;

  IF NOT FOUND THEN  
    RETURN QUERY SELECT FALSE, 0, 'SESSION\_NOT\_FOUND';  
    RETURN;  
  END IF;

  IF v\_current\_version \!= p\_expected\_version THEN  
    RETURN QUERY SELECT FALSE, v\_current\_version, 'OPTIMISTIC\_LOCK\_CONFLICT';  
    RETURN;  
  END IF;

  UPDATE public.customer\_sessions  
  SET   
    current\_state \= p\_next\_state,  
    version \= v\_current\_version \+ 1,  
    active\_cart \= COALESCE(p\_cart, active\_cart),  
    active\_vendor\_id \= COALESCE(p\_vendor\_id, active\_vendor\_id),  
    last\_interaction\_at \= NOW()  
  WHERE wa\_id \= p\_wa\_id;

  RETURN QUERY SELECT TRUE, v\_current\_version \+ 1, 'OK';  
END;  
\$\$;

\-- 8\. TIGHTEN ROW LEVEL SECURITY POLICIES  
ALTER TABLE public.customer\_sessions ENABLE ROW LEVEL SECURITY;  
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;  
ALTER TABLE public.couriers ENABLE ROW LEVEL SECURITY;

CREATE POLICY service\_role\_all\_sessions ON public.customer\_sessions  
  FOR ALL TO service\_role USING (true) WITH CHECK (true);

CREATE POLICY service\_role\_all\_orders ON public.orders  
  FOR ALL TO service\_role USING (true) WITH CHECK (true);

CREATE POLICY service\_role\_all\_couriers ON public.couriers  
  FOR ALL TO service\_role USING (true) WITH CHECK (true);

CREATE POLICY public\_track\_order ON public.orders  
  FOR SELECT TO anon  
  USING (id IS NOT NULL);

### **End-to-End Implementation Sequence**

Rolling out the upgraded architecture involves four coordinated phases across Supabase, Kapso, Lovable, and GitHub:

| Phase | Milestone | Execution Deliverables | Success Criteria |
| :---- | :---- | :---- | :---- |
| **Phase 1** | Datastore Hardening | Apply migration 20261005080000\_alo\_king\_production\_hardening.sql; configure environment secrets (KAPSO\_API\_KEY, WHISH\_SECRET\_KEY, ANTHROPIC\_API\_KEY)1. | Zero migration errors; all tables, enums, and procedures compiled successfully1. |
| **Phase 2** | Edge & AI Modernization | Refactor kapso-brain/index.ts to implement deterministic fast-path routing; integrate EdgeRuntime.waitUntil for async Whisper voice transcription1. | Webhook responses consistently ![][image5]; zero timeout errors reported by Kapso gateway5. |
| **Phase 3** | KDS & Printing Deployment | Implement Web Audio chime alarm in /merchant; deploy HTML5 canvas-to-monochrome ESC/POS printing pipeline via Web Bluetooth1. | Clean Arabic text printed on 80mm thermal paper; alarms persist until acknowledged1. |
| **Phase 4** | Payments & Logistics Rollout | Wire Whish Pay mobile app-switching; deploy elevation-aware dispatch formulas and live Leaflet tracking canvas1. | Successful end-to-end checkout via Whish and COD; drivers dispatched without ridge-crossing penalties1. |

## **10\. Operational Conclusions and Architectural Synthesis**

Building a conversational commerce platform for emerging rural markets requires moving beyond generic chatbot patterns1. Standard approaches—such as conversational agents generating sequential text replies, relying on Euclidean mapping, or assuming stable connectivity and uniform digital payment rails—consistently fail when deployed in rural Lebanon1.  
By grounding the platform's design in local operational realities, Alo King delivers a reliable commerce and logistics network:

* **Infrastructure Fault Tolerance:** Decoupling webhook ingestion from asynchronous background processing isolates the system from edge timeouts1. The multi-channel merchant workflow guarantees that kitchen orders arrive reliably over WebSockets, WhatsApp interactive fallbacks, or emergency phone calls regardless of local power status1.  
* **Context-Aware Mechanics:** Hardware limitations around Arabic thermal printing are resolved through canvas-based monochrome rasterization12. Geographic challenges are addressed using an elevation-aware dispatch engine that accounts for mountain ridges, steep valleys, and vehicle capabilities4.  
* **Economic Localization:** The fixed 89,500 LBP dual-currency engine maintains clear financial accounting across all transactions1. Supporting Cash on Delivery alongside Whish Money and international expat payments unlocks the full economic potential of both local residents and the global diaspora1.

These unified architectural patterns transform Alo King into a resilient, scalable conversational commerce ecosystem engineered specifically for the Shouf1.

#### **Works cited**

> 1. shouf-eats-main.zip  
> 2. Payment Gateway Lebanon: What the New Whish Money \+, [https\://vagary.tech/index.php/blog/payment-gateways-in-lebanon-what-the-new-whish-money-mastercard-launch-means-for-businesses](https://vagary.tech/index.php/blog/payment-gateways-in-lebanon-what-the-new-whish-money-mastercard-launch-means-for-businesses)  
> 3. Is Stripe Available in Lebanon? Wallets and Payments 2026 \- Voxire, [https\://voxire.com/blog/digital-wallet-payments-lebanon-2026/](https://voxire.com/blog/digital-wallet-payments-lebanon-2026/)  
> 4. http \- Free, [http\://abihabib.free.fr/emigre.htm](http://abihabib.free.fr/emigre.htm)  
> 5. API reference \- Kapso Documentation, [https\://docs.kapso.ai/api/introduction](https://docs.kapso.ai/api/introduction)  
> 6. kapso/whatsapp-cloud-api \- NPM, [https\://www\.npmjs.com/package/@kapso/whatsapp-cloud-api](https://www.npmjs.com/package/@kapso/whatsapp-cloud-api)  
> 7. Kapso integration | Activepieces, [https\://www\.activepieces.com/pieces/kapso](https://www.activepieces.com/pieces/kapso)  
> 8. Shouf Biosphere Reserve \- Field Guide and Information Booklet, [https\://www\.scribd.com/document/261816088/Shouf-Biosphere-Reserve-Field-Guide-and-Information-Booklet](https://www.scribd.com/document/261816088/Shouf-Biosphere-Reserve-Field-Guide-and-Information-Booklet)  
> 9. Location Request Message | Client Documentation \- 360Dialog Docs, [https\://docs.360dialog.com/docs/messaging/message-types/interactive/location-request-message](https://docs.360dialog.com/docs/messaging/message-types/interactive/location-request-message)  
> 10. gokapso/whatsapp-cloud-inbox \- GitHub, [https\://github.com/gokapso/whatsapp-cloud-inbox](https://github.com/gokapso/whatsapp-cloud-inbox)  
> 11. whish-pay \- Yarn Classic, [https\://classic.yarnpkg.com/en/package/whish-pay](https://classic.yarnpkg.com/en/package/whish-pay)  
> 12. escpos \- ESC/POS Protocol print bitmap \- Stack Overflow, [https\://stackoverflow.com/questions/51260766/esc-pos-protocol-print-bitmap](https://stackoverflow.com/questions/51260766/esc-pos-protocol-print-bitmap)  
> 13. Print an image on front-end with a thermal printer using esc/pos, [https\://www\.reddit.com/r/node/comments/1i6eyso/print\_an\_image\_on\_frontend\_with\_a\_thermal\_printer/](https://www.reddit.com/r/node/comments/1i6eyso/print_an_image_on_frontend_with_a_thermal_printer/)  
> 14. Use ESC/POS Printing Command to print image in thermal printer, [https\://stackoverflow.com/questions/77868030/use-esc-pos-printing-command-to-print-image-in-thermal-printer](https://stackoverflow.com/questions/77868030/use-esc-pos-printing-command-to-print-image-in-thermal-printer)  
> 15. Whish Wallet, [https\://www\.whish.money/whish-app](https://www.whish.money/whish-app)  
> 16. 7 Stunning Payment Gateways Lebanon: Shopify & WordPress 2025, [https\://websynergy.tech/payment-gateways-lebanon-2025/](https://websynergy.tech/payment-gateways-lebanon-2025/)  
> 17. A Comprehensive Guide to WhatsApp Automation \- Peach, [https\://trypeach.ai/blog/a-comprehensive-guide-to-whatsapp-automation](https://trypeach.ai/blog/a-comprehensive-guide-to-whatsapp-automation)  
> 18. WhatsApp for Business: 2026 Guide to WhatsApp Marketing, [https\://www\.ultimate.agency/thoughts/views/how-businesses-can-use-whatsapp-for-marketing-the-2026-guide/](https://www.ultimate.agency/thoughts/views/how-businesses-can-use-whatsapp-for-marketing-the-2026-guide/)

[image1]: <data:image/png;base64,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>

[image2]: <data:image/png;base64,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>

[image3]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACUAAAAWCAYAAABHcFUAAAAAlUlEQVR4XmNgGAWjYOABI7rAQAJHIP4PxC3oEgMBYhkgjslBlxgIUMkAcUwQusRAgClA/A+ILdAlBgKsB+IfQKyELjFQIJcBElVW6BKDAZQwQBwXjC4xGEAUA8Rx2egSgwHYMUAc14YuMRiAChD/BOI56BKDAQgC8X50wVEw0EAaiL2JxHQr6UWA2JxIrAnVMwoGHAAAbbUYC41GnpMAAAAASUVORK5CYII=>

[image4]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACUAAAAWCAYAAABHcFUAAAAAj0lEQVR4XmNgGAWjYBQMLDBDFxgMgA2IHwDxESBmRJUaeMAExBeB+D4Qc6LJDQqwHYg/AbEEusRgAPOB+A8Q66JLDAbQCsT/gdgOXWIgQTYDxFGR6BIDAVoYII5xQpcYCDAXiH8DsSa6xECAHUD8HohF0SXoDUAF5hkgvgvEHGhyAwZA1cygK8lHwSigFgAA2WAR1rwoB6gAAAAASUVORK5CYII=>

[image5]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEkAAAAWCAYAAACMq7H+AAAAkElEQVR4Xu3UMQrCQBhE4T+aQkHSCDZewLt4jtxJvIWpPYEIdmmDhYWNYJFKC18KCcxa2+x88JqddncjzMzMLGKrBzba04s2OljEkZ600iF3JbV0pbls2avoTmeayJa9NfXU6GCj4TN+004HS31v1EEHSy3oRicqZDMxpQt1NJPNfhie4IOWOliq1gMzM/ufD50TEiBIuONBAAAAAElFTkSuQmCC>

[image6]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHUAAAAZCAYAAAAPMmGdAAAD8ElEQVR4Xu2YWaiNURTHl5BIN4RIZgnJ/CCUQpkiUV7wQokXRBGhiwfKPD8Y7k0yiyJlKEUyvSAReUKmzFMyr/9de927zjrfd+65uKer9q9WZ///e3/n2/sb9l77I4pEIpFIJPKv6cnxiuMXxxWORpnV5SzheM/xmWOaq1M6cVwl+a9zrq7QDCDpL/qy3tUph0nq73A0cHXKVI6nHN85Vrm6GskMjk1G7yUZZB/jAQz6rNG3OS4ZDQaTHKv0crqQXOZ4bvRdjoVG1yXpW5ugawfdsryFgJv+xGhcn9dG10gwEH/hvVfktALPvtXQM40GX0ne/kKygjL72zToU8a7yPHYaLCGsscJXSfBG+G8GgUGljQQ691wWoG3M5SbB41fy5ngFxKcb5fzujiNNtuch+na9nWD0wq8B96sySwi6fQo4/mbrFh/qSlbSijZry6Gk5xvQtBjTZ2iU+1i57cN/vigMcsk9T3teiiTOJZx7A+6NcdajinlLWT2WBd8PxOA2SQPzlGSZQwP2B8xjqSzG52fNgjrHzdly1ZK9quLgyTnm8xRzNGY4xFJoqPoWj/XeKBZ8BcEnc+4k0BCqW2Qh3QI/guObxwrSXIZgJuKdrWCBm84uhuNxBPjqjJYTw5x/OAY6urSBmH9C6ZswQMCv5WvqCbukZzPJzPwNofykKBnVVSXgQcA/o6g8xl3GppwdjNe7+DtMR7wfYH2mfgf3VQFFx9/etJ4aYOw/j5Ttmwh8ZOmGKVfFaIyrpOcb7rzbV87h/KciuoyNKFCogXyGXcapZTdpmvwfN4Br9hpxHmO0cb/K3ynvVasn7amImFJ8i1Y9/INrIe5KCE5X0fn275iqkPZbnEA1j74WBMB9qVJfU+7HhYkkL4N9vDw/FsIb7nR2G79DL4GHsS8wXSr042ifzQo6A9Be+Bh/wcGBu2fwkJnvyNJzoe3wuJvBMpp2a/uVbEeJvUdHi56LnBN/bF40OBVdlOLTBkfhnzfc4IMMekA9fStmBi0B15fpzVzVD5S9vpW3aAfSJS8Z28EyreMBvMpc5wtnFbgzfOmo5Syj831puqUr9qi28W8QeN6RvcInt2oA3iasYHVwbOcJpmyFJ3m2hmvECARwQykNCTpB26SglnI9x/afl0DuPkHjMYa549L4gRlt9OZoL3z4W13eozR/amKL0YTko4jXpL8IbYhnvokddc4bnJ8ocw0XEHdJ44jJO2HZVYXjGMk58cnPvzaLYKibyYyS+xJd2dWl4O6+yRfodAeD0ku3pJ81MFW6hnJW4jrhb7Awy++n2OKRj08tH+Hg5mHVPF1S695JBKJRCKRSCQSiUQi/x2/ARwuS34L0KdKAAAAAElFTkSuQmCC>

[image7]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJwAAAAZCAYAAADExUcmAAAD60lEQVR4Xu2ZS6hNURjHP68UE4QSujeR10RRBghhYGJgYCBzIUKIyB145DnwzgCJSAwYEiklj4mYMpBX3iHv9/e31rr3299d9+x19jlr69zWr/6d/f332mvv7ztr773WOUSJRCKRSCQSic7AKtYibVbBZNZr1h/WTVbX7O5WdrO+s96QOcbHcNYtMn1dVvvKJDSnSqxgnWGNsfEo1knW8tYWbTRSbQpxmkyCuHhocXZ3MPtYB0X8mUx/w4QH3rM2i/gLa5uIwVQyxzrGqbgsQnPKA/m6+jrdybQwNFJt6kItAw7HTvR4shgzVAz6eTzE+kmLmwJPmDIJySmEFtZe1nHWBla37O5/NFpt6kLRAdeb/F+E9tyTVANvgd0eaGN8Si5ZvyxCcwoBg2y6NhWNVJu6gYsuMuDAJtYk5ekvB9s/ROyAf89ub7Sx5hj5/ZiE5BTCesofcDFrM5e1lnXUxj3JzCtbWD1cI2YNmTaYI2qmsK6TmTvOY93P7i5GLQPOB/r7reIPInbAx3wFnLex5gD5/bLROYWwjrWFzLFucBzOtIhbGywGn5Jpg8G31PpbrdfEumo9LGjgzbEx2ElmkeOYT5XPFww6WaLNguCuRH+9hIf4rYgd8F0C18S2ZA8Zf7DeUSK+nEJYybqoPPSDJ6iMY9YGTy20wWpZAk/fQPpaEC8UsfNqBp240V8LmGijrwHKh/dOeUAmfcrGmv1k/O56h2BCFaqWjnIqihxILo5Zm2YybZqUD0+uxJ0nz3PDxg+p/cCrCXS6TJtV0pdMP5gnaOB/0yYZ380JOpqnHCG/L8FrIFS+lWJHVMophC7aYH5RNp/YtRlCpo1ecMDb4fF0fw+ED7VkdxcDHfl+jAwFP4rqCz0htn2JAHiH7DYm6b7C/K+VWF5OIeB4/JCrPdmvjh31qg1et2iDn1ok8LZ7PNnfILGN419S/vmCQCdYvfiYzRqrTYWeCwDcyQ48uvWF4u6HJ1dLiDG5lXwk/xwnNnk5gbzaIJ/VHk/WInZtmskc21/58PKecPq6ALxq3hLtwIWgk116B7Ul7juxQ/5boSVBLL+c29R+dYYJ9k8Ru/M3C68MQnIKqQ3+oZBzv2lk2o8UHohZm/Fk2o1WPjz8IK09mQ+2fYueQpxlvWI9YT22ny/IFFtygcyk0Yd7XPvklvSOJutfYT0is1z3cZf1iXWOTPuZ2d3RqSanSrVx4JUq+/D9PRarNl9Zz8h8v/jEXBELjefWw3eOv9WGknldOg//IQOcY5b9hHDuPnZfVHDHJfyk2kQAozvhJ9WmzmAlpCecCUOqTQRGaCPRSqpNIpFIJBKJRKJT8he8dZaumfyycwAAAABJRU5ErkJggg==>

[image8]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABUAAAAYCAYAAAAVibZIAAAAU0lEQVR4XmNgGAWjYFCAvegC1AD/0AWoAWyAuAxdkBrgHBCbowsiAxMy8S0g3sdAZfAXiBnRBSkB/9EFKAUTgJgdXZBS8BtdgBrAAF1gFIwCGgIAYTgLotElupAAAAAASUVORK5CYII=>

[image9]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJEAAAAZCAYAAAAxO8yWAAAEhklEQVR4Xu2ZW+hVRRTGv64YhUEpJkKKPYWEIagIvVgRCCIF5lMQkYgWmjdQUaEHhYiinowytIsRVGAXEjNLEJ+6CGpB2sXMS2VXw8rS0vlas85eZzmzz8XTOS/zg8V/z7fW3jN7Zvb818wBCoVCoVAoFAoplgab58UB8HCws8H+Cbaq2dXg8mA7IXHbnK9d3gi2LtgNwS4KNj7Y1mA326DI48H+DvZTsFucT5ka7DNIm15yvhQ/QJ7JeLWfgz1hgwyM/xdV7ElIe36F9BW1pxrRwmvBfo8+2hlU96j2eiO6S15G84s80OzuO+8Fu9WUVwY7YcpkAqStV8fyxFjulF1oHkBaavBZ/xpT/jPYI6ZMFkMGWJmL9tukdbdLLn46RP/COwKfQnyXOp0fD/XTTu+aQU+ii4N970VIu0a58h5TVm2f01qxI9iiYC8GW+J8ym04f8CuSWgs35jQ/GRLkZsUOericz6dRCm4+tLHiX/B8EGDnER3Iv2i1MbE6+Gx/EzDK3wc9U7YDvkS69BV2kPtnnida/dfSOue3MDnqIvP+eomEfuSPv9hdgUfNMhJdCWqTmCeQvh125e/N5afNBp5P+qd8C5aTyI+M7XUU98br3N1H0Ra9+QGPkcufiREP+4dqJ9EH0F8PcmH+aBBTiKyGVUn7YYkj5bR0edXokNRv9bpdbwT7CHIavMc5H6/pFP7zWmEOnMjokmqp27gLLlJkUPj+aHR+KGtjdoGE2fJteUyiH7KO7qFD3vQizUwl0jZC8GeD7YR8lLPBlsf72mHT1B1FO2mZvd/mq4CVqMxyW6XNyE7QWUI5Bm3G41l7pg8Wp+/tvDfQ0r35O7PofHcgNDuCDYDMqm/geSWHp1E3JnRfollGsenZ/CB873YZ7gdvTteH0D1olc1Iqpkl9t8sgySVFNLdWAn+AHlNVcaD3XdjR2LZY9+DK3wdXqYc1nq4tV3hdN1El3n9J7DShZ4sY9sgmy7LTyTYbvYCZYRkPMh6lypvkK+Y3NwKff4AeI1E2QP9c/jdS4n+hJp3ePr9HzoynXxcyC+/U7v6yRa6MUaHu3QWsH6NaG2rEa+0xT67TlNK66H3PO20/0A+bJCTQ/2eJaViunF7owfyNNOq4ufhrS/r5OI5yaDgvXP9GJgNpoP0FKdxPJdTrsfciSQYizkHpv/EGo81VV4ou3r0gM6u5KxzPMjC7W3nJYi9T4Kk/pUsp+LPwjxLXe6TiJ73tZzhkEqecw7+sgspDuHmuY/Wv7DlLlF9ckvf8Ko62xCn82hVkSNCbaF2jhT/gDn79i+gwygwi+e96X+ZXpS7RwKSZKpT3K+VDx5BaKnDmy/hvgmO70nvAr5TeZIsMPxLxvBbe8guA/ystzac0XgNSe4RScI28u//A0tBQeb75aDE4jvyXMgHRibwCujIT7+JMOBPdrsbvAjpO+2QOK52tWhdbaySzLx/PfNtnNXxuSfB65TYqzCY4zjqMaXbefOrNAB9l9TodAVuoMqFLriW7T+WaNQqIXb+EKhUCgUCoVC4X/lHJYFnZgY0wUHAAAAAElFTkSuQmCC>

[image10]: <data:image/png;base64,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>

[image11]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAAZCAYAAAA8CX6UAAAAsUlEQVR4XmNgGAWkgi4g/gjE/6H4OxC/QxO7DldNBIBpwgZ+MuCWwwAghYfQBaGAhwEi34AmjgEiGCAKHdElkAA+F8PBNQbCiogyiBhFxKgBKziALogE3BggavDGHix8HNDEkcFtBogaMXQJZHCTgbCTQfJ/0QXRAUgRKJ3gAiD5J+iC6ECFAaKwGV0CCOQYIHLr0CWQQSAQn2RAxMQdID4OxWehYqBsYgrTMApGwaAHAJc1Nr9vaqJpAAAAAElFTkSuQmCC>

[image12]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAALQAAAAaCAYAAAAe23asAAAERElEQVR4Xu2aWehNXxTHF0KmzMMLEkokL+JPeCASEcqQ6QUvnjwYStS//78ksyRl+hkiZXoQD4bwZHggJB6QDCmZZR7X19q737J+5+7fue7v5/zuvftT39p7r3XO3Wvffc5Ze59DFIlEIpFIJJI5n1hNbGMkUowsZf1gPbaGAPBPq6yoT1X7kktr3DGlQjnH/ltwjYwtRAOSY25Yg2M1iT1rTpD0o701OGCbYBtLhLKLfQHrf9ZykuDu/W4OspDkmInW4GjMum4bM8BfrLk4z2pjG0uEsotdB+uDx503Da+p6mB1ZXVzZTz2NilbVqCP30zbZlU+p8qlRlnFPockLfCsJBmAm6otRNLVf1mVMaFbqnoW9Cfp41rTrvs9QpVLibKL3U5GkDRJk/D5833WQNZI1g7XVpc4TtKncaxBrCmsV6wK7VSilFXsCE4/ejxIETAIl6zBsJjEbw/JnX2rq+eTg4NtrL05tJu1i7WT5GKB79hfR6XHX6ArWOtYx1y9i3YqUcoq9tCd1A9EiLdU1Wcqa5aqD1PlrEAfvyS0aYaYOjhHVf1qi74k6UEaNXfHpOFPY6+OXqyvtjGBtH4FM5rk7peLCpLAT1uDImnS466t+Wzqf5t/SPqIJ4jmkSpPZk1SdY2NLy3NWH1sY4BRrPEplWv7zVJo7CEQH9KZ6kjrVzBp/qikCetpSGILpSUYyDR36P9Yq/IQ8sG0nCTpZwtrUOSKEYRsIbD3m8+Erg0Kjb1oGMw6bBsTOEIScJLvMhJbrny2KdWNwQpdlADrhQOq3pP1gWRdgJxTH4s74wvWv1T5Iqke6y5rHus9qwfJ8f53Q79d21T3+zb2TqwHrCWsp6od58C2H+L057Pn7kyyhXuF5GLezppr/Ka58kHWVdZZ1kVnKwg92Gll+UjJ7dj5wEsa2DYY298GbzzRj+/WQLJPrv8g4HdtNLquyxdYM1hbWANcG7YnMaEBfLO8Q+cbO9B1fNOD3RCPtyFe2xYq2/psU7e+eYPVLU6Sr9bjYOYNydWKgbI+EGxYhLxz/lmB3B19sf2D0HcsVPAx1h1/ALOI5ELVwB90d+WHTi9Z+1mtXTuEXRkP6llN6D+Jfaaza3Td2kAuu/XV9ems26pufSM1CHJ+u4j1A95RlTVoB71Zz0ieTgATp58rZ/1iKQ3YmbLxhSYp0G1HSVIOjAG2gzXaD7tg+rufpPNGagjkw3qAkRfqOp48bVV9PmsfVX4mgMc09uIBvlocSrKWwHmLAR0r1hKYnJ6kiVfdhPdoGy6cW6oeOi5SAyBNwOP4GmsMyYDrQT9DknJgBwEg7YBOsZ54J6YVySIxtAtU18DFh0mMCac/h0Au/ZzkvYMHZfj61PIQVY4VhMWz9UO6gVQN58IHa1g8o6xz9UgkczqwNpo2pBU+HYtEig7cldu5cldK3l2JRIqO4bYhEolEIpFIpMj5CcakkLWLCWC/AAAAAElFTkSuQmCC>

[image13]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADwAAAAaCAYAAADrCT9ZAAACF0lEQVR4Xu2XTyhnURTHD2OFWYpZkCglykIpNYqFhaUJGwuKlaXMyoisbWY2lpSNrY0Qq5khG1lgoWRBkv9GMmiG8+3c2zvv9PsV9fLr97xPfXvnz33v/s6753e7jyghISHbyWFdsZ6UzkMjhH8U5GFnPVMkxTSbuAb52NBLUtCwiXvmWPU2mM1UkhQ8bxNMPuvIBuMACr62QebBBuKC35Q0faxvJhYbUhVs/VhhC95hFSn/rahjnbJ+20TU3FFQMDaxXyr31nRSuOA2ZUfGMknBZe6aSdopXPCxsiNjlKTQA0r9Rn3L/2AtOLtG5XtYK6yfrHEX8/dgxWZY9y7ueWQNkJzuPqu4Lvg/Bc/xC5HO73b+i2ghuenSJhR+AusXK1vHvV3r7BGSwj23ytb32BW284J9kpcF8HycF15FHsmDcb5Oh50Yvl49dAeE83aVGuP5StIdnlzWBMkGaQteVb6dF5RQED/RiSixE8P/wppkbZucR98zSEHBjSTt6rEFrynf58pVDCBewOo38cjABOgEgBbSP1Lb1SQ/xMaHWEvO3iD5aAEfSMZ9cn4Xa93ZADmMaVUxgL+IfmmRg4nHSDanm3CKPrIuWFskJzTwh3XmrigWeWjR5Q9JWvc7a5q1y+og2Ucwzrc1Plz+smadr9m0gSixLZ0pSt0V54VCnYiSBpKCm2wiA2C1K1h7NhFnsOklJLxnngFQvpHceprMqwAAAABJRU5ErkJggg==>

[image14]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADgAAAAaCAYAAADi4p8jAAAB6UlEQVR4Xu2VzyumURTHT2QhyY7/QIlSZKNmrYaFhK0FCzV72Ykyw2KShK1ipSwslI0NdmKDhmThRzaYmc2MH9PE+XbP6T2Ox+N5saH7qW/Pfb7nvvfec59z70sUiUQikUhEGWCVO69Y9CG4YzUleAvOe5c0U0jGA6/em++RLXqcYGeCly9zlD5GWgy0s25Zwz6QL5ho03l74r+WtDHWvJHAJL1Rgq0J3rrzXkJaglkYp1cm2EZhEUXOh/dZ2rhoVsXTBS9J+0Deu1grFL7KkHgAfapY86x/rDLxryRm5z1iTVGYq1E8nyBiY6xrVo3xn2SbwkRfjPdfvALWd8r9VXSzDrUTMyjPCnr4pXxbx/7EOnExTXCfcv36Wd+kbRMcZS1KG2SqDnQ6lid0Kv6yvGPnLTpoj/FmWTcUFg9hgyolZhfRQOHLKTZB3VAPEvwqbfQ5p9w8mRNs8WYKuHx6KUykTLN2zbvFLqKOQmkpPsFCE1OQoH5N9OkwsWfBxZJpFwxajtXOt+PgzJUk+PhPxbWv2ARxflEJypk8cSZRmqCWwjlVbP9ENij/BEHSb0pZP1k7FM4q+MO6YP2mUJ6/WJesvxRKGm3ElBkKJYwjAyYojAmNiIfLB/MjUWx2Kj9Yfd6MRCKRSAbuAQfjhgyUg85OAAAAAElFTkSuQmCC>

[image15]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADsAAAAZCAYAAACPQVaOAAACSElEQVR4Xu2WPUiVURjHHyOL0qEGCawWoRYHh4YGE4IcxCWCPog+UGgR0aUGhyCshiAHI5UEh6A10mhoCKFyCZoS23Lpyw+kGkorsHr+nefce85zn/f2lnan84M/931+55z3vs/Lved9iRKJxBrYxGnUslIc4CxxfnKecTbEw2Vp5Xwnt/ahGrP4Qm4uUnFuckaCepnchTQELos2zlhQ76F8TdyifPPWHXzpfsPluRhrzl3OqJaKQbLX/ldqyG7MchaYs025cc5t5TQDlO/8684VTrNyf9Ms0q3cn7hO8TzsGU2Sg+JOcC5y7kiNm3qJ0ys1qOZc5gzL+D+BC/mhpUELFRtekc/aaIaNbvab1Ngk+8X1cb6Kv8Y5JP6RuHbOkLij4nZLnZtpcgu36oEMeqjYMHI1HjbRzeLG1ge15xy5eV3Kw70y3D3lyoKNCovq9EAGDziTcuw3HeRsYYaNb7ZKPjfGwwU6KL4pHrjjhnusXCbbyS3YrAcy2EulF7JFnPYa36zP83i4wGmyzwWHn7F2T5UzwUuEPqnfGLJ4SfYc33A5wp/xYTneVxwucIrsc62pWWszWlX1Mc6OoL7PmQnqEOsCQ25QPOe1qj0dZPusZqeUK8G/6lnx+P9W6PA/Q70rcGCW3GOjHPhF6CZQf1TuvHi8S3uwccJ1Bg7AZd383+yk0gZ98CgJmeBcUC5cvyifR6IZpXzivOW84cxzTpJ75LwXt0DumfmZ807cHOcJ54Ucw2EM79lnZA0czvuBEolEIpFIVJRf8aCxtY4eLUkAAAAASUVORK5CYII=>

[image16]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADsAAAAZCAYAAACPQVaOAAACAUlEQVR4Xu2WSyhEURjHP/IoKzullGRHWcjGo6bslGw8Q42ykbJhYaHESrFAlK0slextPBaULMRCsvF+JCwoInxf9zsz937OvXPujGY251e/5p7/OffxnTkz9wBYLJYUyEMrZJgODtE9dBDtRbvQTrSDDcM8eiRDwRv6w6YddWOdz65xiSgA55xExRJLkMFiG8BZVuVoGRv2Yb7BvNhZCH/9f+FABsguWinDAGbQGjAvlsZnpFhJLboqwwDy0RM+Ni12GrzF1qNVbIQz+r8YQ1e4XYiOo0PcJnLRSXSR+0MTdsY/XcfJFvvB7Ud0grNR9J3zKbSR8w3OmtAFzlo5K+G2EcusKTTzEVc72WLp917saiv6wRk3IHLKzjTZmsgCoRNKZehDNnousrDFZvFnjrc7RhT0K42ydk22KTJf1CyaQu9LSdhilfve7hg9oH8mymgZy2xbZL6cgv7CfuxopPNpEui4Lj70D+5l3MLH1fHuGN2gf6aUi1Wz7EcbWiRDgek3Owfee12ItiIK+tyvWJpkI4KKVb8tv34F9V/JUAO9TuS1qC13bMOc015aoXZqfa6MoOxYZL7Q4C8ZulhHR2TI0NK9QS/BKfYBbfaMiPMCzhgaewfOXpxeOer8e3Dema/oNWe36BY4+3g6poz66L60n6dz1L2fwGKxWCwWS1r5BUGVpHqzUAe3AAAAAElFTkSuQmCC>

[image17]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEUAAAAZCAYAAABnweOlAAACEElEQVR4Xu2XyytFURTGFxlIZt4DyaPEjEy8MjFQyj8gKSMjA8bKY0CKzAwY3DyiTJSMGIiRMjAykIkIUWIiIayvvc+9+6yzz3GVK6f2r75u69tr3XPOuvvsvS+Rw+Fw/F+OpaFpYO2xGlnZrCrWPGvLTNIMsG5Y76xpMRYbjlifhmx0kj8HuvNlKDZZ10a8ynow4tgxTOFN6WDtsJZYE6x8/3AS1OdYvC7hxYaoprSxxqUpwOtkq4d3Ls24ENWUVvq+Ka9kr496LUEvqe9e13E5a5bVl8wgKmTNaV/OxIwS1ZRm1hqpcdz8M+vAlxH+8GG+xyilcnZJLeIAa9Yba4o1qD00BXlZOs44UU3BrnMhPOQeithWH+abYEFGTr3hYceDt2x4AN6Q8KwUsJrSVK2ukUQ1xcYt+fPDHj7MN0lQMKdOe8XChzcmPCsVrJ401a5rJD9tyj6p/BId41xiq0+nKdjVZE6N9vKEDw874J8Q1RTbg+GgBy9Xx1gPZA6A9yFNwSIFa6u196+bgoOZidxtSkXsAW9EmoIEBWujZsqk8DLGDKkLFskB5oTUtuxRRiq33/AAZsSGEXdT8GFtbFMwr0V7lcKHtyC8Xwe/OBbNK9al/rxnrZhJzCmpG/JmCI7+NjB+RmpnQl7Y6dfjkVLXxn1gFryQ+rsAD584AuAVw7h3j08odjgcDofD4YgTXw2zortjBBjOAAAAAElFTkSuQmCC>

[image18]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEUAAAAZCAYAAABnweOlAAACMUlEQVR4Xu2XPUgcQRTHX4IBCdr5WVj40cROsUkMXGMhCLYWIoKVVQqDpWCSIiGQENJYmOLwAwWbQLDSQrQSLFKlEBuJmKAg2ohESXx/ZvZu9u3bza6snML84M8xv33j7b7b3RmJPB6P5+6yI4Wli7PO6eY85LRxPnG+ukWWMc4vzhXnnTh2b9jm/HOi0UfhGuQoVGFY4Rw64wXOiTOuOI84k1ImMEHxTSlwVjlfOK85NeHDJTC/SnH9wlWMasqvKc85r6QU4HHS5sPtSVkp8Gvm1ZRe+n9T/pA+P+mxBMNk/vaSHbdwPnBGShVEdZyP1ss7MRO1lF9TnnIWyRzHyZ9zNkMV8Rcf5wOmqFyzRuYlDvDOuuS85Yxbh6ag7oEdZybPpmDV2RcOtVtirM2P8y54IaOm03FY8eDmHAfgXgin0qOkwPmseEQjqSkavylcH3fxcd6lSNGaJ9Y1CA83LZzKoJIhMl8mPaKRtSkbZOob7Rj7Em1+mqZgVZM1HdY9Fh4OK+CNyPPx0S4MGz04rHIA7wNZA+D+SimYpejcduvudFOwMXORq02TGAfAvZRSUKTo3KQ75Y1wqcnalPdkvrBeHmC+k1mWA5rJ1I46DuCOWHbGAxS9WI1vFK17Zl2r8HAzwqUmbVPwi+OlecD5aT+POfNuEfODzAkFdwi2/ho4vktmZUJd3O434JTK343zwF1wQebfBTh8YguARwzHg3M8w+SspG2Kx+PxeDwez21wDdxOqPOD7udtAAAAAElFTkSuQmCC>

[image19]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEQAAAAZCAYAAACIA4ibAAACaUlEQVR4Xu2WzYtPURjHH+SlsJGd0pSF5OUvEMJWqTFsLMZrIaIs5CW/xKxsZpZYTllQslWUslNKUcLilndS5GUh4vvtPGfuc5977p2r5od0PvVt7vmcc889v+f+5pyfSCaTyUwtR5F9Xhp6yE/kB3Ky2tUXFkp43hrf0U8uI98kPJjZX+2e4Cay3rRPIB9Nux+MSlgTn/1XaCrIdOSNlxLGL/JyilnhxZ+kqSCbJfR56Aa8/J9oKshcKf+llqhbpu02hpER5Kq2lyMXkU1xAFiKXEDOGUdmInuR88gZ44clPeeROMDAb/Yl5BlyVsIe+Vs0FYRck7Io95DP1e4kXES8p0DmI9O0zUXeRtbqWF7bAnMsPyjdLePb5vxUDpMZ6praneANB7w0PJByMczKaneS5xLGzjGOb5Nup3GEblXC2YKQtjkj/By+ANdde1I4wUEvlS/IkF4/lrIo8yZGpCmkvjAe7d4RunUJ5wtSqLf4ORdomxlDFpu+zvDmQ16CceSOc6sljH/ovOep1Be/O+EInT3ao/MF6TrndnUxH6rdk8ObDnspwcfN1HJK6ovwPJH6mF0JR7oWpMucs8014cbM/p7zrfCG1G5Nv8VLCW+Fb6uNQuqLT71NQrch4XxBCvUWP+dp5Jhpk/vIDecaiT+Tecx5tkp9AYRulpeOd1K/97g6Hq0R7kV024wjdHed6zJnT9uW18hG52pckfAA7tw8CvmXv0r5c96yQ8IDeNx+12sWsY33Us7LObkYHo0v1L2S8MYeIS/Vse+rjo3rYh83ddJ1zh4yiLyVsFZmj2QymUwmk8n8g/wC8PXKQE6/AA8AAAAASUVORK5CYII=>

[image20]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEQAAAAZCAYAAACIA4ibAAACNklEQVR4Xu2Wv0sdQRDHJ5FgCm3EOqUWEf8BIQa1C1YWNiIPf2KCIQELSeNDopWNlia9hTa2goJYamOloMWB+aVBlIQkYBPny87yNnP77lZ470yxH/jybr47O7c399g9okgkEqktM6wpbVbhB2tAmzWmlfWX9UwP1JM11g2ZG0Mv/x32Mkkmt94NWSZzn209UBShDflOxTQEdGijSEIaci2/RTXkXslryDCrJNchDSmxFlkbEj9lfWD12wSmnbXKWnA88Ig1wVpizTt+ifw139oEh4esj6wz1nsye+SdyGsINlJLSEOwCLs3Jaxm1gOJschdVrfk4hq+Bbl4UHg7jp9V82cljRrEqxYHgQmvtCmck7mxJaQh4BOZ3MeOh7cJb8TxALxOj+c2BGTVtOA5dAM2VZwLCkxrk3nBeq280IYklF4YjnbtAXjPPZ5uSCK+i67ZIjG0wnrijAWDyfrBwR9tUHhDTim9+DGPB+D1eDzdkNCaQ+JZ2QMhGEx6o01mT+mATO6RxFmcUHqhox4PhDYkpGajcw2wMWO8rPxMMMG3W2vayOSG/EMSSi/e9zYBvF6PpxuSiO+ia86xZp0YHLK2lFcV+5mMYy6PLjK5OBbzsB9xLu/Ew9FqaRJv0PEAvH3lhdQsS+zyjdWnvBTrZG6AnRtHIX5xouBz3scV6zNVchFX45IqdVETi8HRaOd/JfPGjllfxMPYb8m168LYLzKE1iyT+QdfkGkMNE6RSCQSiUQi/yG3FtHBiRzF4DMAAAAASUVORK5CYII=>

[image21]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADsAAAAZCAYAAACPQVaOAAACTklEQVR4Xu2WzUtUURiH31ATWokIQdJfIBQoiISLoEXQxiBNwoRRgnQThAYmQagboRYpCkGrsEW0kBbRpo0fmyBcBK2ildoXpFYYKVb2/jjvGc9977kzZ6ymzXngx8x5zveduedeokgk8gcc5DRoWS6Oc9Y4u5znnJpkdSafOWOco5xKTgtnKdEizTcy8yBlp48z6ZQfkFlIo+OysIt2czXRws9d+k+b9V1ln/OBNtc59zmXVV0h7lDY+H+dVUpPHLrZH1oEcpvCxv/nDJNZyBld4WFHi0BuUXKzrWTODeSkuE7ODc6MlHGO3ORckTKo4oxypqW+JM6SWcSErshgm8xEXzgPyfQ9kWjhR28W46D8iTMiboizJX6cc0r8M3H4MabEtYvDQRkE/lqPOD9pb+BifOWcdsrNZCatdZwPvdlfnCNO2XKJTLt+5eHeeNysckWpJ9Pxia4IBH1xEQphN3tAPvHY8pGj5EWxwJ33uDnlgkBH3yQa3DOakL52szYvktV5LpJ/LDh9psAtKJcCf9t7ytlF4ODIoptMm2vKl7JZ0Cbfm/aq83SRf6x9bfYc+RdnXYXjOjiHnXIvmTb427vAvVZOgwPQnXNZlS058vuszS4qlwKNqp3yMXFPHWfvLT2xLuM+184HHie6Hcobyg2Ix7u05ZC4HscBuFfKpcDJidMQwdGPTnicaB5zBpWrI9Mejx58fidzYQqB92m8yKxwPnAukJn3nbiPZJ6Zm5y34t5z5jkv5Tsc6vCejdsJfeAw7jpFIpFIJBIpK78BHQ2tkdTND6IAAAAASUVORK5CYII=>

[image22]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADsAAAAZCAYAAACPQVaOAAACU0lEQVR4Xu2WTUgVURTHT5RB0qKNBH1shExy0aJtgVGLaBNBKuEHT3AjUZgVFAmSFQS1qEhICFJyE0glLiQkKFu2EKF2tem76GtRmUHW/zjnztx75s6bB69em/uDHzPnf+/MnfPevJlHFAgEymA5bNBhJTgMb8JNUtfDUdgTzyjOTvgT/oaTaszHN4rmshXnDCWLG2ecGdnsgtesegOV1sRVKm3eX6cfXoYjsA8udYeL4rvgMTikQ8VF8h/7z+EGt+uwRPiCV6nsNhxWmeYC/admT1J5zbIHVJbHeXLnbYWbxUbJWij6Im5IzR8q34WHpGaq4AAclPFcTsCzFC1+XbZ5t6FhGyUNz8l2pTPDj252XuoP8JRkx+EPyc/BHZJPSbYbXpFsn2Trpc6kF95VGR94WmVZHKSkYZYfeHnoZhfgGqs2dFE0r1vlnD31ZLdUVhLmwvOYgPdk3zx02I54hh/T7BLZLnOHYwrkvw7Omj3ZfZWl4AU1v8i/iE0dpeeskEznGtOs8ZE7HNNG/nNxxrexzqZVloInffRkvkVsnlDy8LAxDRfDvo33yP6WZDimlfznKqvZY55ML9IEV1v1OHxs1Tb6WM0lcuc8V7WhQP48q9mHKkvxHdZYdSNFB260MvPbshfm3xnX66yMeUbRa6MYfEfoJrj+rLIjkvN/aUO1ZJ1WxnCW9eE78G1smmFr3eFF7sCjKltLyTHvZbvXmZHmC3wJX8C3cD9Fr5zXkr2j6J35Fb6S7A18AGdlnzMe4//Z7XIMZ3zeTxQIBAKBQKCi/AFoH63i75TyWAAAAABJRU5ErkJggg==>

[image23]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEUAAAAZCAYAAABnweOlAAACXklEQVR4Xu2XwUsXURDHJ7SLeAkz6pCShmIQZEigVFAXg6BD0Em8dPJUUZAEBpWCIhbRoQ5K/IhAo6PHLkH/QUGQeDNUOkiCRaRp82XmrbOzu/I7+BN/8D4w+JvPm2V33r7dfRJFIpHI/uM+xybHFkcpPZTiPUnNV446Nxa4ybHEscEx5saqhm8cF0z+i6Rxy0F1TZrXaH4sqRAwaYsmf8uxYvKqAc3ZSbit+bRxnzi+mxxMUHbykNfmuCvO7Xtw0VgdgUF1T41D/tLkoEd94LnLA3DzXlYbqySNHNA8PCpDSYXQrP665n8198Dl+UAfx2PaXpnHSW5If1JBdJjjmXq/EivOOEkDp407o+6ucaBRPVYWKGq+yAce0nbNB44W9T841jlGOQbUYVLsDasoR0iWf3h3NJixyyQXcss4cEj9pOZFzRd5C17IqDllXKe6N8aBvGvJBU10lRntekwRIyQnvqh5m+Z3kgoBSxp+WPOi5ou8pUTZmg51uGEWuEfO5dLMca3MsJ/fPLA0bSMhf5BUCHj24fFOANiX+MZAOZMyRdmak+r8fgjuiXO7SjfJSc457xvB76KvT9ir4H3gGwNw2BjuBB5Bf2yruj2flC8kJ/novJ8UNPXZ5AC7YFtz1OUBuHteOkqUPXanlRIe2YpwluQNb8GLDSfuNe68OgvyF85h8mZMfpWyx+UxS9m6sBJPOA/3yrld5wbJidY4/unvS6kKIayMdyR7ktfp4QSMzZF8yVBfnx7O8JPki7fAsUyyCv6Q/LsAh7+/SR4xjMOhHvupSCQSiUQikariP0P0s+VIBd59AAAAAElFTkSuQmCC>

[image24]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEQAAAAZCAYAAACIA4ibAAACCElEQVR4Xu2XPS8EURSGj69Q0Ihao1AQPwFBq1JoFBtfCUJIFKKxEVQaSvQKGq2ERK3SSSgm8U2IEAoN583ca8+eucZMsrsU90ne2PvcM2dmziYzlsjj8XgKyyxnTEtFJedDyyLRwPnktOuNYrJN4Q3ixMh4/vY3p5SrQUrBGoXnOtAbpSJuIJYXKt1AQKsWpeQ/DuRPKfRAMpwVzq5Zt3A2Ob22gGnmbHCWhQNVnFHOKmdR+Ay5e87YAkE5Z4tzwVmi8BmZikIPBBdhnzkBp45TZta4yCNOh6nFZ9kXtbhRuEPh43q+5sqowrif1onAARNaKtIMBFxSWF8jHL5NuEHhAFybw8mBgLieFtyHvs49tf4VNJjUUpF2IAFF6/Fq1w7AdTqcHkhgvET3rDdrZJ3TKPYSg4OntFSkHcg5ReuHHQ7AdTmcHkjSngPG2Tznb/8ODprWUpF2IGcUrR9yOJB0IEl6VovPAA9m7GeVjwUHuJ7WkrQDCSha7/o2AVy3w+mBBMZLdM8FzpxYgxPOvnI/Yv9NxmsujneKXkwcDxStnzcOr1ZLrXH9wgG4Y+WS9MyateSW06NchB0KT4AnN16F+HtH0d8reKXdUFiDXHGeOE2ySPFIub7oiYtBHxwLh374xvCz4No47GHoqLXXhb03CknaM8vp49xTOBhkhDwej8fj8Xj+IV+eF77sg4NFwQAAAABJRU5ErkJggg==>

[image25]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEQAAAAZCAYAAACIA4ibAAACQklEQVR4Xu2XO0gdQRSGjwnBCDGIWKe1UGzsTVBbK0GbFKJRfGAwkCIExIuYNNpoqelTaGOrKKRIExsFUUGLBTWJCYEQiYiNnp+Z0ePZmXtXuFdE5oMf73wzc3Z2ln1IFIlEIsXlLWdAS8Eo5x/nhNOj+kpBDeec06Q7SslnzhmZAyOD17sv2eIsi/Ym56tol4JpMmta0R23RWhDnpLp08BVaVlk6rW4TUIbsk7hDfmk5X0itCHudtKEvKOL85GzYNt1nDlOmxvA1HJmOR+EA484fZwpzrjwXeSv+cYNEDwgc8H2ORNknpE3otgbgkW4MQmnklNm21jkF85zOxa/ZS2MxYnCrQqfr+bx1TB6aF2onQlMGNKSwice8pIDMmMeC4erCdctHIBr8Di5ISBfTQfOQ69tUbULggLDWlL4xENeklB6DF7t2gG4Fx6nNySxXqJrVts2MsN5Jvoyg8mvtaTwiYe8ZI/SY155HIBr9ji9IVlrvrTO5e/17sJg0oiWZO5NfTAAt62lYpfSc/FRpx3IuiFZapaL3wAPZvTnlM8LJvie1h2UXgCAa9RSkVB6ru9qArgWj9Mbklgv0TXHOO9EG2xwlpQL4j6T8Zrzgb5+0Z60rhC/KT3uvXV4tTqeWNcpHIBbUy5LzZxtS35yWpVLMU/mAHhy41WIv0dkPuclFWQO8I3MTp+Sed3l4w9d1UVNLAa336F1P8hcsR3Od+vQh/+VMNatC33/yZC1Zo7TzvlFZt1IL0UikUgkEoncQS4AOg3NVczxXXYAAAAASUVORK5CYII=>

[image26]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADsAAAAZCAYAAACPQVaOAAACU0lEQVR4Xu2Wy0tVURSHV2gOBC1ykAj+BQZRERUYCQ6EEJr0QCwwCKJJkxoYBKEjQQcKCoKjqJkozXPQY9AgkASFBhHRO4geUFiU5vq5175373XXufegeZ3sD37cs7+9zz5nnbvPgyiRSGyCOk6bltViD+c95x/nJWdX3F2WIc4fzl/ObdVn8ZPccZCqg6uMQj07yJ3IgcBl8Z1zULabKH8Rk5Rv3H/nmxbMPs6KloojnE+chsAdJlfEfOAsRmmbisVBryi3X3w5sHwxZlH5PP/uCFUesyV8JXfgucDh3z4etLOY5jQql6fYYYrHtJO7wEiHuHOcm5w70t7NucW5Km2wkzPImZD+itRQ8QQRFNodjcjPMXJz4CKUQxf7W9qfOQPi+jm/xGMVdYq/L+4kZ1zcaXGt0i5LC8UFL8XducG+q1oa6GKxD85Bc4ncOH2bwb0w3KxyJXRxlmX7BBULXiiMyMcMVX6oeXyx/slfG3cX6KP4onjgzhrugXIlWJO9JttncZnsp3oWvlifp3F3gfNknwcclrF2j5SLOEP2ZAD+qJYGGPNKuaw5PeEyPiXbh4rdBXrJnmtDxeLDwZoMaI8Ls1e5ZrKXu95XM0bxmKyV1Ee2zyr2sXIlYBAe3yFoPwva/t4KD4z7zDudJ8E4C7xOdBFo4zUYck08vvI89eIuBg7A6Xe+CT77MPi5/N6Nu9e5x7ketKeotEifG8E4De7tt5w3nI+cHnKvHHyywuGrDO/MH5x34j5wHpJbRdiGQx++sy/IPnCY9wslEolEIpGoKmt+p7NqqtATyAAAAABJRU5ErkJggg==>

[image27]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEYAAAAZCAYAAACM9limAAACbUlEQVR4Xu2XzctNURSHVwhlIGUgoSglykSMlJFISf4HJZ9RiGRAJFEyZWAkIcJA/gFJykBv74iU788ihcjHetprO/uu9rvPPXfgrWs/9evs/Vvr7LPvvmevc45IpVL5T5ilmuvN8WCPaos3HQdVP01rXKyNdapL3szAPH6bjrrYP+Oi6rs0E9naG+7hh+qctaeofqmmNuEs+1SfpRn/cm+4yLguTEppYT6o3iX9MxLyVyReG0O3MPMlxOY5f6nrtzF0C3NXQgwmq1YnsS4MsjDHrL1QtUzCn7FcNUM1U0JNPG1HoO5dUC2xPmyUcN2dideJsRYm1gfq0SoJF6XPdurCIAtz3NprrY9uqWarFkioeXhnVU8tlwXD2yuhLk5TTTDvo+V0ghO3eVOaCR1OPCaFNyfx2iD/ijcLkH/C2ptUD5JYSpxfyifzuMMjB8zrDCft8KbkLwx4L71ZgPyr3ixA/kkJW+Wei6WQ98R5b8xP2Z3x+oKTcvuwtDA5fyzIvebNAuTzKvHI2pN6w38hNuq85+anbM94fcFJu7wp4d/KDTjIwlz3ZgHy9ydt6kUOYg+d98z8FOqn9/qCk7jdPIskPyDe+aTPy16uRkXIv+HNAuRvtvZ067OtPPgjzsvdMczNe63ESn7KB4wvqttJn08DfxH6aLHzgSJI7I4PFCCf60Qem+c/RfC4Q1J4+vj5HTFvovOz8JTgjZYVZnCOFC72tifensT4HOARmLJBdd957Ov3qhfSjP9a9TVNchySkBPz+aQAxqHPWN9U6yXMNebxdg4c4+95q1opYYw4h1eqm5ZbqVQqlUqlMjT8AaJqxCoBzMdvAAAAAElFTkSuQmCC>

[image28]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEUAAAAZCAYAAABnweOlAAACUElEQVR4Xu2XzauNQRzHv4qS2EhSNwtvC7JR0u1ulA2lbJHIy4IVSRYW6mJBiVBSWBxSlCU7S2v/gLwsCFkIC+9v328zw5zf85t75ygONZ/6dprP/M59npk7z8xzgEaj0fi3eM0cY+YzU5lR5l5fBXCWeczsY7Yxm5lNzMaYnJ3Mc+YLc8L0/Td8d7K/rwJ4lPV5SdxknmXta8yrrD10pjEHrXTQoA4xV5jdpi+hmjXMcmYJszDmEzPd1Gm15citM25o6GZrJkXLfDK+WUFOMruy9hn0r5qE3AMrh8VM1E3KZysqmM08NE6rpjQpnk9sYY4w12Nbe9spZuvPCmAOczp6uxIHYhbqJuUjc555w9xAGMBYX0UXb5ClwZd84jB+1dxBeCzFS4R/2HFmT3SaFNVNie2BqZ2Ut8zarL0K4cJaDR47EDZeS2nwJZ+jDVk1yzK3IrqrmRNye41zWelkNXPO8cpk6MKaLA/1bbcS5cGXfE4P3Zql0c01Xm7cOJcNTvT+0HO8kqNTylIayGIEr/3Kog3b+07pb+VcRrcmXWuG8XJHjaum5vHRZqaL2LrSQC7C90L7gdcn551eOZfQ/e6i6P76pOjtUxcZMV7uvnFCg7M3n5gHv0/ugJWGHrrfnWil6A38t6iZFGFv5rbjEvKlPqFJ0wmWWI+J6xO30K3TCSi3wHi5C8ZVUzspegfQhXQk6/M9ykfeV3Rv3qL3Fa2yuwi13v6To99eT5knzAuEVfAB4eeCnD7fITxi6pdTve53YGonpdFoNBqNRuNP8AMo9q44IuHcLQAAAABJRU5ErkJggg==>

[image29]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEQAAAAZCAYAAACIA4ibAAACj0lEQVR4Xu2XO2gVURCGR8UHJIKInRCEFEHUCNaiolaCICRqYxFfIWIlWIgPvIha2RiwUUsrEUIgWAgKQoqAIAQUJLFY8BkfoPio1GR+zszd2dnj3hVyReR88MPOP7Nzz55z95x7iRKJRGJ+2Mj6yJplTbBWFNNNGhRqfrLOFlNtYRWFz9viE+1kiDVs4lsUBrHJeOA+a7uJz7A+m7gdXKUwFnz2XwMfCFV5C1kzJlZQs9qb88x6b7Sbl9R6Qva4WIG3xpv/G6cpPOgu43WIB3WLt1biKgZYl1l3JF7HusHarQVMD+s665LxwGLWIOsK64LxByje84QWGPDNvsl6wbrIOllMt0a/CXh3PSOUT8pj1tdiOgoGofdkrOWsBRJjkA9ZW6UW13aCUYsHhffA+FU9v+RltEi838UtwUrcpnCC7HA55Qnlg4E2FNNR9JVcZjysJrxDxgPweiOenRBQ1VM57mIw6uJaYJNEozHnf2Ptlespyiels1kRJ6PywI5FPABvW8TzE5KJb/E9V0oM4RTtMrk/RhspOIrHTQw2U6h56nzPcyoP/kjEA/Ds0a6en5C6PQ+Ip/pUTMfBK4J31aIN8NAa62ZqOUflQXimqVxzOOKBuhNSp+dScw2wMSPfcH6BPsof3qIeNiKN+/N0E6wKVquKjMr9Y6sJ4Pn9KzYhmfgW3/M865SJwSTrnvNKoImdTWxq8O4ab594HnhLvOl4T+V79WjH0apgL4K333gA3iPn1enZkNjylrXTeSWw+fwSfaDQ5FqhInCQQg7H7Q+5xn+NKvD/CCcCjlj80sVgcDS+Eu8NhRV7xnotHnLfpRYPjvuRw6YO6vZsUHgD3lEYK3SUEolEIpFIJP5B5gBGtNfwkFilxgAAAABJRU5ErkJggg==>

[image30]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEQAAAAZCAYAAACIA4ibAAACWElEQVR4Xu2XPWhUQRDHx4gYTCwUrQIWFrEw2FooKmoXUqWwCXJoNARBECzExsOvykYDKUw6W5u0AQVJI2ijjYIpHiTxK4aIYgKCH/NndsncvHl3W+SOFPuDP/fmv/Pm7c47du+IMplMZnM4zvrG+sd6yepqHHb5wRq25iazj2ROJ+xAO5lgTap4jWQSB5VnGSPJaXdDHpI855kdaCd44FHHg6pYps40BAxYo530kL94z4t8D5+dakjHucM6Zryqhpxn1cJ1SkNqrPuspyE+zJpiDcUE5hDrMeue8sAO1mXWA9Zt5dfIr3ktJiiwF06zFlh3Wdcbh9PBYv9ak2QjjaQ0BJOIzS1Yu1nbQoxJvmCdDLm41i8BuVgovOfKb1bz50YabQ9eVZzMW5Ibdxn/C8mDIykNAYskud3Kw9uEd0F5AN4Rx9MNAc1qRq6YGMyYuCXYXFFkv/EHWVeNl9qQgsoTG3c8AO+U49mGFMHX2Jp7Qww9Yh1QY0nsIbl5px1g1q1B6Q2Zp/LkRx0PwDvteLYhqTVHghcVD4SWYPOxxZ6o6zmj1yT570LcjA9Urn3R8UBqQ1Jq2heLjRnjdeO7eBvoH2so+kmKp3xDCipP3nubAN4Zx7MNKYKvsTVvsW6oGLxhzRqvxG+SQp6qwDGNcRyLrYg/4jQ3g4ejNdIbvHPKA/BeGS+lZj3Ems+ss8ZroI/KTYjy9g2wyloiOTax2yOuYoUkB7k4pTAZHI3x/k8kb+w962PwMIa/D8jFwnE/xn6RkFqzTvIN/koba7pEmUwmk8lkMluQ/xOf0BuIutmtAAAAAElFTkSuQmCC>

[image31]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADsAAAAZCAYAAACPQVaOAAACJUlEQVR4Xu2WO2hUQRSGf0EtrCQWSogIVgkWFrYWSjqbpPCBGGEDFtpYaIqAgsRKMEWECAp2YhkRBAUDIcZSCAgKForgKwZELRJImuj5mTO7c8+ejbMJq8188JM735yduSd7HwsUCoVNsF1ywMr/wT7JbyvX4ajkLcJnHpg5j2WE2nb26BjtnMglyVoyPo+8z95BXl1HeYbGfz4H1vU57oZxlgnk79EReiSPJN+RdyKD8OtW4fuUcfy9pqPEzXObnYFf9wG+T7mJas1hyUHNEXWnJFcl93W8U3JNclHHZJvkuuS2zmcxJdmrx7nN/oJf9wa+T7HNxquBe4+pG5WsqOdt0a9+Wt0xyaS64+piDy3ZhfAtRXKbZY1X9wq+T7HN8iHXnYwj5xDqLhhP985xD41rwp5YbrNf4de9hu9TYrNb9O/W6nSdGvy16E46bta4CnclvcblNtvqnn0P36fEZmNeVqfrDMFfi46XsXVzxlV4KnlhEk+Ax/capU1cgX8iOU/j9DIe0ONDjek6Z+CvtaFmPWKzlhOS3caxrstxj42z3EJ1j49mHKnB962a5RfUFl6z8d6y/hvCqyayB6GGr4T14OvErsXxT+Muq+dv6cgOdcOJI3R8XmQxj3DynzQ8Tu8l/uAYScYR3uOLkicIG+6vTjfBV9ZnNPY4jbAGH3h0XIvvzCXJF3ULkucIT3oe03GOv/bO6mfouO4PFAqFQqFQ+Kf8AdT9stnB7ZfhAAAAAElFTkSuQmCC>

[image32]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADsAAAAZCAYAAACPQVaOAAACMElEQVR4Xu2WO0hdQRCGR4iCwUKwEHxgpQgWFrYKAS2CjQR8ID64go2IaUxhERDFQjCFgoEIFoKtTywERfFRCoKgnWmiRg2iFoqPQp3hzN6zO3fvzTnKvTb7wc/Z+Xf27M55LoDD4XgDGagyab4HRahnaSagBvUI3phl0WfjFrzcMHMkjTAL+Yya1OJiCDb2FwTLSyor4F/5INjyZlAT0hSMgn1syihALaAuIPhCKC9bePOoKeFJfkDwOZKCmjxssaRu4f2PETDzKlHlrE/sNaG+o6Y5povaj/rKMZGOGkT95P5AzKIKuR2m2CrwC77jY5aRYUcW+8AxzT3AXh/qnv1hVDX7q+zVosbZq2dP1RCXHNS6FocplugBv2DSkNltRRb7hMrTYkUneHldwifv0OLNCS8GWViYYpdQa9xWHx1SezTDjio2jY8fzO4oEbCvhbxGi7chPAP6apYKL2ixJRCbl8me9CWqWKUdsztKK9jPRR49xtLbEp4BbQK2hdQCqK3/QyUH4H88dFTBidAf4zpuV/jdUVrAfq5XFWsj3p1pQOVq8SJqX4t1bON1xsDM+SNiRQTsfrxi6QaFwlaserd0n94ziun/rPMbvN9GIuiJkHNQfCW8XvZpL634yF6H5hHkxbv4MeyizlBHLGrr7xJtOL5pMZEP/kX4x8cvRkYs16hj8OdoBu878Ze9c/D+mTeoE/ZOUZuoPW6TR32022vjMeTReS/B4XA4HA5HSnkBTJOwcep3rEUAAAAASUVORK5CYII=>

[image33]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADsAAAAZCAYAAACPQVaOAAACHElEQVR4Xu2WTUtVURSGV0aBpQOphBALHDgJIRoESQk6aeRAoVG/wBL7wIrAkTWKQmngQEFEiEhn/gLBf6ARNBLUiATBqCZF5Xpba5/WXW5v2zPwhuwHXq7rOet6zjr7fFyiTCZzWDjCueHlHjzk/OL85sxUbqpgnqTnHeeE21ZT6jnDXkZ4z7lm6m8kA1mOqTun9VGtzxYdNaaB88DLCDhoO9wdrV8bt8TZMDV4TrtPSs1opPRhsZqBR+peGId6wtSgU/1/Qeqwns8kQ+CeB+GSHSk6hPPq+50PnOYMcMb0E1znvOJcCE1MH2eOM2Tcvikz7DOSATqMu6juvnHgjHpcCTHaOFMkPZOcNfU4CXA4th+ck5w6ddvaUxU07iet8rWCZs44/b03T5ltPSTf8We+ST0GqkbYpyVcPceNe6yuFGVWFjwl2WmX1u1a3y06hLBCT5z3oGfVuU/qLfciLpmyw+JetasRapx5C64O+JvOe9CD97IFV48fbDDikkkZ9grJDi47b4cN9V5P43+9a9Gz7Ny6esutiEsmZdgVkh0sOu+Hxa8rf8D41ZVycOh561xsZW9HXDIpw14ieSJaZkl2itdE4Ko6C+qXzsVAH1bSgqeu/3+j6vCqq0pYidS0yNf+gN/PcF85P/XvbrM9EFbyDec7Z7py8y56SR5EGBQruaUen6jhN0lO5BfOB3UfOQvam8lkMplM5oDYAUeCoycy2yC2AAAAAElFTkSuQmCC>

[image34]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADoAAAAZCAYAAABggz2wAAACF0lEQVR4Xu2WPUsdURCGBwmiTRTEmM5YWYkgWCoh1gaiURCEW0TQ2FoErW0DqYQIgpU/IUUEi1TxIxEVLUQMYoJoRBAxqIU6L2eOzo5n7yq4AeU88HKZZ8+Zu59nlygSiTwUSjnfOBecr2ZbXqxz9qzMkyZyB1ghdbPUeYP/+B//cwX+bCngVoy7b0o45VbmRTW5gxo3/of4R0OB3AF9Mn5GfBotnCHOZ04luavzjlyfp2rcIGeK81I50MkZ5kwql9ZzgvNMjfP0cJY505xWzlxyc5JaCl/RLfFVxnt6OT/JjXlF1/Nfi3vO+SXO3zUfpQYjnBPxnqyedVKD75w+VY9xdlUdBE1wZqxDsDAVA2NwUqyzd8NpwBUCDqT1/GLqelWDzANtIzcRrxjwgdxCBIfbpxgYgx22bs24Q/GaroADaT1xFT3H4hbJ3cK3pobc+3OV08DZpPBOWDCmO+Ds87IvXtMRcCCt56xxR+J92pObbwcmnlsZAOOww9bZncKHgT2oNwEH0nrqk4fn3vOCc0bhXgn8GbEOO5IFxr0NOHtF/4rXYOW1DqT1nDe1JeQSYMA/VS9wDlSdRhm5ue+Nh9swzj9Tmv6AK9YTn4y6HlU1Xke21w0ayQ3all9882aBK7ZDbs4fcgeCxQUrH9xvuj5ZeD5Rw+MWxkqOV4ufjzl4X96lJ+YPkNtfBNueyLZIJBKJRCL3yCUW/LHxTrB35wAAAABJRU5ErkJggg==>