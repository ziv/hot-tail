import { BoxGeometry, ConeGeometry, CylinderGeometry, SphereGeometry, TorusGeometry } from 'three';
import { Builder, cone, cyl, fin, plate, type ModelGeo } from './models';

/**
 * M3 procedural models: alternate player jets, heavy air (bomber, gunship,
 * AWACS), ground (SAM, AA gun, tank), naval (destroyer, missile boat), the
 * Boss 2 carrier group and the refuelling tanker. Noses point down -Z.
 */
const glowDisc = (r: number) => new CylinderGeometry(r, r, 0.2, 10).rotateX(Math.PI / 2);

// -------------------------------------------------------------- player jets
export function playerDart(): ModelGeo {
  const b = new Builder();
  const hull = '#d8d4c8';
  const accent = '#e0453a';
  b.add(cone(0.95, 6), hull, { p: [0, 0.1, -10.5] });
  b.add(cyl(1.35, 0.95, 6), hull, { p: [0, 0.1, -4.6] });
  b.add(cyl(1.45, 1.35, 6), hull, { p: [0, 0, 1.4] });
  b.add(new SphereGeometry(1, 10, 6), '#241a12', { p: [0, 1.0, -5.8], s: [0.75, 0.7, 2.6] });
  // Cranked delta
  b.mirror(
    () =>
      plate([
        [0.8, -6],
        [3.2, -1],
        [7.4, 3.6],
        [7.4, 4.6],
        [0.8, 4.8],
      ]),
    hull,
    {},
  );
  b.mirror(
    () =>
      plate(
        [
          [2.6, -2],
          [3.2, -1],
          [6.2, 2.4],
          [5.4, 2.8],
        ],
        0.34,
      ),
    accent,
    {},
  );
  b.add(
    fin([
      [3.4, 0],
      [7, 5],
      [8.2, 5],
      [8, 0],
    ]),
    accent,
    { p: [0, 1, 0] },
  );
  b.add(cyl(1.05, 1.15, 1.6, 10), '#39414f', { p: [0, 0, 5.2] });
  const glow = new Builder().add(glowDisc(0.8), '#ffb266', { p: [0, 0, 6.05] });
  return { body: b.build(), glow: glow.build(), radius: 9 };
}

export function playerManta(): ModelGeo {
  const b = new Builder();
  const hull = '#8e9aa8';
  const dark = '#2c333d';
  const accent = '#3ad0a8';
  b.add(cone(1.4, 4.5), hull, { p: [0, 0.2, -10] });
  b.add(new BoxGeometry(4.2, 2.2, 12), hull, { p: [0, 0, -2] });
  b.add(new SphereGeometry(1, 10, 6), '#10231e', { p: [0, 1.4, -6], s: [0.9, 0.7, 2.4] });
  // Broad flying-wing body
  b.mirror(
    () =>
      plate(
        [
          [2, -6],
          [10, 2],
          [10, 4.4],
          [7, 5.4],
          [2, 5.6],
        ],
        0.6,
      ),
    hull,
    {},
  );
  b.mirror(
    () =>
      plate(
        [
          [7.5, 0],
          [10, 2],
          [10, 4.4],
          [8.5, 4.8],
        ],
        0.64,
      ),
    accent,
    {},
  );
  b.mirror(
    () =>
      fin([
        [4, 0],
        [6.6, 3.6],
        [7.8, 3.6],
        [7.6, 0],
      ]),
    dark,
    { p: [2.6, 1, 0], r: [0, 0, -0.45] },
  );
  b.mirror(() => cyl(1.1, 1.2, 2, 10), dark, { p: [1.3, 0, 5.4] });
  const glow = new Builder().mirror(() => glowDisc(0.85), '#ffb266', { p: [1.3, 0, 6.45] });
  return { body: b.build(), glow: glow.build(), radius: 11 };
}

