import { BoxGeometry, CylinderGeometry, SphereGeometry, type ColorRepresentation } from 'three';
import { loft, sectionAt, shell, vfin, wing, type Station, type WingSection } from './airframe';
import { Builder, SURF, cone, cyl, plate, type ModelGeo, type PartOpts, type Surf } from './models';

/**
 * Aircraft models built from lofted fuselages and airfoil wings (smooth
 * normals, countershaded paint, glass canopies, metal nozzles, open intakes,
 * ordnance on pylons). All original designs; each keeps its gameplay role's
 * silhouette and footprint. Noses point down -Z.
 */

const GLASS = '#2e2a1c';
const DARK = '#15171a';
const NOZZLE = '#5d6168';
const RADOME = '#80868d';

const skin = (under: ColorRepresentation, extra: PartOpts = {}): PartOpts => ({
  smooth: true,
  surf: SURF.paint,
  under,
  ...extra,
});
const smooth = (surf: Surf = SURF.paint): PartOpts => ({ smooth: true, surf });
const glowDisc = (r: number) => new CylinderGeometry(r, r, 0.12, 14).rotateX(Math.PI / 2);

/** Bubble canopy with a frame hoop; stations run nose → tail. */
function canopy(b: Builder, st: Station[], frame: ColorRepresentation, seg = 18): void {
  b.add(loft(st, { seg }), GLASS, {}, smooth(SURF.glass));
  // Windscreen bow: a slim band just proud of the glass.
  const i = Math.min(2, st.length - 2);
  const s = st[i];
  const band = (dz: number): Station => ({
    ...s,
    z: s.z + dz,
    w: s.w + 0.04,
    h: (s.h ?? s.w) + 0.04,
  });
  b.add(loft([band(-0.07), band(0.07)], { seg }), frame, {}, smooth());
}

/** Jet nozzle: metal outer shell, sooty interior visible from behind, hot glow disc. */
function nozzle(
  b: Builder,
  glow: Builder,
  x: number,
  y: number,
  z0: number,
  z1: number,
  r: number,
  hot: ColorRepresentation,
  mirror = true,
): void {
  const outer = () =>
    loft(
      [
        { z: z0, w: r * 1.05, y },
        { z: lerp(z0, z1, 0.55), w: r * 1.02, y },
        { z: z1, w: r * 0.9, y },
        { z: z1, w: r * 0.8, y },
      ],
      { seg: 16, caps: [true, false] },
    );
  const inner = () =>
    loft(
      [
        { z: z1 - 0.01, w: r * 0.8, y },
        { z: z1 - (z1 - z0) * 0.45, w: r * 0.62, y },
      ],
      { seg: 16, inside: true },
    );
  const disc = () => glowDisc(r * 0.62);
  if (mirror && x !== 0) {
    b.mirror(outer, NOZZLE, { p: [x, 0, 0] }, smooth(SURF.metal));
    b.mirror(inner, '#1d1b1a', { p: [x, 0, 0] }, smooth(SURF.soot));
    glow.mirror(disc, hot, { p: [x, y, z1 - (z1 - z0) * 0.32] });
  } else {
    b.add(outer(), NOZZLE, { p: [x, 0, 0] }, smooth(SURF.metal));
    b.add(inner(), '#1d1b1a', { p: [x, 0, 0] }, smooth(SURF.soot));
    glow.add(disc(), hot, { p: [x, y, z1 - (z1 - z0) * 0.32] });
  }
}

/** Air intake duct, open at the front with a dark compressor face inside. */
function intake(b: Builder, st: Station[], color: ColorRepresentation, under: ColorRepresentation): void {
  const x = st[0].x ?? 0;
  const local = st.map((s) => ({ ...s, x: 0 }));
  b.mirror(() => loft(local, { seg: 16, caps: [false, true] }), color, { p: [x, 0, 0] }, skin(under));
  const f = st[0];
  b.mirror(
    () => new BoxGeometry(f.w * 1.9, ((f.h ?? f.w) + (f.hb ?? f.h ?? f.w)) * 0.95, 0.05),
    DARK,
    { p: [x, f.y ?? 0, f.z + 0.35] },
    { surf: SURF.matte },
  );
}

/** Air-to-air missile hung from a pylon; (x, y, z) is the pylon's top. */
function aam(
  b: Builder,
  x: number,
  y: number,
  z: number,
  len = 3.4,
  color: ColorRepresentation = '#e6e8ea',
): void {
  const r = len * 0.05;
  const cy = y - 0.42;
  const body = (): Station[] => [
    { z: -len / 2 - 0.5, w: 0.01, y: cy },
    { z: -len / 2, w: r, y: cy },
    { z: len / 2, w: r, y: cy },
  ];
  b.mirror(() => loft(body(), { seg: 10 }), color, { p: [x, 0, z] }, smooth(SURF.gloss));
  b.mirror(
    () => new BoxGeometry(0.1, 0.3, len * 0.45),
    '#8a9098',
    { p: [x, y - 0.14, z] },
    { surf: SURF.paint },
  );
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    b.mirror(
      () => new BoxGeometry(0.03, r * 3.2, len * 0.14),
      color,
      {
        p: [x + Math.cos(a) * r * 1.6, cy + Math.sin(a) * r * 1.6, z + len * 0.42],
        r: [0, 0, a - Math.PI / 2],
      },
      { surf: SURF.gloss },
    );
  }
}

