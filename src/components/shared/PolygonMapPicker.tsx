"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import { Button } from "@/components/ui/button";
import { Undo2, Trash2 } from "lucide-react";

export interface LatLng {
  latitude: number;
  longitude: number;
}

interface PolygonMapPickerProps {
  points: LatLng[];
  onChange: (points: LatLng[]) => void;
  initialCenter?: LatLng;
  initialZoom?: number;
  className?: string;
}

// Click-to-add-vertex campus boundary drawer. Uses plain Leaflet (not
// react-leaflet) so the map is a single imperative instance we fully control -
// simpler than wiring React state through react-leaflet's component tree for
// a one-off "click the map, build a polygon" interaction. circleMarker (a
// plain SVG dot, not an image-based pin) sidesteps Leaflet's well-known
// broken-default-icon-path issue under bundlers like Turbopack/webpack.
// Free OpenStreetMap tiles - no API key, no cost.
export function PolygonMapPicker({ points, onChange, initialCenter, initialZoom = 17, className }: PolygonMapPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const polygonRef = useRef<import("leaflet").Polygon | null>(null);
  const markersRef = useRef<import("leaflet").CircleMarker[]>([]);
  // Always call the latest onChange/points from inside the Leaflet click
  // handler (registered once) without re-binding it on every parent render.
  const pointsRef = useRef(points);
  const onChangeRef = useRef(onChange);
  pointsRef.current = points;
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let disposed = false;

    void (async () => {
      const L = (await import("leaflet")).default;
      if (disposed || !containerRef.current || mapRef.current) return;

      const center = initialCenter ?? { latitude: 16.5675, longitude: 81.5223 };
      const map = L.map(containerRef.current).setView([center.latitude, center.longitude], initialZoom);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);

      map.on("click", (e: import("leaflet").LeafletMouseEvent) => {
        const next = [...pointsRef.current, { latitude: e.latlng.lat, longitude: e.latlng.lng }];
        onChangeRef.current(next);
      });

      mapRef.current = map;
      redraw(L, map);
    })();

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function redraw(L: typeof import("leaflet"), map: import("leaflet").Map) {
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = points.map((p) =>
      L.circleMarker([p.latitude, p.longitude], { radius: 6, color: "#2563eb", fillColor: "#3b82f6", fillOpacity: 1 }).addTo(map)
    );

    polygonRef.current?.remove();
    polygonRef.current = points.length >= 2
      ? L.polygon(points.map((p) => [p.latitude, p.longitude]), { color: "#2563eb", fillOpacity: 0.15 }).addTo(map)
      : null;
  }

  useEffect(() => {
    if (!mapRef.current) return;
    void (async () => {
      const L = (await import("leaflet")).default;
      if (mapRef.current) redraw(L, mapRef.current);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);

  return (
    <div className={className}>
      <div ref={containerRef} className="h-80 w-full rounded-lg border" />
      <div className="flex items-center justify-between gap-2 mt-2">
        <p className="text-xs text-muted-foreground">
          Click the map to add boundary points ({points.length} so far{points.length > 0 && points.length < 3 ? `, need ${3 - points.length} more` : ""}).
        </p>
        <div className="flex gap-2 shrink-0">
          <Button type="button" variant="outline" size="sm" disabled={points.length === 0} onClick={() => onChange(points.slice(0, -1))}>
            <Undo2 className="h-3.5 w-3.5 mr-1.5" /> Undo
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={points.length === 0} onClick={() => onChange([])}>
            <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Clear
          </Button>
        </div>
      </div>
    </div>
  );
}
