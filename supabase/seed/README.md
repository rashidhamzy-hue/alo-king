# Seed data

- `places/`: the all-Lebanon places list (DECISIONS §16), built by `.github/workflows/places-build.yml`
  (`scripts/places/`) from OCHA/HDX COD-AB boundaries and P-codes, CAS cadastral names, OpenStreetMap place
  nodes (© OpenStreetMap contributors, ODbL: attribution in the site footer) and the Copernicus GLO-30 terrain
  model. `report.md` lists the totals, the review-set matches and the zones without a place.
  Loaded into staging after each deploy by `scripts/load-seed.sh` (skipped when unchanged). A load never
  deletes a place and never changes its service status.
- `places/shouf_delivery_boundary.csv`, `shouf_delivery_denylist.csv`: the delivery area (DECISIONS §39.2), loaded as a
  dated `pilot_place_ids` row. `shouf_delivery_road_km.csv`: the road distance from the nearest pilot merchant to each
  boundary place, from `.github/workflows/area-data.yml` (`scripts/shouf/area.mjs`): OpenRouteService
  (`provider = ors`) or the public OSRM server (`provider = osrm`); both route on OpenStreetMap data
  (© OpenStreetMap contributors, ODbL). A place between the named villages that is beyond `max_delivery_km()` by road
  is not delivered to; the shop villages and the villages Rasheed named always are.
- `shouf/osm/`: OpenStreetMap landmarks and place names for the boundary places (© OpenStreetMap contributors, ODbL),
  from the same workflow. `shouf/harvest/`: menus read from the merchants' public menu pages by
  `.github/workflows/menu-harvest.yml` (§39.4), seed drafts the merchant confirms; the raw pages are never committed.
