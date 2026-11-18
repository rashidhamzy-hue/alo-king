# WH1a screenshots (18 November 2026)

The warehouse pages at 390 px, English and Arabic, light, with invented data, made by
`SCREENS=docs/screens/wh1a npx vitest run test/screens/wh1a.test.ts` (Playwright's Chromium). The run fails on a sideways scroll at 390 px or a phone control under 44 px.

| File | Page | Who |
|---|---|---|
| `wh1a-purchase-orders-390-{en,ar}.png` | Purchase orders: the open list | ops lead |
| `wh1a-purchase-order-new-390-{en,ar}.png` | Purchase orders with "New purchase order" opened | ops lead |
| `wh1a-receiving-390-{en,ar}.png` | An open order: count each line, lot, expiry, damaged, the invoice number | picker |
| `wh1a-received-390-{en,ar}.png` | A received order: what came, short, damaged, the label day's list | ops lead |
| `wh1a-print-en-390.png`, `wh1a-print-ar-390.png` | The printed order in English and in Arabic (the language is the print's own) | ops lead |
| `wh1a-bins-390-{en,ar}.png` | Bins by zone in walk order, place an item, items with no bin per zone | ops lead |
| `wh1a-suppliers-390-{en,ar}.png` | Receiving: the door to purchase orders, the last receipts, suppliers and what we owe, pay from the drawer, add a supplier | ops lead |
| `wh1a-temperature-390-{en,ar}.png` | Temperature log: today's two readings, take a reading, today's readings (one out of range), the last 14 days | picker |
| `wh1a-stock-390-{en,ar}.png` | Stock: use within 2 days by lot, with the write-off | ops lead |
| `wh1a-runner-390-{en,ar}.png` | The picker's runner: each line's bin and the lot to take, or "check the date on the pack" | picker |
