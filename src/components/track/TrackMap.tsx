import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MAPBOX_TOKEN } from "@/lib/config";

type LL = [number, number];

const pin = (cls: string, label: string) =>
  L.divIcon({
    className: "",
    html: `<div class="ak-pin ${cls}">${label}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
const vendorIcon = pin("ak-pin-vendor", "R");
const destIcon = pin("ak-pin-dest", "★");
const driverIcon = pin("ak-pin-driver", "▲");

function FitBounds({ points }: { points: LL[] }) {
  const map = useMap();
  const key = points.map((p) => p.join(",")).join("|");
  const done = useRef("");
  useEffect(() => {
    if (!points.length || done.current === key) return;
    done.current = key;
    if (points.length === 1) map.setView(points[0]!, 15);
    else map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
  }, [key, map, points]);
  return null;
}

function GlidingDriver({ to }: { to: LL }) {
  const [pos, setPos] = useState<LL>(to);
  const from = useRef<LL>(to);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 1800);
      const e = k * (2 - k);
      const p: LL = [a[0] + (to[0] - a[0]) * e, a[1] + (to[1] - a[1]) * e];
      setPos(p);
      from.current = p;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to[0], to[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Marker position={pos} icon={driverIcon} />;
}

async function fetchRoute(a: LL, b: LL): Promise<LL[]> {
  const coords = `${a[1]},${a[0]};${b[1]},${b[0]}`;
  const url = MAPBOX_TOKEN
    ? `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`
    : `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("route");
  const j = (await res.json()) as { routes?: { geometry: { coordinates: [number, number][] } }[] };
  const c = j.routes?.[0]?.geometry.coordinates;
  if (!c?.length) throw new Error("route");
  return c.map(([lng, lat]) => [lat, lng]);
}

export default function TrackMap({
  vendor,
  dest,
  driver,
}: {
  vendor: LL | null;
  dest: LL | null;
  driver: LL | null;
}) {
  const [route, setRoute] = useState<{ pts: LL[]; fallback: boolean } | null>(null);
  const vKey = vendor?.join(",");
  const dKey = dest?.join(",");
  useEffect(() => {
    if (!vendor || !dest) return setRoute(null);
    let alive = true;
    fetchRoute(vendor, dest)
      .then((pts) => alive && setRoute({ pts, fallback: false }))
      .catch(() => alive && setRoute({ pts: [vendor, dest], fallback: true }));
    return () => {
      alive = false;
    };
  }, [vKey, dKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const points = [vendor, dest, driver].filter(Boolean) as LL[];
  const center = points[0] ?? [33.68, 35.58];

  return (
    <MapContainer center={center} zoom={13} className="h-full w-full" scrollWheelZoom={false}>
      {MAPBOX_TOKEN ? (
        <TileLayer
          url={`https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/{z}/{x}/{y}?access_token=${MAPBOX_TOKEN}`}
          tileSize={512}
          zoomOffset={-1}
          attribution='© <a href="https://www.mapbox.com/">Mapbox</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
      ) : (
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
      )}
      {route && (
        <Polyline
          positions={route.pts}
          pathOptions={{
            color: "#f59e0b",
            weight: 4,
            opacity: 0.85,
            dashArray: route.fallback ? "8 10" : undefined,
          }}
        />
      )}
      {vendor && <Marker position={vendor} icon={vendorIcon} />}
      {dest && <Marker position={dest} icon={destIcon} />}
      {driver && <GlidingDriver to={driver} />}
      <FitBounds points={points} />
    </MapContainer>
  );
}