// --------------------------------------------------------------- heavy air
export function bomber(): ModelGeo {
  const b = new Builder();
  const hull = '#5d6166';
  const trim = '#8a2d26';
  b.add(cone(3, 7), hull, { p: [0, 0, -24] });
  b.add(cyl(3.4, 3, 38), hull, { p: [0, 0, -1] });
  b.add(new SphereGeometry(1, 8, 6), '#1c1c1c', { p: [0, 2.2, -19], s: [2, 1.2, 3] });
  b.mirror(
    () =>
      plate(
        [
          [3, -6],
          [30, 4],
          [30, 8],
          [3, 6],
        ],
        1.2,
      ),
    hull,
    { p: [0, 0.5, 0] },
  );
  b.mirror(() => cyl(1.6, 1.6, 8, 8), '#3f4247', { p: [11, -1.5, 0] });
  b.mirror(() => cyl(1.6, 1.6, 8, 8), '#3f4247', { p: [20, -1, 3] });
  b.add(
    fin([
      [12, 0],
      [18, 10],
      [21, 10],
      [20, 0],
    ]),
    trim,
    { p: [0, 2.5, 0] },
  );
  b.mirror(
    () =>
      plate([
        [1, 14],
        [9, 18],
        [9, 20],
        [1, 19],
      ]),
    hull,
    { p: [0, 1, 0] },
  );
  const glow = new Builder()
    .mirror(() => glowDisc(1.1), '#ff7a3a', { p: [11, -1.5, 4.1] })
    .mirror(() => glowDisc(1.1), '#ff7a3a', { p: [20, -1, 7.1] });
  return { body: b.build(), glow: glow.build(), radius: 30 };
}

export function gunship(): ModelGeo {
  const b = new Builder();
  const hull = '#4d5a3c';
  b.add(new SphereGeometry(1, 10, 8), hull, { p: [0, 0, -2], s: [3, 3, 6] });
  b.add(new SphereGeometry(1, 8, 6), '#1b2410', { p: [0, 0.8, -6.5], s: [2.2, 1.6, 2] });
  b.add(cyl(0.9, 1.6, 12), hull, { p: [0, 0.6, 8] });
  b.add(
    fin([
      [12, 0],
      [13, 4.5],
      [15, 4.5],
      [14.5, 0],
    ]),
    hull,
    { p: [0, 1, 0] },
  );
  // Stub wings with rocket pods
  b.mirror(() => new BoxGeometry(5, 0.4, 2), hull, { p: [4, -0.5, -1] });
  b.mirror(() => cyl(0.7, 0.7, 4, 8), '#2b2b2b', { p: [6.2, -1, -1] });
  // Rotor (a flat disc reads as a spinning blur at speed)
  b.add(new CylinderGeometry(12, 12, 0.15, 20), '#26282a', { p: [0, 3.6, -1] });
  b.add(new CylinderGeometry(0.5, 0.5, 1.6, 8), '#26282a', { p: [0, 2.8, -1] });
  const glow = new Builder().mirror(() => new SphereGeometry(0.35, 6, 4), '#ff3b3b', { p: [6.2, -1, -3.1] });
  return { body: b.build(), glow: glow.build(), radius: 14 };
}

export function awacs(): ModelGeo {
  const b = new Builder();
  const hull = '#c7c9c2';
  b.add(cone(3, 6), hull, { p: [0, 0, -25] });
  b.add(cyl(3.3, 3, 42), hull, { p: [0, 0, 0] });
  b.mirror(
    () =>
      plate(
        [
          [3, -6],
          [28, 5],
          [28, 8.5],
          [3, 6],
        ],
        1,
      ),
    hull,
    { p: [0, -0.5, 0] },
  );
  b.add(
    fin([
      [14, 0],
      [19, 10],
      [22, 10],
      [21, 0],
    ]),
    hull,
    { p: [0, 2.5, 0] },
  );
  // Rotodome
  b.add(new CylinderGeometry(9, 9, 1.6, 20), '#3a3f47', { p: [0, 7, 6] });
  b.add(new BoxGeometry(1, 3.4, 4), hull, { p: [0, 4.6, 6] });
  b.add(new CylinderGeometry(9.1, 9.1, 0.6, 20, 1, true), '#d8b024', { p: [0, 7, 6] });
  const glow = new Builder().mirror(() => new SphereGeometry(0.8, 6, 4), '#ffd84a', { p: [28, -0.3, 6.5] });
  return { body: b.build(), glow: glow.build(), radius: 30 };
}

// ------------------------------------------------------------------ ground
export function sam(): ModelGeo {
  const b = new Builder();
  const green = '#6b6a44';
  b.add(new BoxGeometry(9, 2.5, 12), green, { p: [0, 1.2, 0] });
  for (const x of [-1.8, 1.8])
    b.add(new BoxGeometry(2.8, 2.8, 10), '#57563a', { p: [x, 5, 0], r: [-0.6, 0, 0] });
  for (const x of [-1.8, 1.8]) b.add(cone(0.9, 1.4, 6), '#c9c9b8', { p: [x, 8.6, -5.4], r: [-0.6, 0, 0] });
  const glow = new Builder().add(new BoxGeometry(1, 0.6, 1), '#ff3b3b', { p: [0, 2.8, 5.8] });
  return { body: b.build(), glow: glow.build(), radius: 8 };
}