/** Podded turbofan on a pylon (airliner-type aircraft); (x, y, z) is the intake centre. */
function turbofan(b: Builder, x: number, y: number, z: number, r: number, color: ColorRepresentation): void {
  b.mirror(
    () =>
      loft(
        [
          { z: 0, w: r * 0.95, y: 0 },
          { z: r * 0.9, w: r * 1.08, y: 0 },
          { z: r * 3.2, w: r * 0.92, y: 0 },
          { z: r * 4.2, w: r * 0.55, y: 0 },
        ],
        { seg: 18, caps: [false, true] },
      ),
    color,
    { p: [x, y, z] },
    skin('#9aa0a6'),
  );
  b.mirror(() => glowDisc(r * 0.9).rotateX(0), '#2a2d31', { p: [x, y, z + 0.5] }, { surf: SURF.metal });
  b.mirror(() => cone(r * 0.32, r * 0.7, 10), '#6d7278', { p: [x, y, z + 0.2] }, smooth(SURF.metal));
  b.mirror(
    () =>
      vfin(
        [
          { x: 0, z: 0, c: r * 3.4 },
          { x: r * 1.4, z: r * 0.6, c: r * 3 },
        ],
        0.12,
      ),
    color,
    { p: [x, y + r * 0.7, z + r * 0.5] },
    smooth(),
  );
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ======================================================= player: KESTREL
/** Twin-engine, twin-tail air-superiority fighter. */
export function playerJet(): ModelGeo {
  const b = new Builder();
  const g = new Builder();
  const hull = '#a9b1ba';
  const under = '#c8ced6';
  const accent = '#2f6fc9';
  b.add(
    loft(
      [
        { z: -12.3, w: 0.02, y: 0.05 },
        { z: -11.5, w: 0.34, y: 0.07 },
        { z: -10.2, w: 0.62, h: 0.58, y: 0.1 },
        { z: -8.6, w: 0.86, h: 0.8, y: 0.14 },
        { z: -7, w: 1.0, h: 0.9, hb: 0.85, y: 0.16 },
        { z: -5.4, w: 1.12, h: 0.96, hb: 0.9, y: 0.14 },
        { z: -4.2, w: 1.45, h: 0.94, hb: 0.92, y: 0.08, n: 2.4 },
        { z: -2.4, w: 2.55, h: 0.84, hb: 1.0, y: 0, n: 3.2 },
        { z: 0.6, w: 2.75, h: 0.78, hb: 0.95, n: 3.6 },
        { z: 3.6, w: 2.5, h: 0.7, hb: 0.85, n: 3.6 },
        { z: 5.3, w: 2.05, h: 0.64, hb: 0.74, n: 3.2 },
        { z: 5.8, w: 1.9, h: 0.58, hb: 0.68, n: 3 },
      ],
      { seg: 26, maxStep: 0.8 },
    ),
    hull,
    {},
    skin(under, {
      paint: (p) => (p.z < -11.2 ? { color: RADOME, surf: SURF.paint } : null),
    }),
  );
  intake(
    b,
    [
      { z: -4.7, x: 1.95, w: 0.62, h: 0.74, y: -0.15, n: 5 },
      { z: -3.2, x: 1.95, w: 0.7, h: 0.8, y: -0.15, n: 5 },
      { z: -0.8, x: 1.95, w: 0.7, h: 0.76, y: -0.1, n: 4 },
    ],
    hull,
    under,
  );
  canopy(
    b,
    [
      { z: -9.4, w: 0.03, y: 0.72 },
      { z: -8.5, w: 0.5, h: 0.42, hb: 0.05, y: 0.8 },
      { z: -7.2, w: 0.7, h: 0.6, hb: 0.05, y: 0.86 },
      { z: -5.8, w: 0.68, h: 0.58, hb: 0.05, y: 0.86 },
      { z: -4.6, w: 0.5, h: 0.4, hb: 0.05, y: 0.8 },
      { z: -3.9, w: 0.2, h: 0.14, hb: 0.05, y: 0.78 },
    ],
    hull,
  );
  // Dorsal spine behind the canopy.
  b.add(
    loft(
      [
        { z: -4.6, w: 0.5, h: 0.34, hb: 0.2, y: 0.75 },
        { z: -2, w: 0.78, h: 0.44, hb: 0.3, y: 0.72 },
        { z: 2, w: 0.62, h: 0.34, hb: 0.3, y: 0.62 },
        { z: 4.6, w: 0.34, h: 0.18, hb: 0.2, y: 0.5 },
      ],
      { seg: 16 },
    ),
    hull,
    {},
    skin(under),
  );
  const root: WingSection = { x: 1.4, z: -3.4, c: 8.4, y: 0.05, t: 0.055 };
  const tip: WingSection = { x: 8.6, z: 2.6, c: 2.3, y: 0.18, t: 0.045 };
  b.mirror(() => wing([root, tip]), hull, {}, skin(under));
  b.mirror(() => wing([sectionAt(root, tip, 7.9, 0.06), { ...tip, x: 8.64, t: 0.06 }]), accent, {}, smooth());
  b.mirror(
    () =>
      wing([
        { x: 1.9, z: 4.5, c: 3.3, y: -0.05 },
        { x: 5.2, z: 6.6, c: 1.3, y: -0.05, t: 0.045 },
      ]),
    hull,
    {},
    skin(under),
  );
  const fRoot: WingSection = { x: 0, z: 3.0, c: 4.1 };
  const fTip: WingSection = { x: 4.3, z: 6.4, c: 1.35 };
  b.mirror(() => vfin([fRoot, fTip]), hull, { p: [1.45, 0.52, 0], r: [0, 0, -0.2] }, skin(under));
  b.mirror(
    () => vfin([sectionAt(fRoot, fTip, 3.5, 0.06), { ...fTip, x: 4.32, t: 0.06 }]),
    accent,
    { p: [1.45, 0.52, 0], r: [0, 0, -0.2] },
    smooth(),
  );
  nozzle(b, g, 0.95, 0, 5.1, 6.5, 0.74, '#ffb266');
  aam(b, 4.4, -0.05, 0.9);
  aam(b, 6.4, 0.02, 2.4, 3.0);
  return { body: b.build(), glow: g.build(), radius: 10 };
}

// ========================================================= player: DART
/** Light single-engine cranked-delta canard fighter. */
export function playerDart(): ModelGeo {
  const b = new Builder();
  const g = new Builder();
  const hull = '#cfccc2';
  const under = '#e2e0d8';
  const accent = '#e0453a';
  b.add(
    loft(
      [
        { z: -12.8, w: 0.02, y: 0.05 },
        { z: -11.8, w: 0.32, y: 0.07 },
        { z: -10.2, w: 0.6, h: 0.55, y: 0.1 },
        { z: -8.4, w: 0.82, h: 0.78, y: 0.14 },
        { z: -6.6, w: 0.95, h: 0.9, hb: 0.82, y: 0.15 },
        { z: -4.8, w: 1.05, h: 0.94, hb: 0.85, y: 0.12 },
        { z: -2.8, w: 1.5, h: 0.9, hb: 0.86, y: 0.05, n: 2.6 },
        { z: 0, w: 1.48, h: 0.88, hb: 0.86, y: 0.05, n: 2.6 },
        { z: 3, w: 1.22, h: 0.84, y: 0.05, n: 2.3 },
        { z: 5.1, w: 0.98, h: 0.8, y: 0.02 },
        { z: 5.5, w: 0.94, h: 0.78 },
      ],
      { seg: 24, maxStep: 0.8 },
    ),
    hull,
    {},
    skin(under, { paint: (p) => (p.z < -11.6 ? { color: RADOME } : null) }),
  );
  intake(
    b,
    [
      { z: -4.6, x: 1.2, w: 0.45, h: 0.6, y: -0.05, n: 3 },
      { z: -2.8, x: 1.2, w: 0.5, h: 0.65, y: 0, n: 3 },
      { z: -0.8, x: 1.2, w: 0.4, h: 0.55, y: 0, n: 3 },
    ],
    hull,
    under,
  );
  canopy(
    b,
    [
      { z: -9.6, w: 0.03, y: 0.65 },
      { z: -8.8, w: 0.45, h: 0.38, hb: 0.05, y: 0.75 },
      { z: -7.4, w: 0.62, h: 0.56, hb: 0.05, y: 0.82 },
      { z: -6, w: 0.58, h: 0.5, hb: 0.05, y: 0.8 },
      { z: -4.8, w: 0.35, h: 0.28, hb: 0.05, y: 0.78 },
      { z: -4.2, w: 0.12, h: 0.1, hb: 0.05, y: 0.76 },
    ],
    hull,
  );
  b.add(
    loft(
      [
        { z: -4.8, w: 0.4, h: 0.3, hb: 0.2, y: 0.72 },
        { z: -1, w: 0.6, h: 0.4, hb: 0.3, y: 0.7 },
        { z: 3.5, w: 0.4, h: 0.3, hb: 0.25, y: 0.6 },
        { z: 5.2, w: 0.2, h: 0.12, hb: 0.1, y: 0.5 },
      ],
      { seg: 14 },
    ),
    hull,
    {},
    skin(under),
  );
  const w0: WingSection = { x: 0.9, z: -4.2, c: 9.6, y: 0, t: 0.045 };
  const w1: WingSection = { x: 3, z: -0.6, c: 6.3, y: 0.02, t: 0.04 };
  const w2: WingSection = { x: 7.2, z: 3.6, c: 1.7, y: 0.05, t: 0.04 };
  b.mirror(() => wing([w0, w1, w2]), hull, {}, skin(under));
  b.mirror(() => wing([sectionAt(w1, w2, 6.3, 0.05), { ...w2, x: 7.23, t: 0.05 }]), accent, {}, smooth());
  b.mirror(
    () =>
      wing([
        { x: 1.0, z: -7.4, c: 2.4, y: 0.4 },
        { x: 3.3, z: -6.2, c: 1.0, y: 0.48 },
      ]),
    hull,
    {},
    skin(under),
  );
  const fRoot: WingSection = { x: 0, z: 0.8, c: 5.0 };
  const fTip: WingSection = { x: 5, z: 4.8, c: 1.5 };
  b.add(vfin([fRoot, fTip]), hull, { p: [0, 0.75, 0] }, skin(under));
  b.add(
    vfin([sectionAt(fRoot, fTip, 3.9, 0.06), { ...fTip, x: 5.02, t: 0.06 }]),
    accent,
    { p: [0, 0.75, 0] },
    smooth(),
  );
  nozzle(b, g, 0, 0.02, 5.0, 6.4, 0.9, '#ffb266');
  // Wingtip rails and an inboard pylon.
  b.mirror(
    () =>
      loft(
        [
          { z: -1.9, w: 0.01 },
          { z: -1.6, w: 0.14 },
          { z: 1.5, w: 0.14 },
        ],
        { seg: 10 },
      ),
    '#e6e8ea',
    { p: [7.25, 0.05, 4.2] },
    smooth(SURF.gloss),
  );
  aam(b, 4.3, -0.02, 1.8, 3.0);
  return { body: b.build(), glow: g.build(), radius: 12 };
}

// ======================================================== player: MANTA
/** Heavy striker: diamond wing, V-tails, widely spaced engines. */
export function playerManta(): ModelGeo {
  const b = new Builder();
  const g = new Builder();
  const hull = '#7f8b99';
  const under = '#a2adb9';
  const accent = '#3ad0a8';
  b.add(
    loft(
      [
        { z: -12.6, w: 0.02, y: 0.1 },
        { z: -11.5, w: 0.45, h: 0.32, y: 0.1 },
        { z: -9.8, w: 0.85, h: 0.55, y: 0.12 },
        { z: -8, w: 1.15, h: 0.75, hb: 0.6, y: 0.15 },
        { z: -6, w: 1.5, h: 0.85, hb: 0.6, y: 0.12, n: 2.4 },
        { z: -3, w: 2.6, h: 0.85, hb: 0.6, y: 0.05, n: 2.6 },
        { z: 1, w: 3.0, h: 0.8, hb: 0.6, n: 3 },
        { z: 4.5, w: 2.8, h: 0.65, hb: 0.55, n: 3 },
        { z: 6, w: 2.5, h: 0.55, hb: 0.5, n: 3 },
      ],
      { seg: 26, maxStep: 0.8 },
    ),
    hull,
    {},
    skin(under, { paint: (p) => (p.z < -11.3 ? { color: RADOME } : null) }),
  );
  intake(
    b,
    [
      { z: -4.4, x: 1.55, w: 0.75, h: 0.55, y: -0.5, n: 4 },
      { z: -1, x: 1.55, w: 0.9, h: 0.72, y: -0.3, n: 3.4 },
      { z: 4.4, x: 1.55, w: 0.9, h: 0.72, y: -0.1, n: 3 },
      { z: 6.1, x: 1.55, w: 0.86, h: 0.7, y: 0, n: 2.6 },
    ],
    hull,
    under,
  );
  canopy(
    b,
    [
      { z: -9.8, w: 0.03, y: 0.52 },
      { z: -9, w: 0.5, h: 0.4, hb: 0.05, y: 0.62 },
      { z: -7.6, w: 0.72, h: 0.58, hb: 0.05, y: 0.7 },
      { z: -6.2, w: 0.7, h: 0.54, hb: 0.05, y: 0.72 },
      { z: -5, w: 0.5, h: 0.36, hb: 0.05, y: 0.7 },
      { z: -4.2, w: 0.2, h: 0.12, hb: 0.05, y: 0.68 },
    ],
    hull,
  );
  const root: WingSection = { x: 1.8, z: -5.8, c: 12, y: 0, t: 0.05 };
  const tip: WingSection = { x: 10.2, z: 1.9, c: 2.5, y: 0.15, t: 0.04 };
  b.mirror(() => wing([root, tip]), hull, {}, skin(under));
  b.mirror(
    () => wing([sectionAt(root, tip, 9.3, 0.055), { ...tip, x: 10.24, t: 0.055 }]),
    accent,
    {},
    smooth(),
  );
  const vRoot: WingSection = { x: 0, z: 2.6, c: 4.2 };
  const vTip: WingSection = { x: 4.4, z: 5.8, c: 1.6 };
  b.mirror(() => vfin([vRoot, vTip]), hull, { p: [2.3, 0.55, 0], r: [0, 0, -0.75] }, skin(under));
  b.mirror(
    () => vfin([sectionAt(vRoot, vTip, 3.6, 0.06), { ...vTip, x: 4.42, t: 0.06 }]),
    accent,
    { p: [2.3, 0.55, 0], r: [0, 0, -0.75] },
    smooth(),
  );
  nozzle(b, g, 1.55, 0, 5.6, 6.9, 0.84, '#ffb266');
  // Conformal weapons: two heavy missiles per side under the wing roots.
  aam(b, 3.4, -0.5, 1.2, 4.2, '#d9dcdf');
  aam(b, 5.6, -0.35, 2.6, 3.6, '#d9dcdf');
  return { body: b.build(), glow: g.build(), radius: 11 };
}

// ============================================================ enemy: fighter
/** Nose-intake tailed-delta interceptor. */
export function fighter(): ModelGeo {
  const b = new Builder();
  const g = new Builder();
  const hull = '#747a82';
  const under = '#a4a9ae';
  const trim = '#9c2f2a';
  b.add(
    loft(
      [
        { z: -10.6, w: 0.74 },
        { z: -9.6, w: 0.92 },
        { z: -7, w: 1.06, h: 1.08 },
        { z: -4, w: 1.14, h: 1.12 },
        { z: 0, w: 1.14, h: 1.1 },
        { z: 3, w: 1.0, h: 0.98 },
        { z: 4.2, w: 0.94, h: 0.92 },
      ],
      { seg: 22, caps: [false, true] },
    ),
    hull,
    {},
    skin(under),
  );
  b.add(glowDisc(0.72), DARK, { p: [0, 0, -10.2] }, { surf: SURF.matte });
  b.add(
    loft(
      [
        { z: -11.6, w: 0.02 },
        { z: -10.9, w: 0.34 },
        { z: -10.1, w: 0.42 },
      ],
      { seg: 14 },
    ),
    RADOME,
    {},
    smooth(SURF.paint),
  );
  canopy(
    b,
    [
      { z: -8.4, w: 0.03, y: 0.88 },
      { z: -7.6, w: 0.45, h: 0.36, hb: 0.05, y: 0.95 },
      { z: -6.4, w: 0.52, h: 0.44, hb: 0.05, y: 1.0 },
      { z: -5.2, w: 0.36, h: 0.3, hb: 0.05, y: 1.0 },
      { z: -4.6, w: 0.1, h: 0.08, hb: 0.05, y: 1.0 },
    ],
    hull,
    14,
  );
  b.add(
    loft(
      [
        { z: -5.2, w: 0.34, h: 0.3, hb: 0.2, y: 1.0 },
        { z: 2, w: 0.3, h: 0.22, hb: 0.2, y: 0.95 },
        { z: 3.8, w: 0.14, h: 0.08, hb: 0.1, y: 0.85 },
      ],
      { seg: 10 },
    ),
    hull,
    {},
    skin(under),
  );
  const root: WingSection = { x: 0.9, z: -3.6, c: 6.4, y: -0.1, t: 0.045 };
  const tip: WingSection = { x: 6.8, z: 2.2, c: 0.8, y: -0.05, t: 0.04 };
  b.mirror(() => wing([root, tip]), hull, {}, skin(under));
  b.mirror(() => wing([sectionAt(root, tip, 5.7, 0.05), { ...tip, x: 6.83, t: 0.05 }]), trim, {}, smooth());
  b.mirror(
    () =>
      wing([
        { x: 0.8, z: 2.9, c: 2.4, y: -0.1 },
        { x: 3.7, z: 4.4, c: 1.0, y: -0.1, t: 0.04 },
      ]),
    hull,
    {},
    skin(under),
  );
  const fRoot: WingSection = { x: 0, z: 0.6, c: 4.3 };
  const fTip: WingSection = { x: 4.2, z: 3.9, c: 1.3 };
  b.add(vfin([fRoot, fTip]), hull, { p: [0, 0.85, 0] }, skin(under));
  b.add(
    vfin([sectionAt(fRoot, fTip, 2.6, 0.06), sectionAt(fRoot, fTip, 3.3, 0.06)]),
    trim,
    { p: [0, 0.85, 0] },
    smooth(),
  );
  nozzle(b, g, 0, 0, 3.9, 5.0, 0.95, '#ff7a3a');
  aam(b, 3.6, -0.3, 0.8, 2.8, '#c9ccd0');
  return { body: b.build(), glow: g.build(), radius: 10 };
}

// ============================================================= enemy: chaser
/** Heavy twin-engine long-range fighter with widely spaced nacelles and a tail stinger. */
export function chaser(): ModelGeo {
  const b = new Builder();
  const g = new Builder();
  const hull = '#5f6a4c';
  const under = '#a3aa98';
  const trim = '#c9a23a';
  b.add(
    loft(
      [
        { z: -12.4, w: 0.02, y: 0.3 },
        { z: -11.2, w: 0.4, y: 0.28 },
        { z: -9.4, w: 0.75, h: 0.72, y: 0.28 },
        { z: -7.2, w: 0.95, h: 0.95, hb: 0.8, y: 0.35 },
        { z: -5, w: 1.05, h: 1.0, hb: 0.8, y: 0.35 },
        { z: -2, w: 1.6, h: 0.8, hb: 0.6, y: 0.3, n: 2.6 },
        { z: 2, w: 1.5, h: 0.6, hb: 0.45, y: 0.3, n: 2.6 },
        { z: 6, w: 0.6, h: 0.35, y: 0.25 },
        { z: 8.4, w: 0.28, h: 0.24, y: 0.25 },
      ],
      { seg: 22, maxStep: 1 },
    ),
    hull,
    {},
    skin(under, { paint: (p) => (p.z < -11 ? { color: RADOME } : null) }),
  );
  intake(
    b,
    [
      { z: -4.6, x: 1.65, w: 0.75, h: 0.9, y: -0.45, n: 4 },
      { z: -2, x: 1.65, w: 0.85, h: 0.9, y: -0.35, n: 3.5 },
      { z: 3, x: 1.65, w: 0.85, h: 0.8, y: -0.2, n: 2.6 },
      { z: 5.4, x: 1.65, w: 0.8, h: 0.75, y: -0.15 },
    ],
    hull,
    under,
  );
  canopy(
    b,
    [
      { z: -9.2, w: 0.03, y: 1.05 },
      { z: -8.4, w: 0.5, h: 0.4, hb: 0.05, y: 1.12 },
      { z: -7, w: 0.66, h: 0.55, hb: 0.05, y: 1.18 },
      { z: -5.6, w: 0.62, h: 0.5, hb: 0.05, y: 1.16 },
      { z: -4.4, w: 0.4, h: 0.3, hb: 0.05, y: 1.1 },
      { z: -3.8, w: 0.15, h: 0.1, hb: 0.05, y: 1.06 },
    ],
    hull,
    16,
  );
  const root: WingSection = { x: 1.8, z: -2.4, c: 6.6, y: 0.1, t: 0.05 };
  const tip: WingSection = { x: 9.2, z: 3.4, c: 1.6, y: 0.1, t: 0.04 };
  b.mirror(() => wing([root, tip]), hull, {}, skin(under));
  // Leading-edge root extensions.
  b.mirror(
    () =>
      wing([
        { x: 0.8, z: -7, c: 4.8, y: 0.25, t: 0.06 },
        { x: 2.1, z: -2.6, c: 0.8, y: 0.12, t: 0.06 },
      ]),
    hull,
    {},
    skin(under),
  );
  b.mirror(
    () =>
      wing([
        { x: 2.3, z: 4.3, c: 3.0, y: -0.2 },
        { x: 5.6, z: 6.2, c: 1.2, y: -0.2, t: 0.04 },
      ]),
    hull,
    {},
    skin(under),
  );
  const fRoot: WingSection = { x: 0, z: 2.3, c: 3.7 };
  const fTip: WingSection = { x: 4.0, z: 5.4, c: 1.3 };
  b.mirror(() => vfin([fRoot, fTip]), hull, { p: [2.3, 0.3, 0], r: [0, 0, -0.06] }, skin(under));
  b.mirror(
    () => vfin([sectionAt(fRoot, fTip, 3.3, 0.06), { ...fTip, x: 4.02, t: 0.06 }]),
    trim,
    { p: [2.3, 0.3, 0], r: [0, 0, -0.06] },
    smooth(),
  );
  nozzle(b, g, 1.65, -0.15, 5.2, 6.4, 0.8, '#ff7a3a');
  aam(b, 5.0, 0, 1.6, 3.2, '#c9ccd0');
  aam(b, 7.4, 0.05, 3.4, 2.8, '#c9ccd0');
  return { body: b.build(), glow: g.build(), radius: 11 };
}

// ============================================================== enemy: drone
/** Tailless flying-wing combat drone (kept light: up to 96 on screen). */
export function drone(): ModelGeo {
  const b = new Builder();
  const g = new Builder();
  const hull = '#2d2638';
  const under = '#3b3446';
  b.mirror(
    () =>
      wing([
        { x: 0, z: -6.2, c: 9.2, t: 0.11 },
        { x: 1.8, z: -3.9, c: 6.6, t: 0.09 },
        { x: 3.4, z: -1.4, c: 4.0, y: 0.05, t: 0.07 },
        { x: 7.6, z: 2.8, c: 1.3, y: 0.25, t: 0.06 },
      ]),
    hull,
    {},
    skin(under),
  );
  b.add(
    loft(
      [
        { z: -5.2, w: 0.02, y: 0.3 },
        { z: -3.4, w: 0.9, h: 0.55, hb: 0.2, y: 0.35 },
        { z: 0, w: 1.25, h: 0.7, hb: 0.2, y: 0.3 },
        { z: 2.6, w: 0.8, h: 0.35, hb: 0.2, y: 0.2 },
      ],
      { seg: 12 },
    ),
    hull,
    {},
    skin(under),
  );
  // Dorsal intake mouth.
  b.add(new BoxGeometry(1.1, 0.3, 0.05), DARK, { p: [0, 0.78, -2.6], r: [-0.3, 0, 0] }, { surf: SURF.matte });
  g.add(new SphereGeometry(0.45, 8, 6), '#ff3b3b', { p: [0, -0.25, -5.2] });
  g.mirror(() => new BoxGeometry(4.2, 0.16, 0.22), '#ff3b3b', { p: [5.3, 0.28, 0.9], r: [0, -0.785, 0] });
  return { body: b.build(), glow: g.build(), radius: 8 };
}

// ================================================================ enemy: ace
/** Forward-swept-wing canard fighter flown by the aces. */
export function ace(): ModelGeo {
  const b = new Builder();
  const g = new Builder();
  const hull = '#1f2126';
  const under = '#2b2e34';
  const gold = '#d4a640';
  b.add(
    loft(
      [
        { z: -12.6, w: 0.02, y: 0.1 },
        { z: -11.4, w: 0.4, h: 0.38, y: 0.1 },
        { z: -9.4, w: 0.78, h: 0.72, y: 0.15 },
        { z: -7.2, w: 0.98, h: 0.92, hb: 0.8, y: 0.2 },
        { z: -5, w: 1.1, h: 0.95, hb: 0.8, y: 0.18 },
        { z: -3, w: 2.1, h: 0.85, hb: 0.85, y: 0.05, n: 3 },
        { z: 1, w: 2.3, h: 0.8, hb: 0.85, n: 3.4 },
        { z: 4.2, w: 1.9, h: 0.7, hb: 0.72, n: 3 },
        { z: 5.4, w: 1.7, h: 0.62, hb: 0.64, n: 3 },
      ],
      { seg: 24, maxStep: 1 },
    ),
    hull,
    {},
    skin(under, { surf: SURF.gloss }),
  );
  intake(
    b,
    [
      { z: -3.8, x: 1.75, w: 0.55, h: 0.7, y: -0.2, n: 4 },
      { z: -2.4, x: 1.75, w: 0.6, h: 0.75, y: -0.15, n: 4 },
      { z: 0, x: 1.75, w: 0.6, h: 0.7, y: -0.1, n: 3 },
    ],
    hull,
    under,
  );
  canopy(
    b,
    [
      { z: -9.3, w: 0.03, y: 0.78 },
      { z: -8.5, w: 0.48, h: 0.4, hb: 0.05, y: 0.86 },
      { z: -7.2, w: 0.66, h: 0.56, hb: 0.05, y: 0.92 },
      { z: -5.8, w: 0.62, h: 0.52, hb: 0.05, y: 0.9 },
      { z: -4.6, w: 0.4, h: 0.3, hb: 0.05, y: 0.86 },
      { z: -4, w: 0.14, h: 0.1, hb: 0.05, y: 0.82 },
    ],
    gold,
    16,
  );
  const root: WingSection = { x: 1.8, z: -1.0, c: 6.6, y: 0.05, t: 0.05 };
  const tip: WingSection = { x: 9.4, z: -3.9, c: 1.8, y: 0.1, t: 0.04 };
  b.mirror(() => wing([root, tip]), hull, {}, skin(under, { surf: SURF.gloss }));
  b.mirror(
    () => wing([sectionAt(root, tip, 8.2, 0.05), { ...tip, x: 9.43, t: 0.05 }]),
    gold,
    {},
    smooth(SURF.gloss),
  );
  b.mirror(
    () =>
      wing([
        { x: 1.4, z: -7.8, c: 2.6, y: 0.4 },
        { x: 4.0, z: -6.4, c: 1.0, y: 0.45 },
      ]),
    gold,
    {},
    smooth(SURF.gloss),
  );
  const fRoot: WingSection = { x: 0, z: 2.3, c: 3.4 };
  const fTip: WingSection = { x: 3.8, z: 5.0, c: 1.2 };
  b.mirror(
    () => vfin([fRoot, fTip]),
    hull,
    { p: [1.4, 0.45, 0], r: [0, 0, -0.32] },
    skin(under, { surf: SURF.gloss }),
  );
  nozzle(b, g, 0.85, 0, 5.0, 6.2, 0.72, '#ffd36a');
  return { body: b.build(), glow: g.build(), radius: 10 };
}

// ============================================================= heavy: bomber
/** Variable-geometry strategic bomber (wings swept) with blended body. */
export function bomber(): ModelGeo {
  const b = new Builder();
  const g = new Builder();
  const hull = '#5a5f65';
  const under = '#70757b';
  const trim = '#8a2d26';
  const body: Station[] = [
    { z: -28, w: 0.05, y: 0.3 },
    { z: -26, w: 1.1, h: 1.0, y: 0.4 },
    { z: -22, w: 2.2, h: 2.0, y: 0.6 },
    { z: -17, w: 2.9, h: 2.6, hb: 2.2, y: 0.6 },
    { z: -11, w: 3.6, h: 2.8, hb: 2.4, y: 0.5 },
    { z: -3, w: 5.5, h: 2.6, hb: 2.6, y: 0.3, n: 2.6 },
    { z: 5, w: 5.2, h: 2.4, hb: 2.5, y: 0.2, n: 2.6 },
    { z: 12, w: 3.2, h: 2.2, hb: 1.8, y: 0.4 },
    { z: 18, w: 1.8, h: 1.6, hb: 1.2, y: 0.8 },
    { z: 21, w: 0.8, h: 0.6, y: 1.2 },
  ];
  b.add(loft(body, { seg: 26, maxStep: 1 }), hull, {}, skin(under));
  b.add(shell(body, -22.4, -19.4, 0.75, Math.PI - 0.75), GLASS, {}, smooth(SURF.glass));
  // Swept outer wings and the fixed glove.
  b.mirror(
    () =>
      wing([
        { x: 4.5, z: -4.5, c: 10, y: 0.8, t: 0.06 },
        { x: 30, z: 9.5, c: 3.2, y: 1.2, t: 0.045 },
      ]),
    hull,
    {},
    skin(under),
  );
  b.mirror(
    () =>
      wing([
        { x: 3, z: -13, c: 13, y: 0.6, t: 0.07 },
        { x: 6.5, z: -5, c: 9.5, y: 0.75, t: 0.06 },
      ]),
    hull,
    {},
    skin(under),
  );
  // Twin-engine nacelles under the wing roots.
  intake(
    b,
    [
      { z: -2, x: 4.2, w: 2.1, h: 1.05, y: -2.3, n: 5 },
      { z: 4, x: 4.2, w: 2.3, h: 1.15, y: -2.4, n: 5 },
      { z: 10.5, x: 4.2, w: 2.1, h: 1.05, y: -2.4, n: 4 },
    ],
    hull,
    under,
  );
  nozzle(b, g, 3.1, -2.4, 10.2, 11.8, 0.9, '#ff7a3a');
  nozzle(b, g, 5.3, -2.4, 10.2, 11.8, 0.9, '#ff7a3a');
  const fRoot: WingSection = { x: 0, z: 9.5, c: 9.5 };
  const fTip: WingSection = { x: 10.5, z: 17.2, c: 3.6 };
  b.add(vfin([fRoot, fTip], 0.06), hull, { p: [0, 2.2, 0] }, skin(under));
  b.add(
    vfin([sectionAt(fRoot, fTip, 8.2, 0.07), { ...fTip, x: 10.55, t: 0.07 }]),
    trim,
    { p: [0, 2.2, 0] },
    smooth(),
  );
  b.mirror(
    () =>
      wing([
        { x: 0, z: 14.8, c: 5.2 },
        { x: 8.5, z: 18.6, c: 2 },
      ]),
    hull,
    { p: [0, 4.3, 0] },
    skin(under),
  );
  return { body: b.build(), glow: g.build(), radius: 30 };
}

// ============================================================ heavy: gunship
/** Tandem-seat attack helicopter with stub wings and rocket pods. */
export function gunship(): ModelGeo {
  const b = new Builder();
  const g = new Builder();
  const hull = '#4d5a3c';
  const under = '#7a8466';
  b.add(
    loft(
      [
        { z: -8.4, w: 0.05, y: -0.3 },
        { z: -7.6, w: 0.9, h: 0.95, y: -0.25 },
        { z: -5.5, w: 1.35, h: 1.55, y: 0 },
        { z: -2, w: 1.65, h: 1.95, y: 0.2, n: 2.4 },
        { z: 1.5, w: 1.55, h: 1.85, y: 0.3, n: 2.4 },
        { z: 4, w: 0.85, h: 0.95, y: 0.7 },
        { z: 7, w: 0.48, h: 0.52, y: 0.9 },
        { z: 14.2, w: 0.3, h: 0.36, y: 1.05 },
      ],
      { seg: 20, maxStep: 1.2 },
    ),
    hull,
    {},
    skin(under),
  );
  canopy(
    b,
    [
      { z: -7.6, w: 0.05, y: 0.35 },
      { z: -7, w: 0.75, h: 0.6, hb: 0.1, y: 0.5 },
      { z: -5.8, w: 0.95, h: 0.8, hb: 0.1, y: 0.7 },
      { z: -4.6, w: 0.85, h: 0.7, hb: 0.1, y: 0.9 },
      { z: -4.2, w: 0.5, h: 0.4, hb: 0.1, y: 1.1 },
    ],
    hull,
    16,
  );
  canopy(
    b,
    [
      { z: -4.6, w: 0.05, y: 1.35 },
      { z: -4.1, w: 0.8, h: 0.65, hb: 0.1, y: 1.45 },
      { z: -3, w: 0.95, h: 0.8, hb: 0.1, y: 1.6 },
      { z: -1.9, w: 0.85, h: 0.7, hb: 0.1, y: 1.7 },
      { z: -1.4, w: 0.4, h: 0.3, hb: 0.1, y: 1.75 },
    ],
    hull,
    16,
  );
  // Engine pods either side of the rotor mast.
  b.mirror(
    () =>
      loft(
        [
          { z: -1.8, w: 0.02, y: 0 },
          { z: -1.2, w: 0.55, y: 0 },
          { z: 2.4, w: 0.6, h: 0.52, y: 0 },
          { z: 3.3, w: 0.42, h: 0.36, y: 0 },
        ],
        { seg: 14 },
      ),
    hull,
    { p: [1.15, 1.95, 0] },
    skin(under),
  );
  b.mirror(() => glowDisc(0.34), DARK, { p: [1.15, 1.95, 3.32] }, { surf: SURF.soot });
  // Mast, hub and five main rotor blades.
  b.add(cyl(0.32, 0.45, 1.4, 10).rotateX(Math.PI / 2), '#2b2d2f', { p: [0, 2.9, -0.5] }, smooth(SURF.metal));
  b.add(new CylinderGeometry(0.75, 0.75, 0.35, 12), '#2b2d2f', { p: [0, 3.6, -0.5] }, smooth(SURF.metal));
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.3;
    b.add(
      new BoxGeometry(0.55, 0.07, 11.4),
      '#26282a',
      {
        p: [Math.sin(a) * 6.2, 3.62, -0.5 + Math.cos(a) * 6.2],
        r: [0, a, 0],
      },
      { surf: SURF.matte },
    );
  }
  // Tail fin and tail rotor.
  b.add(
    vfin(
      [
        { x: 0, z: 12.3, c: 2.3 },
        { x: 3.6, z: 13.5, c: 1.3 },
      ],
      0.1,
    ),
    hull,
    { p: [0, 1.0, 0] },
    skin(under),
  );
  for (let k = 0; k < 2; k++) {
    b.add(
      new BoxGeometry(0.06, 3.4, 0.36),
      '#26282a',
      { p: [0.42, 3.5, 13.9], r: [k * (Math.PI / 2) + 0.4, 0, 0] },
      { surf: SURF.matte },
    );
  }
  b.mirror(
    () =>
      wing([
        { x: 3.4, z: 12.3, c: 1.8, y: 1.0 },
        { x: 0.3, z: 12.3, c: 1.8, y: 1.0 },
      ]),
    hull,
    {},
    skin(under),
  );
  // Stub wings, rocket pods, chin gun.
  b.mirror(
    () =>
      wing([
        { x: 1.4, z: -1.4, c: 2.4, y: -0.3, t: 0.12 },
        { x: 4.8, z: -1.0, c: 1.7, y: -0.6, t: 0.12 },
      ]),
    hull,
    {},
    skin(under),
  );
  b.mirror(
    () =>
      loft(
        [
          { z: -2.8, w: 0.36 },
          { z: -2.5, w: 0.46 },
          { z: 0.8, w: 0.46 },
          { z: 1.2, w: 0.2 },
        ],
        { seg: 12, caps: [true, true] },
      ),
    '#2f3326',
    { p: [3.6, -1.15, 0] },
    smooth(SURF.paint),
  );
  b.add(cyl(0.1, 0.1, 2.2, 6), '#2b2b2b', { p: [0, -1.25, -7.6] }, smooth(SURF.metal));
  b.add(new SphereGeometry(0.4, 10, 6), '#2b2d2f', { p: [0, -1.0, -6.6] }, smooth(SURF.metal));
  g.mirror(() => new SphereGeometry(0.3, 6, 4), '#ff3b3b', { p: [3.6, -1.15, -2.85] });
  return { body: b.build(), glow: g.build(), radius: 14 };
}

