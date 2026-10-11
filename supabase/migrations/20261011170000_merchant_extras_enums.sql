-- Session 5 (DECISIONS §32.5): the merchant WhatsApp extras confirm through the existing proposal tap
-- (§18.2). Its own file because a new enum value cannot be used in the transaction that adds it.
alter type public.proposal_kind add value if not exists 'power_off';
alter type public.proposal_kind add value if not exists 'power_on';
alter type public.proposal_kind add value if not exists 'needs_power';
alter type public.proposal_kind add value if not exists 'capacity';
alter type public.proposal_kind add value if not exists 'staff_add';
alter type public.proposal_kind add value if not exists 'staff_remove';
alter type public.proposal_kind add value if not exists 'same_price';
