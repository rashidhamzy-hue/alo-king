#!/usr/bin/env bash
# Downloads the places sources (DECISIONS §16) into $1. Runs in GitHub Actions: cloud sessions cannot
# reach these hosts. Sources: OCHA/HDX COD-AB Lebanon (boundaries and P-codes), CAS cadastral names
# (optional), OpenStreetMap place nodes (Overpass), Copernicus GLO-30 terrain model (AWS open data).
set -euo pipefail
WORK="${1:?usage: fetch.sh <work dir>}"
mkdir -p "$WORK"
cd "$WORK"
UA="alo-king-places-build/1.0 (github.com/rashidhamzy-hue/alo-king)"

pick() { # $1 = CKAN package id, $2 = jq filter for one resource url
  curl -fsSL -A "$UA" "https://data.humdata.org/api/3/action/package_show?id=$1" | jq -r "$2" | head -1
}

# 1. COD-AB: prefer shapefile zip, then GeoJSON, then geodatabase or GeoPackage.
url=$(pick cod-ab-lbn '[.result.resources[] | select((.format // "" | ascii_downcase) | test("shp|shapefile"))][0].url // empty')
[ -n "$url" ] || url=$(pick cod-ab-lbn '[.result.resources[] | select((.format // "" | ascii_downcase) | test("geojson"))][0].url // empty')
[ -n "$url" ] || url=$(pick cod-ab-lbn '[.result.resources[] | select((.format // "" | ascii_downcase) | test("gdb|geodatabase|gpkg|geopackage"))][0].url // empty')
[ -n "$url" ] || { echo "no COD-AB resource found"; exit 1; }
echo "COD-AB: $url" | tee sources.txt
curl -fsSL -A "$UA" -o codab.download "$url"
mkdir -p codab
if unzip -tq codab.download >/dev/null 2>&1; then unzip -oq codab.download -d codab; else cp codab.download "codab/$(basename "${url%%\?*}")"; fi
# Nested zips (one per format or level).
find codab -name '*.zip' -print0 | while IFS= read -r -d '' z; do unzip -oq "$z" -d "${z%.zip}"; done

# 2. CAS cadastral names (optional: Arabic names when COD-AB lacks them).
cas=$(pick lebanon-cadastral-name-and-pcodes '[.result.resources[] | select((.format // "" | ascii_downcase) | test("csv|xlsx"))][0].url // empty' 2>/dev/null || true)
if [ -n "$cas" ]; then
  echo "CAS: $cas" | tee -a sources.txt
  curl -fsSL -A "$UA" -o "cas.${cas##*.}" "$cas" || echo "CAS download failed; continuing without it"
fi

# 3. OpenStreetMap place nodes in Lebanon (ODbL).
query='[out:json][timeout:300];area["ISO3166-1"="LB"][admin_level=2]->.lb;node["place"~"^(city|town|village|hamlet|suburb|quarter|neighbourhood|locality|isolated_dwelling)$"](area.lb);out body;'
ok=""
for ep in https://overpass-api.de/api/interpreter https://overpass.kumi.systems/api/interpreter https://overpass.private.coffee/api/interpreter; do
  if curl -fsSL -A "$UA" --max-time 360 --data-urlencode "data=$query" -o osm.json "$ep" && jq -e '.elements | length > 500' osm.json >/dev/null; then
    echo "OSM: $ep ($(jq '.elements | length' osm.json) nodes, $(date -u +%FT%TZ))" | tee -a sources.txt
    ok=1
    break
  fi
  sleep 10
done
[ -n "$ok" ] || { echo "Overpass failed on every endpoint"; exit 1; }
jq -r '["osm_id","lat","lon","place","name","name_ar","name_en","name_fr","int_name","alt_name","old_name","loc_name","official_name","population"],
  (.elements[] | [.id, .lat, .lon, .tags.place, .tags.name, .tags["name:ar"], .tags["name:en"], .tags["name:fr"], .tags.int_name,
   .tags.alt_name, .tags.old_name, .tags.loc_name, .tags.official_name, .tags.population]) | @csv' osm.json > osm.csv

# 4. Terrain model: Copernicus GLO-30 (1 arc-second) tiles covering Lebanon.
mkdir -p dem
for t in N33_00_E035_00 N33_00_E036_00 N34_00_E035_00 N34_00_E036_00; do
  name="Copernicus_DSM_COG_10_${t}_DEM"
  curl -fsSL -o "dem/$name.tif" "https://copernicus-dem-30m.s3.amazonaws.com/$name/$name.tif"
done
echo "DEM: Copernicus GLO-30 (copernicus-dem-30m on AWS open data)" | tee -a sources.txt
