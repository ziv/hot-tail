import { Matrix4, Quaternion, Vector3 } from 'three';
import { dacos, dcos, dexp, dsin } from '../core/dmath';

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
  return 1 - dexp(-rate * dt);
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
  const angle = dacos(cos);
  if (angle <= maxAngle || angle < 1e-6) return dir.copy(desired);
  // Perpendicular component of desired relative to dir.
  _v.copy(desired).addScaledVector(dir, -cos);
  if (_v.lengthSq() < 1e-10) {
    // Opposite directions: pick any perpendicular.
    _v.set(dir.y, -dir.x, 0);
    if (_v.lengthSq() < 1e-10) _v.set(0, dir.z, -dir.y);
  }
  _v.normalize();
  return dir.multiplyScalar(dcos(maxAngle)).addScaledVector(_v, dsin(maxAngle)).normalize();
}

/** Orientation for a model whose nose points down -Z, facing `dir`, banked. */
export function lookQuaternion(dir: Vector3, bank: number, out: Quaternion): Quaternion {
  if (dir.lengthSq() < 1e-8) return out;
  _m.lookAt(ZERO, dir, UP);
  out.setFromRotationMatrix(_m);
  if (bank !== 0) out.multiply(quatFromAxisAngle(Z_AXIS, bank, _q));
  return out;
}

export function easeInOut(t: number): number {
  const u = -2 * t + 2;
  return t < 0.5 ? 2 * t * t : 1 - (u * u) / 2;
}

// Deterministic replacements for three's trig-based quaternion helpers.

export function quatFromAxisAngle(axis: Vector3, angle: number, out: Quaternion): Quaternion {
  const s = dsin(angle / 2);
  return out.set(axis.x * s, axis.y * s, axis.z * s, dcos(angle / 2));
}

/** Same convention as three's Euler: order 'XYZ' (default) or 'YXZ'. */
export function quatFromEuler(
  x: number,
  y: number,
  z: number,
  order: 'XYZ' | 'YXZ',
  out: Quaternion,
): Quaternion {
  const c1 = dcos(x / 2);
  const c2 = dcos(y / 2);
  const c3 = dcos(z / 2);
  const s1 = dsin(x / 2);
  const s2 = dsin(y / 2);
  const s3 = dsin(z / 2);
  if (order === 'XYZ') {
    return out.set(
      s1 * c2 * c3 + c1 * s2 * s3,
      c1 * s2 * c3 - s1 * c2 * s3,
      c1 * c2 * s3 + s1 * s2 * c3,
      c1 * c2 * c3 - s1 * s2 * s3,
    );
  }
  return out.set(
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 - s1 * s2 * c3,
    c1 * c2 * c3 + s1 * s2 * s3,
  );
}

/** Normalised lerp toward `to` (shortest arc) — a trig-free slerp stand-in. */
export function nlerp(q: Quaternion, to: Quaternion, t: number): Quaternion {
  const sign = q.x * to.x + q.y * to.y + q.z * to.z + q.w * to.w < 0 ? -1 : 1;
  q.set(
    q.x + (to.x * sign - q.x) * t,
    q.y + (to.y * sign - q.y) * t,
    q.z + (to.z * sign - q.z) * t,
    q.w + (to.w * sign - q.w) * t,
  );
  return q.normalize();
}
