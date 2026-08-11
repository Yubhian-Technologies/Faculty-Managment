// Great-circle (haversine) distance between two lat/long points, in meters.
// Used to enforce "must be on campus" for self-attendance check-in/out.
export function distanceMeters(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371000; // Earth radius, meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Standard ray-casting (even-odd rule) point-in-polygon test. Treats
// longitude/latitude as flat Cartesian x/y - a fine approximation at
// campus scale (a few hundred meters), not valid for polygons spanning a
// meaningful fraction of the globe.
export function isPointInPolygon(
  lat: number, lon: number,
  points: { latitude: number; longitude: number }[]
): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].longitude, yi = points[i].latitude;
    const xj = points[j].longitude, yj = points[j].latitude;
    const intersects = (yi > lat) !== (yj > lat)
      && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export type CampusLocation =
  | { shape: "circle"; latitude: number; longitude: number; radiusMeters: number }
  | { shape: "polygon"; points: { latitude: number; longitude: number }[] };

// Single entry point both check-in and check-out validate against, so the
// two shapes (simple radius vs. a drawn boundary) don't need branching
// duplicated in every route that enforces "must be on campus".
export function checkCampusGeofence(
  lat: number, lon: number,
  campusLocation: CampusLocation
): { withinBounds: boolean; message?: string } {
  if (campusLocation.shape === "polygon") {
    const withinBounds = isPointInPolygon(lat, lon, campusLocation.points);
    return withinBounds
      ? { withinBounds }
      : { withinBounds, message: "You are outside the campus boundary required to mark attendance" };
  }

  const distance = distanceMeters(lat, lon, campusLocation.latitude, campusLocation.longitude);
  const withinBounds = distance <= campusLocation.radiusMeters;
  return withinBounds
    ? { withinBounds }
    : {
        withinBounds,
        message: `You are outside the campus location required to mark attendance (${Math.round(distance)}m away, ${campusLocation.radiusMeters}m allowed)`,
      };
}
