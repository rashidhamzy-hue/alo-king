<!-- Moved from docs/HANDOFF.md, "Status", on 18 November 2026 by session DOC2. The text below is unchanged; links to images under docs/screens/ no longer resolve (the images are in the private screens bucket; the console's Screens page lists them). -->

### Where the build stands (14 November 2026, after H1)
- **On `main`:** Phase 0 (A1), ordering B1 to B4, hub C1 to C4, console D1 to D4, infra A2, A4, A5 and A6, pictures P1 and P2, product data N1, catalog K1, audit S1, reply speed SP1, G1 fixes F1, research R1 to R4, delivery windows W1, intake I1 and the commerce core C4 (pull requests 1 to 57). Per-session records: `docs/history/HANDOFF_sessions_2026-11-13_14.md`.
- **Open pull requests at the time of writing:** M1 (message design, #54: built and tested; the coordinator's merge condition of 15 Nov met by language-pack run 43677251482, see "Session M1" below) and the A5 follow-up (#51, the section "A5: infra, live results" below). WEB1 merges beside it.
- **Wave order** is in `docs/BUILD_PLAN.md` ("Waves"): waves 1 and 2 are done, H1 is this hygiene pass, wave 3 is M1, I1 (merged) and C4 (merged).
- **Tests:** `npx tsc --noEmit` clean; `npx vitest run` 1,202 passed and 43 live-only skipped on 14 November (local, before H1's last edits; CI runs the suite on every pull request). `TEST_REPORT.txt` is gone: CI is the record.
- **Everything live is staging only.** Nothing has run with real customers, real money or the two +961 numbers.
