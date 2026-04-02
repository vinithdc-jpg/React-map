"use client";

import { useEffect, useMemo } from "react";
import L from "leaflet";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  ZoomControl,
  useMap,
} from "react-leaflet";

import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

function FlyTo({ center, zoom, flyToKey }) {
  const map = useMap();

  useEffect(() => {
    if (!center) return;
    const [lat, lng] = center;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    // Helps when the map is mounted in a newly sized container
    map.invalidateSize({ pan: false });
    map.flyTo(center, zoom ?? map.getZoom(), {
      animate: true,
      duration: 0.9,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyToKey]);

  return null;
}

function InvalidateOnResize() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer?.();
    if (!container) return;

    map.invalidateSize({ pan: false });

    const ro = new ResizeObserver(() => {
      map.invalidateSize({ pan: false });
    });
    ro.observe(container);

    return () => ro.disconnect();
  }, [map]);

  return null;
}

export default function Map({
  center,
  zoom = 13,
  markers = [],
  selectedMarkerId,
  route = null, // { coords: [[lat,lng]...], fromId, toId }
  tileTheme = "dark", // "dark" | "light"
  flyToKey,
}) {
  useEffect(() => {
    // Fix missing marker icons in bundlers (Next/Webpack)
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: markerIcon2x.src ?? markerIcon2x,
      iconUrl: markerIcon.src ?? markerIcon,
      shadowUrl: markerShadow.src ?? markerShadow,
    });
  }, []);

  const tileUrl = useMemo(() => {
    if (tileTheme === "light") {
      return "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
    }
    // Free dark tiles (Carto). Attribution required.
    return "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
  }, [tileTheme]);

  const attribution = useMemo(() => {
    if (tileTheme === "light") return "&copy; OpenStreetMap contributors";
    return '&copy; OpenStreetMap contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
  }, [tileTheme]);

  return (
    <MapContainer
      center={center}
      zoom={zoom}
      zoomControl={false}
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        attribution={attribution}
        url={tileUrl}
      />

      <ZoomControl position="bottomright" />

      <InvalidateOnResize />
      <FlyTo center={center} zoom={zoom} flyToKey={flyToKey} />

      {route?.coords?.length ? (
        <Polyline
          positions={route.coords}
          pathOptions={{
            color: "#a855f7",
            weight: 5,
            opacity: 0.9,
          }}
        />
      ) : null}

      {markers.map((m) => {
        const isSelected = selectedMarkerId && m.id === selectedMarkerId;
        return (
          <Marker key={m.id} position={[m.lat, m.lon]}>
            <Popup>
              <div className="min-w-[220px]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold tracking-tight">
                      {m.title ?? "Location"}
                    </div>
                    {m.subtitle ? (
                      <div className="mt-0.5 text-xs opacity-80">
                        {m.subtitle}
                      </div>
                    ) : null}
                  </div>
                  {isSelected ? (
                    <span className="rounded-full bg-purple-500/20 px-2 py-0.5 text-[11px] font-medium text-purple-200">
                      Selected
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 text-xs opacity-90">
                  <div>
                    <span className="opacity-70">Lat</span>{" "}
                    {Number(m.lat).toFixed(5)}
                  </div>
                  <div>
                    <span className="opacity-70">Lng</span>{" "}
                    {Number(m.lon).toFixed(5)}
                  </div>
                </div>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}