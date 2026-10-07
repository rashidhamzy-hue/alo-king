import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const icon = L.divIcon({
  className: "",
  html: `<div class="ak-pin ak-pin-vendor">★</div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], map.getZoom());
  }, [lat, lng, map]);
  return null;
}

function ClickToMove({ onMove }: { onMove: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onMove(e.latlng.lat, e.latlng.lng) });
  return null;
}

export default function VendorMap({
  lat,
  lng,
  draggable,
  onMove,
}: {
  lat: number;
  lng: number;
  draggable?: boolean;
  onMove?: (lat: number, lng: number) => void;
}) {
  const handlers = useMemo(
    () => ({
      dragend: (e: L.LeafletEvent) => {
        const p = (e.target as L.Marker).getLatLng();
        onMove?.(p.lat, p.lng);
      },
    }),
    [onMove],
  );
  return (
    <MapContainer center={[lat, lng]} zoom={15} scrollWheelZoom={false} className="h-full w-full">
      <TileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Marker position={[lat, lng]} icon={icon} draggable={draggable} eventHandlers={handlers} />
      <Recenter lat={lat} lng={lng} />
      {draggable && onMove && <ClickToMove onMove={onMove} />}
    </MapContainer>
  );
}
