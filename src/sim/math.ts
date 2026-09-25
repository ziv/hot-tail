import { Matrix4, Quaternion, Vector3 } from 'three';

export const UP = new Vector3(0, 1, 0);
const ZERO = new Vector3();
const _m = new Matrix4();
const _q = new Quaternion();
const _v = new Vector3();
const Z_AXIS = new Vector3(0, 0, 1);

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Frame-rate independent smoothing factor for exponential approach. */
export function approach(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

export function moveToward(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

/**
 * Rotates unit vector `dir` toward unit vector `desired` by at most maxAngle
 * radians, in place.
 */
export function rotateToward(dir: Vector3, desired: Vector3, maxAngle: number): Vector3 {
  const cos = clamp(dir.dot(desired), -1, 1);
  const angle = Math.acos(cos);
  if (angle <= maxAngle || angle < 1e-6) return dir.copy(desired);
  // Perpendicular component of desired relative to dir.
  _v.copy(desired).addScaledVector(dir, -cos);
  if (_v.lengthSq() < 1e-10) {
    // Opposite directions: pick any perpendicular.
    _v.set(dir.y, -dir.x, 0);
    if (_v.lengthSq() < 1e-10) _v.set(0, dir.z, -dir.y);
  }
  _v.normalize();
  return dir.multiplyScalar(Math.cos(maxAngle)).addScaledVector(_v, Math.sin(maxAngle)).normalize();
}

/** Orientation for a model whose nose points down -Z, facing `dir`, banked. */
export function lookQuaternion(dir: Vector3, bank: number, out: Quaternion): Quaternion {
  if (dir.lengthSq() < 1e-8) return out;
  _m.lookAt(ZERO, dir, UP);
  out.setFromRotationMatrix(_m);
  if (bank !== 0) out.multiply(_q.setFromAxisAngle(Z_AXIS, bank));
  return out;
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
