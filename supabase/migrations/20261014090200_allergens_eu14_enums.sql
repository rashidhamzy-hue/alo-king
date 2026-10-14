-- Session D (DECISIONS §38.2 item 6): the allergen list completes the EU-14 with lupin and molluscs (crustaceans are
-- `shellfish`, milk is `dairy`, tree nuts are `nuts`). New enum values need their own migration before use.
alter type public.allergen add value if not exists 'lupin';
alter type public.allergen add value if not exists 'molluscs';
