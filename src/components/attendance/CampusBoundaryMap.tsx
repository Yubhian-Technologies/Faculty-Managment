"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import { checkCampusGeofence, type CampusLocation } from "@/lib/attendance/geofence";

interface CampusBoundaryMapProps {
  campusLocation: CampusLocation;
  userLocation: { latitude: number; longitude: number };
  className?: string;
}

// Read-only: shows the configured geofence (circle or polygon) plus the
// faculty/HOD's own live position, color-coded green (inside) or red
// (outside) - so they know before starting face verification, not after
// wasting a minute on it only to get rejected at the last step.
export function CampusBoundaryMap({ campusLocation, userLocation, className }: CampusBoundaryMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let disposed = false;

    void (async () => {
      const L = (await import("leaflet")).default;
      if (disposed || !containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current, { zoomControl: false, attributionControl: false });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);

      const boundaryLayer = campusLocation.shape === "polygon"
        ? L.polygon(campusLocation.points.map((p) => [p.latitude, p.longitude] as [number, number]), { color: "#2563eb", fillOpacity: 0.15 })
        : L.circle([campusLocation.latitude, campusLocation.longitude], { radius: campusLocation.radiusMeters, color: "#2563eb", fillOpacity: 0.15 });
      boundaryLayer.addTo(map);

      const { withinBounds } = checkCampusGeofence(userLocation.latitude, userLocation.longitude, campusLocation);
      const userMarker = L.circleMarker([userLocation.latitude, userLocation.longitude], {
        radius: 8, color: withinBounds ? "#16a34a" : "#dc2626", fillColor: withinBounds ? "#22c55e" : "#ef4444", fillOpacity: 1, weight: 2,
      }).addTo(map);

      const bounds = L.featureGroup([boundaryLayer, userMarker]).getBounds();
      map.fitBounds(bounds, { padding: [24, 24] });

      mapRef.current = map;
    })();

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Deliberately re-created (not updated in place) whenever any input
    // changes - this map only re-renders on a fresh geolocation read, so a
    // full rebuild is simpler than diffing layers for no real cost.
  }, [campusLocation, userLocation.latitude, userLocation.longitude]);

  return <div ref={containerRef} className={className} />;
}
