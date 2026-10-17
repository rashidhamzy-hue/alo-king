-- Session 5f part 8b (CUSTOMER-EXPERIENCE §3.7 #45): the outbox purpose for a customer's message passed to the shop as
-- an order note during an active order. Its own file: a new enum value cannot be used in the transaction that adds it.
alter type public.outbox_purpose add value if not exists 'customer_note';
