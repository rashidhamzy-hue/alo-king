# Seed data

- `places/`: the all-Lebanon places list (DECISIONS §16), built by `.github/workflows/places-build.yml`
  (`scripts/places/`) from OCHA/HDX COD-AB boundaries and P-codes, CAS cadastral names, OpenStreetMap place
  nodes (© OpenStreetMap contributors, ODbL: attribution in the site footer) and the Copernicus GLO-30 terrain
  model. `report.md` lists the totals, the review-set matches and the zones without a place.
  Loaded into staging after each deploy by `scripts/load-seed.sh` (skipped when unchanged). A load never
  deletes a place and never changes its service status.
