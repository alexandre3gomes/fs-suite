import geomagnetism from 'geomagnetism';

const R_NM = 3440.065;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Magnetic declination at a point (degrees, positive east).
 * Uses WMM via geomagnetism package. Returns 0 on failure (so cardinal-only fallback).
 */
export function magneticDeclination(lat: number, lon: number, date: Date = new Date()): number {
  try {
    const model = geomagnetism.model(date);
    const point = model.point([lat, lon]);
    return point.decl;
  } catch {
    return 0;
  }
}

/**
 * Magnetic course from (lat1, lon1) to (lat2, lon2) — bearing corrected for declination
 * at the midpoint of the leg. Returns degrees 0-360.
 */
export function magneticCourse(lat1: number, lon1: number, lat2: number, lon2: number, date?: Date): number {
  const tc = initialBearing(lat1, lon1, lat2, lon2);
  const midLat = (lat1 + lat2) / 2;
  const midLon = (lon1 + lon2) / 2;
  const decl = magneticDeclination(midLat, midLon, date);
  // MC = TC - declination (positive east means MC < TC for east declination)
  return ((tc - decl) % 360 + 360) % 360;
}

export function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.sin(dLon / 2) ** 2;
  return R_NM * 2 * Math.asin(Math.sqrt(a));
}

export function initialBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = lat1 * DEG_TO_RAD;
  const φ2 = lat2 * DEG_TO_RAD;
  const Δλ = (lon2 - lon1) * DEG_TO_RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * RAD_TO_DEG) + 360) % 360;
}

export function pointInRing(lat: number, lon: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!, yi = ring[i]![1]!;
    const xj = ring[j]![0]!, yj = ring[j]![1]!;
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

export function segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const d1 = cross(cx, cy, dx, dy, ax, ay);
  const d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy);
  const d4 = cross(ax, ay, bx, by, dx, dy);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
         ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export function extractRings(geometry: { type: string; coordinates: unknown }): number[][][] {
  if (geometry.type === 'Polygon') {
    return geometry.coordinates as number[][][];
  }
  if (geometry.type === 'MultiPolygon') {
    return (geometry.coordinates as number[][][][]).map((poly) => poly[0]!);
  }
  return [];
}

export function segmentIntersectsPolygon(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  geometry: { type: string; coordinates: unknown },
): boolean {
  const rings = extractRings(geometry);
  if (rings.length === 0) return false;

  for (const ring of rings) {
    if (pointInRing(a.lat, a.lon, ring)) return true;
    if (pointInRing(b.lat, b.lon, ring)) return true;
    for (let j = 0; j < ring.length - 1; j++) {
      const c = ring[j]!;
      const d = ring[j + 1]!;
      if (segmentsIntersect(a.lon, a.lat, b.lon, b.lat, c[0]!, c[1]!, d[0]!, d[1]!)) {
        return true;
      }
    }
  }
  return false;
}

export function routeIntersectsPolygon(
  waypoints: { lat: number; lon: number }[],
  geometry: { type: string; coordinates: unknown },
): boolean {
  for (let i = 0; i < waypoints.length - 1; i++) {
    if (segmentIntersectsPolygon(waypoints[i]!, waypoints[i + 1]!, geometry)) return true;
  }
  return false;
}
