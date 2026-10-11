# Voice-note eval set (DECISIONS §30.7)

Real WhatsApp voice notes of food orders from the Shouf, collected by Rasheed. Test fixtures only: never sent to customers, never used for marketing, never shown outside this private repo.

- `batch-01/`: 37 notes (19.4 min, 6–102 s, average 31 s), recorded 7–9 October 2026. `manifest.csv` lists file, recording time and duration.
- Next batches go in `batch-02/` and later, with the same layout.

Labels (`labels.csv`, one row per note: draft transcript, language mix, expected merchant or cuisine, expected items and quantities, place mentioned, `needs_review`) are produced by the session 4 pipeline: two transcription models plus Claude reconciliation. Only `needs_review` rows go to Rasheed to confirm by listening.

If a speaker asks for their note to be removed, delete the file and its label row in a PR.