// ============================================================= heavy: AWACS
/** Four-engine airliner-based radar picket with a rotodome. */
export function awacs(): ModelGeo {
  const b = new Builder();
  const g = new Builder();
  const hull = '#c4c7c0';
  const under = '#b3b6b0';
  const body: Station[] = [
    { z: -28.5, w: 0.05, y: -0.45 },
    { z: -27.6, w: 1.4, y: -0.3 },
    { z: -25.2, w: 2.6, h: 2.7, y: 0 },
    { z: -21, w: 3.2, h: 3.3, y: 0 },
    { z: 10, w: 3.2, h: 3.3, y: 0 },
    { z: 16, w: 2.4, h: 2.5, y: 0.6 },
    { z: 21, w: 0.8, h: 0.9, y: 1.8 },
    { z: 22, w: 0.2, y: 2.1 },
  ];
  b.add(loft(body, { seg: 28, maxStep: 0.6 }), hull, {}, skin(under));
  b.mirror(() => shell(body, -26.6, -25.4, 0.3, 1.35), GLASS, {}, smooth(SURF.glass));
  b.mirror(
    () =>
      wing([
        { x: 3, z: -6.5, c: 10.5, y: -1.9, t: 0.1 },
        { x: 13, z: 0.8, c: 5.4, y: -1.3, t: 0.09 },
        { x: 28.5, z: 9.4, c: 2.4, y: 0.2, t: 0.08 },
      ]),
    hull,
    {},
    skin(under),
  );
  turbofan(b, 9.2, -3.2, -5.2, 1.0, hull);
  turbofan(b, 17.2, -2.3, -0.8, 1.0, hull);
  b.add(
    vfin(
      [
        { x: 0, z: 11.8, c: 8.6 },
        { x: 10, z: 19.4, c: 3.1 },
      ],
      0.09,
    ),
    hull,
    { p: [0, 2.4, 0] },
    skin(under),
  );
  b.mirror(
    () =>
      wing([
        { x: 0.8, z: 14.3, c: 5.6, y: 1.0 },
        { x: 10, z: 19.4, c: 2.2, y: 1.4 },
      ]),
    hull,
    {},
    skin(under),
  );
  // Rotodome on twin struts.
  b.mirror(
    () =>
      vfin(
        [
          { x: 0, z: 2.6, c: 3.4 },
          { x: 3.4, z: 3.2, c: 2.6 },
        ],
        0.14,
      ),
    hull,
    { p: [0.9, 2.9, 0], r: [0, 0, -0.12] },
    smooth(),
  );
  const dome = () =>
    loft(
      [
        { z: -0.95, w: 3 },
        { z: -0.8, w: 8.4 },
        { z: -0.45, w: 9 },
        { z: 0.45, w: 9 },
        { z: 0.8, w: 8.4 },
        { z: -0.95 + 1.9, w: 3 },
      ],
      { seg: 36 },
    ).rotateX(Math.PI / 2);
  b.add(dome(), '#3a3f47', { p: [0, 7.2, 4.2] }, smooth(SURF.gloss));
  b.add(
    loft(
      [
        { z: -0.3, w: 9.05 },
        { z: 0.3, w: 9.05 },
      ],
      { seg: 36, caps: [false, false] },
    ).rotateX(Math.PI / 2),
    '#d8b024',
    { p: [0, 7.2, 4.2] },
    smooth(SURF.gloss),
  );
  g.mirror(() => new SphereGeometry(0.7, 6, 4), '#ffd84a', { p: [28.6, 0.2, 10.2] });
  return { body: b.build(), glow: g.build(), radius: 30 };
}

