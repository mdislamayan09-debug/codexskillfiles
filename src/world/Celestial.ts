import * as THREE from 'three';
import { DEG, TAU } from '../core/math';

// The Stillwild sits at a northern temperate latitude, caught forever in the
// same late-summer week: the sun traces the same arc every day. The moon,
// untouched by the Held Note, keeps cycling through its phases.

export const LATITUDE = 49 * DEG;
export const SUN_DECLINATION = 13 * DEG;
export const MOON_CYCLE_DAYS = 8;

/** Unit direction toward a body at the given azimuth (from north, toward east) and altitude. */
export function directionFromAzAlt(azimuth: number, altitude: number, out: THREE.Vector3): THREE.Vector3 {
  const c = Math.cos(altitude);
  return out.set(Math.sin(azimuth) * c, Math.sin(altitude), -Math.cos(azimuth) * c);
}

function bodyDirection(hourAngle: number, declination: number, out: THREE.Vector3): THREE.Vector3 {
  const sinAlt = Math.sin(LATITUDE) * Math.sin(declination) + Math.cos(LATITUDE) * Math.cos(declination) * Math.cos(hourAngle);
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const cosAz = (Math.sin(declination) - sinAlt * Math.sin(LATITUDE)) / Math.max(1e-6, Math.cos(altitude) * Math.cos(LATITUDE));
  let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz)));
  if (Math.sin(hourAngle) > 0) azimuth = TAU - azimuth;
  return directionFromAzAlt(azimuth, altitude, out);
}

/** Sun direction for a time of day in hours (0–24). Solar noon at 12:30. */
export function sunDirection(hours: number, out: THREE.Vector3): THREE.Vector3 {
  const hourAngle = ((hours - 12.5) / 24) * TAU;
  return bodyDirection(hourAngle, SUN_DECLINATION, out);
}

/** Moon phase in [0, 1): 0 new, 0.5 full. */
export function moonPhase(day: number, hours: number): number {
  const t = (day + hours / 24) / MOON_CYCLE_DAYS;
  return t - Math.floor(t);
}

/** Fraction of the moon disc that is lit (0 new .. 1 full). */
export function moonIllumination(phase: number): number {
  return 0.5 - 0.5 * Math.cos(phase * TAU);
}

export function moonDirection(day: number, hours: number, out: THREE.Vector3): THREE.Vector3 {
  const phase = moonPhase(day, hours);
  // The moon trails the sun by `phase` of a day; full moon rises at sunset.
  const hourAngle = ((hours - 12.5 - phase * 24) / 24) * TAU;
  const declination = (4 + 9 * Math.sin(day * 0.9)) * DEG;
  return bodyDirection(hourAngle, declination, out);
}

/** Rotation of the celestial sphere (stars) about the pole for this moment. */
export function starRotation(day: number, hours: number, out: THREE.Matrix4): THREE.Matrix4 {
  const sidereal = ((day * 24 + hours) / 23.934) * TAU;
  // Pole points north (-Z) raised by the latitude.
  const pole = new THREE.Vector3(0, Math.sin(LATITUDE), -Math.cos(LATITUDE)).normalize();
  return out.makeRotationAxis(pole, -sidereal);
}