export function aaa(): ModelGeo {
  const b = new Builder();
  b.add(new CylinderGeometry(4, 5, 2, 8), '#6e6650', { p: [0, 1, 0] });
  b.add(new SphereGeometry(3, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#8a7f63', { p: [0, 2, 0] });
  for (const x of [-1, 1]) b.add(cyl(0.35, 0.35, 8), '#2a2a2a', { p: [x, 4.4, -4], r: [-0.7, 0, 0] });
  const glow = new Builder().add(new SphereGeometry(0.6, 6, 4), '#ffb84a', { p: [0, 7, -7] });
  return { body: b.build(), glow: glow.build(), radius: 6 };
}

export function tank(): ModelGeo {
  const b = new Builder();
  const sand = '#8f7b52';
  b.add(new BoxGeometry(5, 1.6, 8), sand, { p: [0, 1.2, 0] });
  for (const x of [-2.8, 2.8]) b.add(new BoxGeometry(1.2, 1.8, 8.6), '#2c2a24', { p: [x, 0.9, 0] });
  b.add(new CylinderGeometry(1.8, 2.1, 1.3, 8), '#7d6b46', { p: [0, 2.6, 0.6] });
  b.add(cyl(0.3, 0.3, 6), '#2c2a24', { p: [0, 2.7, -3.6] });
  return { body: b.build(), radius: 5 };
}

// ------------------------------------------------------------------- naval
export function destroyer(): ModelGeo {
  const b = new Builder();
  const grey = '#6d7680';
  b.add(new BoxGeometry(12, 5, 76), grey, { p: [0, 2.5, 0] });
  b.add(cone(6, 16, 4), grey, { p: [0, 2.5, -46], r: [0, 0, Math.PI / 4], s: [1, 0.6, 1] });
  b.add(new BoxGeometry(12.4, 0.4, 76), '#3b4148', { p: [0, 5.2, 0] });
  b.add(new BoxGeometry(8, 7, 16), '#808a94', { p: [0, 8.5, -4] });
  b.add(new BoxGeometry(5, 5, 6), '#808a94', { p: [0, 14, -6] });
  b.add(new CylinderGeometry(0.4, 0.4, 10, 6), '#3b4148', { p: [0, 20, -6] });
  b.add(new CylinderGeometry(2.4, 2.4, 6, 8), '#5a626b', { p: [0, 8, 10] });
  for (const z of [-24, 26]) {
    b.add(new CylinderGeometry(2.4, 2.8, 2, 8), '#5a626b', { p: [0, 6.2, z] });
    b.add(cyl(0.4, 0.4, 7), '#2c3035', { p: [0, 7, z - 4] });
  }
  const glow = new Builder().add(new BoxGeometry(6, 0.6, 0.6), '#9fe8ff', { p: [0, 11, -12.1] });
  return { body: b.build(), glow: glow.build(), radius: 40 };
}

export function missileBoat(): ModelGeo {
  const b = new Builder();
  const grey = '#78807a';
  b.add(new BoxGeometry(6, 2.6, 26), grey, { p: [0, 1.3, 0] });
  b.add(cone(3, 8, 4), grey, { p: [0, 1.3, -17], r: [0, 0, Math.PI / 4], s: [1, 0.6, 1] });
  b.add(new BoxGeometry(4, 3.5, 7), '#8d958f', { p: [0, 4.2, -2] });
  for (const x of [-1.8, 1.8])
    b.add(new BoxGeometry(1.4, 1.4, 6), '#4a504b', { p: [x, 3.4, 7], r: [-0.25, 0, 0] });
  const glow = new Builder().add(new BoxGeometry(3, 0.4, 0.4), '#ff3b3b', { p: [0, 6.1, -5.6] });
  return { body: b.build(), glow: glow.build(), radius: 14 };
}

export function carrier(): ModelGeo {
  const b = new Builder();
  const grey = '#5f6770';
  b.add(new BoxGeometry(56, 14, 280), grey, { p: [0, 3, 0] });
  b.add(cone(28, 40, 4), grey, { p: [0, 3, -160], r: [0, 0, Math.PI / 4], s: [1, 0.5, 1] });
  // Flight deck with angled section and markings
  b.add(new BoxGeometry(72, 1.2, 300), '#3a3f45', { p: [-4, 10.6, -4] });
  b.add(new BoxGeometry(1.2, 0.2, 280), '#e8e2c8', { p: [-4, 11.3, 0] });
  b.add(new BoxGeometry(30, 0.2, 1.2), '#e8e2c8', { p: [-8, 11.3, 60] });
  b.add(new BoxGeometry(30, 0.2, 1.2), '#e8e2c8', { p: [-8, 11.3, -60] });
  for (let i = 0; i < 6; i++) b.add(new BoxGeometry(8, 1.6, 12), '#4d555e', { p: [-24, 12, -120 + i * 20] });
  const glow = new Builder()
    .add(new BoxGeometry(0.8, 0.3, 270), '#ffd36a', { p: [-38, 11.4, -4] })
    .add(new BoxGeometry(0.8, 0.3, 270), '#ffd36a', { p: [30, 11.4, -4] });
  return { body: b.build(), glow: glow.build(), radius: 150 };
}

export function bossSam(): ModelGeo {
  const b = new Builder();
  b.add(new BoxGeometry(12, 3, 12), '#555d66', {});
  for (let i = 0; i < 4; i++) {
    const x = (i % 2) * 4 - 2;
    const y = Math.floor(i / 2) * 3.4 + 3;
    b.add(cyl(1.3, 1.3, 9, 8), '#767f89', { p: [x, y, 0], r: [-0.5, 0, 0] });
  }
  const glow = new Builder().add(new SphereGeometry(1.4, 8, 6), '#ff5030', { p: [0, 3, -6] });
  return { body: b.build(), glow: glow.build(), radius: 12 };
}

export function bossBridge(): ModelGeo {
  const b = new Builder();
  const grey = '#6f7883';
  b.add(new BoxGeometry(14, 16, 40), grey, { p: [0, 8, 0] });
  b.add(new BoxGeometry(12, 6, 18), '#808a94', { p: [0, 19, -6] });
  b.add(new CylinderGeometry(0.6, 0.6, 16, 6), '#2c3035', { p: [0, 30, -6] });
  b.add(new TorusGeometry(4, 0.5, 6, 12), '#2c3035', { p: [0, 34, -6], r: [Math.PI / 2, 0, 0] });
  const glow = new Builder()
    .add(new BoxGeometry(12.2, 1.4, 0.6), '#9fe8ff', { p: [0, 20, -15.4] })
    .add(new SphereGeometry(2.2, 8, 6), '#ff3355', { p: [0, 26, -6] });
  return { body: b.build(), glow: glow.build(), radius: 20 };
}

// ----------------------------------------------------------------- support
export function tanker(): ModelGeo {
  const b = new Builder();
  const hull = '#d9dde2';
  b.add(cone(3.4, 8), hull, { p: [0, 0, -30] });
  b.add(cyl(3.8, 3.4, 48), hull, { p: [0, 0, -2] });
  b.mirror(
    () =>
      plate(
        [
          [3, -8],
          [34, 4],
          [34, 8],
          [3, 6],
        ],
        1.2,
      ),
    hull,
    { p: [0, -0.5, 0] },
  );
  b.mirror(() => cyl(1.8, 1.8, 9, 10), '#8c939b', { p: [13, -2.4, -2] });
  b.add(
    fin([
      [16, 0],
      [22, 11],
      [26, 11],
      [25, 0],
    ]),
    '#2f7bd9',
    { p: [0, 3, 0] },
  );
  // Refuelling boom trailing down and back toward the jet.
  b.add(cyl(0.5, 0.7, 26, 8), '#9aa2ab', { p: [0, -8, 32], r: [0.55, 0, 0] });
  b.add(new ConeGeometry(1.4, 2.4, 8), '#9aa2ab', { p: [0, -15.5, 43.5], r: [-1.02, 0, 0] });
  const glow = new Builder()
    .add(new SphereGeometry(0.9, 8, 6), '#7fe9ff', { p: [0, -16.3, 44.8] })
    .mirror(() => new SphereGeometry(0.8, 6, 4), '#ff3030', { p: [34, -0.3, 6.5] });
  return { body: b.build(), glow: glow.build(), radius: 36 };
}
