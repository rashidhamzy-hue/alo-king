---
name: alo-merchant-notifications
description: Use when implementing or reviewing merchant order alerts, the order_channel router, WhatsApp order cards, the portal queue, automated calls, kitchen printers, POS or Deliverect channels, acceptance timers, escalation, or merchant reliability in Alo King.
---

# Alo King merchant notifications

DECISIONS §13 and §23 decide. Old reference: `docs/legacy/vendor-orders.md`.

## One router, many channels
Every order goes through the `order_channel` interface (deliver, acknowledge, cancel, status, menu and availability sync), one implementation per channel: merchant portal (default), WhatsApp on the Merchant number, automated Twilio voice call (Arabic; 1 accept, 2 reject, 3 repeat), cloud kitchen printer (Star CloudPRNT, Epson Server Direct Print), Deliverect, direct POS adapters, concierge relay (after pilot), email (copy only, never primary).

An order is **received** only when its channel acknowledges it: POS acknowledgement with the POS order ID, printer job confirmed printed, a button tap, a call keypress, or the portal opened on the order. Sending alone never counts.

## Escalation (every channel)
- T+0: primary channel plus portal alarm.
- T+15 s without acknowledgement: the backup channel fires.
- T+45 s: automated cellular phone call to the owner mobile (works when the kitchen's internet is down).
- T+75-90 s: an operator steps in (phones the restaurant).
- Target: merchant acceptance within 90 seconds. Every timer re-reads the order state before acting.
- Integration down: automatic fallback to the backup channel with an incident; after 3 failures in an hour the merchant uses backup for the day.

## Order card (WhatsApp)
Short order code, items and quantities, customer note, broad area and nearest landmark, payment type and amount in USD and LBP, Accept / Reject / prep-time buttons. No customer phone beyond what delivery needs, no platform margin, no internal flags. Reject needs a typed reason (busy, item unavailable, closed, area unavailable, menu or price issue, other).

## Accept and reject
Verify the actor's membership and role; transition atomically from the expected state; duplicate taps are safe; store actor and time; notify the customer; record an audit event. Cancel racing with accept and two staff racing each other are tested.

## POS rules
POS price used only after the merchant approves the mapping once; afterwards a difference above 5% holds the item until the merchant confirms. Availability pulled from the POS hides items within 5 minutes; an order already placed gets a substitution offer.

## Reliability numbers (pilot and ads gates, §1)
Merchant notification delivery above 99%; zero orders accepted while a merchant was closed or paused; zero unresolved money mismatches; rejections under 5% excluding customer errors. All acceptance, rejection, prep, timeout and cancellation times are measured.

## Tests
Outbox written with the order; retry without duplicate sends; acknowledgement per channel; backup at 15 s; call at 45 s; operator at 75-90 s; accept vs cancel race; unauthorized merchant; pause blocks checkout; POS down fallback; audit trail.
