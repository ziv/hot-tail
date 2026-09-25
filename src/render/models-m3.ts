import { BoxGeometry, CylinderGeometry, SphereGeometry, TorusGeometry } from 'three';
import { Builder, cone, cyl, type ModelGeo } from './models';

/**
 * M3 procedural models: ground (SAM, AA gun, tank), naval (destroyer, missile
 * boat) and the Boss 2 carrier group. Aircraft live in models-aircraft.ts.
 */

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
