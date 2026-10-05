-- At most one drink add-on suggestion per basket (flow spec item 2).
alter table public.baskets add column if not exists addon_offered_at timestamptz;
