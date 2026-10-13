import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Lebanon, and the zoom that shows all of it.
const CENTER: L.LatLngTuple = [33.85, 35.86];

/**
 * A map to put one pin on (registration, DECISIONS §24.3). Loaded only when the visitor asks for the map, so the form's
 * first load carries none of it. Tiles come from OpenStreetMap (the attribution is shown).
 */
export default function PinMap({
  lat,
  lon,
  onPick,
  label,
}: {
  lat: number | null;
  lon: number | null;
  onPick: (lat: number, lon: number) => void;
  label: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const dot = useRef<L.CircleMarker | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { center: CENTER, zoom: lat != null ? 15 : 8, zoomControl: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) =>
      pick.current(+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)),
    );
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      dot.current = null;
    };
    // The map is built once; the pin below follows the props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || lat == null || lon == null) return;
    if (!dot.current)
      dot.current = L.circleMarker([lat, lon], {
        radius: 11,
        color: "#17131a",
        weight: 3,
        fillColor: "#f4b63c",
        fillOpacity: 1,
      }).addTo(m);
    else dot.current.setLatLng([lat, lon]);
    if (!m.getBounds().contains([lat, lon]) || m.getZoom() < 13)
      m.setView([lat, lon], Math.max(m.getZoom(), 15));
  }, [lat, lon]);

  return <div ref={el} className="ak-map" role="application" aria-label={label} />;
}
