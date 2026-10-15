-- Session 5c (DECISIONS §39.7): the merchant copilot's changes confirm through the existing proposal tap (§18.2). Its own
-- file because a new enum value cannot be used in the transaction that adds it.
alter type public.proposal_kind add value if not exists 'availability_off';
alter type public.proposal_kind add value if not exists 'availability_on';
alter type public.proposal_kind add value if not exists 'stock_set';
alter type public.proposal_kind add value if not exists 'item_add';
alter type public.proposal_kind add value if not exists 'item_edit';
alter type public.proposal_kind add value if not exists 'item_remove';
alter type public.proposal_kind add value if not exists 'offer_create';
alter type public.proposal_kind add value if not exists 'offer_stop';
alter type public.proposal_kind add value if not exists 'hours_set';
alter type public.proposal_kind add value if not exists 'closure';
alter type public.proposal_kind add value if not exists 'min_order';
alter type public.proposal_kind add value if not exists 'radius';
alter type public.proposal_kind add value if not exists 'boost_start';
alter type public.proposal_kind add value if not exists 'boost_stop';