// ============================================================ support: tanker
/** Twin-engine airliner-based tanker with a flying refuelling boom. */
export function tanker(): ModelGeo {
  const b = new Builder();
  const g = new Builder();
  const hull = '#d6dade';
  const under = '#c3c8cd';
  const tail = '#2f7bd9';
  const body: Station[] = [
    { z: -33.2, w: 0.05, y: -0.45 },
    { z: -32.2, w: 1.5, y: -0.3 },
    { z: -29.2, w: 3.0, h: 3.1, y: 0 },
    { z: -25, w: 3.7, h: 3.8, y: 0 },
    { z: 12, w: 3.7, h: 3.8, y: 0 },
    { z: 19, w: 2.6, h: 2.6, y: 0.9 },
    { z: 24.5, w: 0.9, h: 1.0, y: 2.4 },
    { z: 25.5, w: 0.2, y: 2.7 },
  ];
  b.add(loft(body, { seg: 28, maxStep: 0.6 }), hull, {}, skin(under));
  b.mirror(() => shell(body, -31.4, -30.0, 0.3, 1.35), GLASS, {}, smooth(SURF.glass));
  b.mirror(
    () =>
      wing([
        { x: 3.2, z: -9.5, c: 12.5, y: -2.4, t: 0.11 },
        { x: 14, z: -1.2, c: 6.3, y: -1.7, t: 0.09 },
        { x: 34, z: 9.2, c: 2.4, y: 0.2, t: 0.08 },
      ]),
    hull,
    {},
    skin(under),
  );
  turbofan(b, 11.2, -4.6, -9.6, 1.6, hull);
  b.add(
    vfin(
      [
        { x: 0, z: 13.6, c: 10.2 },
        { x: 11.5, z: 22.4, c: 3.6 },
      ],
      0.09,
    ),
    tail,
    { p: [0, 3.2, 0] },
    smooth(),
  );
  b.mirror(
    () =>
      wing([
        { x: 1, z: 16.8, c: 6.2, y: 1.2 },
        { x: 12, z: 23, c: 2.4, y: 1.7 },
      ]),
    hull,
    {},
    skin(under),
  );
  // Refuelling boom trailing down and back toward the jet (tip must stay at the refuel point).
  b.add(cyl(0.5, 0.7, 26, 10), '#9aa2ab', { p: [0, -8, 32], r: [0.55, 0, 0] }, smooth(SURF.metal));
  b.add(
    loft(
      [
        { z: -1.2, w: 0.02 },
        { z: 0, w: 1.4, h: 1.0 },
        { z: 2.4, w: 1.1, h: 0.8 },
      ],
      { seg: 12 },
    ),
    '#9aa2ab',
    { p: [0, -0.6, 20.4] },
    smooth(SURF.metal),
  );
  b.mirror(
    () =>
      wing([
        { x: 0.4, z: -1, c: 2.2 },
        { x: 3.2, z: -0.2, c: 1.2 },
      ]),
    '#9aa2ab',
    { p: [0, -13.6, 40.5], r: [0.55, 0, -0.5] },
    smooth(SURF.metal),
  );
  b.add(
    new CylinderGeometry(1.4, 0.5, 2.4, 10),
    '#9aa2ab',
    { p: [0, -15.5, 43.5], r: [-1.02, 0, 0] },
    smooth(SURF.metal),
  );
  g.add(new SphereGeometry(0.9, 8, 6), '#7fe9ff', { p: [0, -16.3, 44.8] });
  g.mirror(() => new SphereGeometry(0.8, 6, 4), '#ff3030', { p: [34.1, 0.2, 10.4] });
  return { body: b.build(), glow: g.build(), radius: 36 };
}

