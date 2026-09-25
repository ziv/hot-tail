/**
 * Deterministic math (J4). JS engines implement Math.sin/cos/exp/acos… with
 * different libm code, so results can differ in the last bits between Chrome,
 * Firefox, Safari and the server. Everything here is built only from IEEE-754
 * exact operations (+ − × ÷, sqrt) in a fixed order, so a replay re-simulated
 * on any engine produces bit-identical game state.
 *
 * Accuracy is ~1e-15 relative — indistinguishable from Math.* for gameplay.
 */
const PI = 3.141592653589793;
const HALF_PI = 1.5707963267948966;
// Cody–Waite split of π/2 so range reduction stays exact for moderate |x|.
const PIO2_HI = 1.5707963267341256;
const PIO2_LO = 6.077100506506192e-11;
const LN2_HI = 0.6931471803691238;
const LN2_LO = 1.9082149292705877e-10;
const INV_LN2 = 1.4426950408889634;

/** sin on [-π/4, π/4] (Taylor to x^17). */
function sinCore(x: number): number {
  const x2 = x * x;
  return (
    x *
    (1 +
      x2 *
        (-1 / 6 +
          x2 *
            (1 / 120 +
              x2 *
                (-1 / 5040 +
                  x2 *
                    (1 / 362880 +
                      x2 *
                        (-1 / 39916800 +
                          x2 * (1 / 6227020800 + x2 * (-1 / 1307674368000 + x2 / 355687428096000))))))))
  );
}

/** cos on [-π/4, π/4] (Taylor to x^18). */
function cosCore(x: number): number {
  const x2 = x * x;
  return (
    1 +
    x2 *
      (-1 / 2 +
        x2 *
          (1 / 24 +
            x2 *
              (-1 / 720 +
                x2 *
                  (1 / 40320 +
                    x2 *
                      (-1 / 3628800 +
                        x2 * (1 / 479001600 + x2 * (-1 / 87178291200 + x2 / 20922789888000)))))))
  );
}

function reduce(x: number): { r: number; q: number } {
  const k = Math.round(x / HALF_PI);
  const r = x - k * PIO2_HI - k * PIO2_LO;
  return { r, q: ((k % 4) + 4) % 4 };
}

export function dsin(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const { r, q } = reduce(x);
  switch (q) {
    case 0:
      return sinCore(r);
    case 1:
      return cosCore(r);
    case 2:
      return -sinCore(r);
    default:
      return -cosCore(r);
  }
}

export function dcos(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const { r, q } = reduce(x);
  switch (q) {
    case 0:
      return cosCore(r);
    case 1:
      return -sinCore(r);
    case 2:
      return -cosCore(r);
    default:
      return sinCore(r);
  }
}

/** atan via two argument halvings then a Taylor series (|x| ≤ tan(π/16)). */
export function datan(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x === Infinity) return HALF_PI;
  if (x === -Infinity) return -HALF_PI;
  const neg = x < 0;
  let a = neg ? -x : x;
  let invert = false;
  if (a > 1) {
    a = 1 / a;
    invert = true;
  }
  // atan(a) = 2·atan(a / (1 + sqrt(1 + a²))), applied twice.
  a = a / (1 + Math.sqrt(1 + a * a));
  a = a / (1 + Math.sqrt(1 + a * a));
  const a2 = a * a;
  let term = a;
  let sum = a;
  for (let n = 3; n <= 25; n += 2) {
    term *= -a2;
    sum += term / n;
  }
  let r = 4 * sum;
  if (invert) r = HALF_PI - r;
  return neg ? -r : r;
}

export function datan2(y: number, x: number): number {
  if (x > 0) return datan(y / x);
  if (x < 0) return y >= 0 ? datan(y / x) + PI : datan(y / x) - PI;
  if (y > 0) return HALF_PI;
  if (y < 0) return -HALF_PI;
  return 0;
}

export function dacos(x: number): number {
  const c = x < -1 ? -1 : x > 1 ? 1 : x;
  return datan2(Math.sqrt((1 - c) * (1 + c)), c);
}

export function dasin(x: number): number {
  const c = x < -1 ? -1 : x > 1 ? 1 : x;
  return datan2(c, Math.sqrt((1 - c) * (1 + c)));
}

const _f64 = new Float64Array(1);
const _u32 = new Uint32Array(_f64.buffer);
const HI = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 1 : 0; // little-endian → high word at [1]

/** Exact 2^k for integer k in the normal range. */
function pow2(k: number): number {
  if (k > 1023) return Infinity;
  if (k < -1022) return 0;
  _u32[HI] = (k + 1023) << 20;
  _u32[1 - HI] = 0;
  return _f64[0];
}

export function dexp(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x > 709) return Infinity;
  if (x < -708) return 0;
  const k = Math.round(x * INV_LN2);
  const r = x - k * LN2_HI - k * LN2_LO;
  // Taylor series to r^14 for |r| ≤ ln2/2.
  let term = 1;
  let sum = 1;
  for (let n = 1; n <= 14; n++) {
    term *= r / n;
    sum += term;
  }
  return sum * pow2(k);
}
