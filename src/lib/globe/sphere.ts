import { Vector3 } from 'three';

const RAD = Math.PI / 180;

/** Lat/lon in degrees to a point on a sphere, y up and lon 0 facing +z */
export function toVector(lat: number, lon: number, radius = 1, out = new Vector3()) {
  const phi = lat * RAD;
  const lambda = lon * RAD;
  return out.set(
    radius * Math.cos(phi) * Math.sin(lambda),
    radius * Math.sin(phi),
    radius * Math.cos(phi) * Math.cos(lambda)
  );
}

export function toLatLon(point: Vector3): [number, number] {
  const unit = point.clone().normalize();
  return [Math.asin(unit.y) / RAD, Math.atan2(unit.x, unit.z) / RAD];
}

/** Where the sun's overhead right now, near enough for a terminator line */
export function subsolar(date = new Date()): [number, number] {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const day = (date.getTime() - start) / 86_400_000;
  const declination = -23.44 * Math.cos(((2 * Math.PI) / 365) * (day + 10));
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60;
  return [declination, -15 * (hours - 12)];
}
