-- Session 5g part 0c (DECISIONS §39.15.6): fewer round trips on the slow paths. Contents:
--   1. public.basket_checkout_view: the checkout's address state, quote, substitution question and cash state in one call,
--      in the order the bot asks them and stopping where the bot would stop, so a summary takes one call instead of four.
--      Each step is the existing function, unchanged; the bot falls back to them one by one when this answers nothing.

-- ---- 1. The checkout in one call ----------------------------------------------------------------------------------------
create function public.basket_checkout_view(p_customer_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_address jsonb;
  v_quote jsonb;
  v_sub jsonb;
begin
  -- The address comes first: a confirmation, "for whom" or a recipient question stops the checkout there (§22.1, §39.6).
  -- It may mark the basket a gift, which the quote reads (an allergy note never goes on a gift), so it runs first.
  v_address := public.basket_address_state(p_customer_id);
  if coalesce(v_address ->> 'status', '') <> 'ok' then
    return jsonb_build_object('address', v_address);
  end if;
  v_quote := public.basket_quote(p_customer_id);
  -- Anything but a quote ready for the summary (no route yet, below the minimum, an empty to answer) stops here.
  if coalesce(v_quote ->> 'status', '') <> 'ok'
     or exists (select 1 from jsonb_array_elements(coalesce(v_quote -> 'basket' -> 'lines', '[]')) l
                where coalesce((l ->> 'needs_empty_answer')::boolean, false)) then
    return jsonb_build_object('address', v_address, 'quote', v_quote);
  end if;
  v_sub := public.basket_substitution_needed(p_customer_id);
  if coalesce((v_sub ->> 'needed')::boolean, false) then
    return jsonb_build_object('address', v_address, 'quote', v_quote, 'substitution', v_sub);
  end if;
  return jsonb_build_object('address', v_address, 'quote', v_quote, 'substitution', v_sub,
    'cash', public.basket_cash_state(p_customer_id));
end;
$$;
revoke all on function public.basket_checkout_view(uuid) from public, anon, authenticated;
grant execute on function public.basket_checkout_view(uuid) to service_role;
comment on function public.basket_checkout_view(uuid) is
  'The checkout''s address state, quote, substitution question and cash state in one call (session 5g part 0c, §39.15.6).';
