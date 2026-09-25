/**
 * Rail path (C2): lateral offset and altitude as smooth functions of distance
 * travelled. The simulation frame stays aligned with -Z (floating origin), and
 * the world is shifted by the rail offset, so steering the rail sweeps the
 * terrain under the player without rotating any simulation coordinates.
 */
export interface RailSample {
  x: number;
  y: number;
}

export class Rail {
  private readonly d: number[];
  private readonly x: number[];
  private readonly y: number[];
  private readonly mx: number[];
  private readonly my: number[];

  constructor(points: readonly (readonly [number, number, number])[]) {
    const pts = points.length > 0 ? [...points] : [[0, 0, 120] as const];
    pts.sort((a, b) => a[0] - b[0]);
    this.d = pts.map((p) => p[0]);
    this.x = pts.map((p) => p[1]);
    this.y = pts.map((p) => p[2]);
    this.mx = tangents(this.d, this.x);
    this.my = tangents(this.d, this.y);
  }

  sample(dist: number, out: RailSample): RailSample {
    const d = this.d;
    const n = d.length;
    if (n === 1 || dist <= d[0]) {
      out.x = this.x[0];
      out.y = this.y[0];
      return out;
    }
    if (dist >= d[n - 1]) {
      out.x = this.x[n - 1];
      out.y = this.y[n - 1];
      return out;
    }
    // Binary search for the containing segment.
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (d[mid] <= dist) lo = mid;
      else hi = mid;
    }
    const i = lo;
    const h = d[i + 1] - d[i];
    const t = (dist - d[i]) / h;
    out.x = hermite(this.x[i], this.x[i + 1], this.mx[i] * h, this.mx[i + 1] * h, t);
    out.y = hermite(this.y[i], this.y[i + 1], this.my[i] * h, this.my[i + 1] * h, t);
    return out;
  }
}

function tangents(d: number[], v: number[]): number[] {
  const n = d.length;
  const m = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) m[i] = (v[i + 1] - v[i - 1]) / (d[i + 1] - d[i - 1]);
  return m;
}

function hermite(p0: number, p1: number, m0: number, m1: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * m1;
}