// ======================================================= boss: stealth "Wraith"
/** Blended flying-wing stealth bomber with a sawtooth trailing edge. */
export function stealth(): ModelGeo {
  const b = new Builder();
  const g = new Builder();
  const skinC = '#23252c';
  const under = '#1c1e24';
  const le = 42 / 46; // leading-edge slope (z per unit span)
  const sec = (x: number, te: number, t: number, y = 0): WingSection => ({
    x,
    z: -34 + x * le,
    c: te - (-34 + x * le),
    t,
    y,
  });
  b.mirror(
    () =>
      wing([
        sec(0, 18, 0.1),
        sec(10, 10, 0.09, 0.2),
        sec(20, 16, 0.07, 0.4),
        sec(30, 8, 0.08, 0.6),
        sec(40, 14, 0.07, 0.8),
        { x: 46, z: 8, c: 1.2, t: 0.06, y: 0.9 },
      ]),
    skinC,
    {},
    skin(under, { surf: SURF.gloss }),
  );
  const hump: Station[] = [
    { z: -31, w: 0.2, h: 0.1, y: 1.0 },
    { z: -25, w: 4, h: 2.0, hb: 0.5, y: 1.4 },
    { z: -15, w: 7, h: 3.2, hb: 0.5, y: 1.6 },
    { z: 0, w: 9, h: 2.8, hb: 0.5, y: 1.4 },
    { z: 10, w: 7, h: 1.5, hb: 0.5, y: 1.0 },
    { z: 16, w: 3, h: 0.5, hb: 0.4, y: 0.8 },
  ];
  b.add(loft(hump, { seg: 28, maxStep: 1 }), skinC, {}, skin(under, { surf: SURF.gloss }));
  // Cockpit glazing: two panes either side of a centre post.
  b.mirror(() => shell(hump, -23.4, -20.6, 1.12, 1.5, { lift: 0.05 }), '#0c0d10', {}, smooth(SURF.glass));
  // Engine humps with serpentine intakes; exhaust troughs on top.
  intake(
    b,
    [
      { z: -9, x: 7.2, w: 2.2, h: 1.1, hb: 0.3, y: 2.2, n: 3 },
      { z: 0, x: 7.2, w: 2.6, h: 1.5, hb: 0.3, y: 2.3, n: 3 },
      { z: 10, x: 7.2, w: 2.0, h: 0.5, hb: 0.3, y: 1.4, n: 3 },
    ],
    skinC,
    under,
  );
  b.mirror(
    () =>
      plate(
        [
          [4.5, 10],
          [10, 10],
          [10.6, 13.5],
          [4, 13.5],
        ],
        0.1,
      ),
    '#121316',
    { p: [0, 0.42, 0] },
    { surf: SURF.soot },
  );
  g.mirror(() => new BoxGeometry(15, 0.3, 0.3), '#b36cff', { p: [24, 0.8, -11.6], r: [0, -0.74, 0] });
  g.add(new BoxGeometry(8, 0.35, 0.35), '#b36cff', { p: [0, 4.6, -8] });
  return { body: b.build(), glow: g.build(), radius: 48 };
}

