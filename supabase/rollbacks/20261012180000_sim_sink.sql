-- Rolls back 20261012180000_sim_sink.sql (staging simulator sink). Only simulator data is lost.
-- customer_handoff is restored to its 20261012090000 definition by re-running that function body.
drop function if exists public.sim_restore();
drop function if exists public.sim_prepare(text);
drop function if exists public.sim_sink_record(text, jsonb);
drop table if exists app_private.sim_state;
drop table if exists public.sim_outbox;
drop function if exists app_private.sim_sink_on();
drop function if exists app_private.is_sim_phone(text);
-- app_config rows are dated and never deleted: a newer row `sim_sink_enabled = false` switches the sink off.
