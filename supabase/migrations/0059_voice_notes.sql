-- Alo King Chouf: build plan 1.7 (session B3). Voice notes: Kapso's transcript first, a second provider behind a setting.
--   keep_audio: copy each processed note into the private `media` bucket (voice_notes/<party>/<sha256>.ogg) at once, fetched
--               through Kapso's media URL, never a raw Meta link. The hand-corrected evaluation (5.8) scores providers on them.
--   second_provider: the name of a second speech-to-text provider whose transcript is also taken and judged with Kapso's.
--               Null until the founder chooses (Kapso transcribes through ElevenLabs, which may keep transcripts; see
--               docs/HANDOFF.md). The worker passes a provider only when its key exists, so this setting alone sends nothing.
-- Both transcripts and what failed are written to wa_messages.transcript; the audio key to wa_messages.media_path.
-- 0001 seeded settings.stt with a plan ({"primary":"elevenlabs_scribe","secondary":"kapso",...}) no code read. Its keys stay
-- for reference; the two keys above are added beside them (an existing value of either is kept).
insert into settings(key, value) values ('stt', '{"keep_audio": true, "second_provider": null}')
on conflict (key) do update set value = excluded.value || settings.value;