// ================================================================== missiles
export function missile(enemy: boolean): ModelGeo {
  const b = new Builder();
  const body = enemy ? '#3b3b3b' : '#e8e8e8';
  const tip = enemy ? '#d23b1f' : '#9aa4b4';
  b.add(
    loft(
      [
        { z: -2.6, w: 0.45 },
        { z: 2.5, w: 0.45 },
        { z: 2.8, w: 0.36 },
      ],
      { seg: 12 },
    ),
    body,
    {},
    smooth(SURF.gloss),
  );
  b.add(
    loft(
      [
        { z: -4, w: 0.02 },
        { z: -3.4, w: 0.26 },
        { z: -2.6, w: 0.45 },
      ],
      { seg: 12 },
    ),
    tip,
    {},
    smooth(SURF.gloss),
  );
  // Cruciform swept mid-body wings and tail fins.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    for (const [z, span, c] of [
      [-0.9, 0.5, 1.3],
      [1.5, 0.75, 1.1],
    ]) {
      b.add(
        wing([
          { x: 0.3, z, c, t: 0.08 },
          { x: 0.45 + span, z: z + c * 0.6, c: c * 0.35, t: 0.08 },
        ]),
        body,
        { r: [0, 0, a] },
        smooth(SURF.gloss),
      );
    }
  }
  const glow = new Builder().add(new SphereGeometry(0.42, 10, 8), enemy ? '#ff6a1f' : '#9fe8ff', {
    p: [0, 0, 2.9],
    s: [1, 1, 1.8],
  });
  return { body: b.build(), glow: glow.build(), radius: 4.2 };
}
