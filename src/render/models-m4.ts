import { BoxGeometry, CylinderGeometry, IcosahedronGeometry, SphereGeometry, TorusGeometry } from 'three';
import { Builder, cyl, type ModelGeo } from './models';

/** M4 procedural models: Boss 3 "Wraith" parts and the Boss 4 orbital platform "Halo" (the Wraith airframe is in models-aircraft.ts). */
const glowDisc = (r: number) => new CylinderGeometry(r, r, 0.3, 12).rotateX(Math.PI / 2);

export function bossJet(): ModelGeo {
  const b = new Builder();
  b.add(cyl(4, 5, 12, 10), '#2b2d33', {});
  const glow = new Builder().add(glowDisc(3.6), '#c28bff', { p: [0, 0, 6.2] });
  return { body: b.build(), glow: glow.build(), radius: 8 };
}

export function bossBay(): ModelGeo {
  const b = new Builder();
  b.add(new BoxGeometry(12, 3, 16), '#30323a', {});
  for (const x of [-3.5, 3.5]) b.add(new BoxGeometry(2.5, 1.5, 12), '#4a4d57', { p: [x, -2, 0] });
  const glow = new Builder().add(new BoxGeometry(8, 0.4, 12), '#ff3b6a', { p: [0, -1.7, 0] });
  return { body: b.build(), glow: glow.build(), radius: 9 };
}

export function bossCockpit(): ModelGeo {
  const b = new Builder();
  b.add(new SphereGeometry(1, 10, 6), '#15171c', { s: [5, 2.4, 8] });
  const glow = new Builder().add(new SphereGeometry(1, 8, 6), '#b36cff', { p: [0, 1.4, -1], s: [3.2, 1, 5] });
  return { body: b.build(), glow: glow.build(), radius: 8 };
}

export function orbital(): ModelGeo {
  const b = new Builder();
  const hull = '#b9bec6';
  const dark = '#5b616a';
  // The ring faces the player (disc in the XY plane).
  b.add(new TorusGeometry(118, 7, 8, 48), hull, {});
  b.add(new TorusGeometry(118, 2, 4, 48), dark, { p: [0, 0, 6] });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    b.add(new BoxGeometry(110, 4, 4), dark, { p: [Math.cos(a) * 60, Math.sin(a) * 60, 0], r: [0, 0, a] });
  }
  b.add(new CylinderGeometry(34, 34, 18, 12).rotateX(Math.PI / 2), hull, {});
  b.add(new CylinderGeometry(20, 28, 20, 12).rotateX(Math.PI / 2), dark, { p: [0, 0, -18] });
  const glow = new Builder().add(new TorusGeometry(118, 1.2, 4, 64), '#8fd8ff', { p: [0, 0, 7.5] });
  return { body: b.build(), glow: glow.build(), radius: 130 };
}

export function bossPanel(): ModelGeo {
  const b = new Builder();
  b.add(new BoxGeometry(36, 20, 1.5), '#2c3f7a', {});
  b.add(new BoxGeometry(36.5, 0.8, 1.8), '#c9ced6', {});
  b.add(new BoxGeometry(0.8, 20.5, 1.8), '#c9ced6', {});
  b.add(new SphereGeometry(5, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#8a9098', {
    p: [0, 0, 1],
    r: [Math.PI / 2, 0, 0],
  });
  b.add(cyl(0.8, 0.8, 9), '#2a2d31', { p: [0, 0, 7] });
  const glow = new Builder().add(new SphereGeometry(1.4, 6, 4), '#ffb84a', { p: [0, 0, 11.5] });
  return { body: b.build(), glow: glow.build(), radius: 18 };
}

export function bossSilo(): ModelGeo {
  const b = new Builder();
  b.add(new CylinderGeometry(9, 11, 12, 10).rotateX(Math.PI / 2), '#8a9098', {});
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    b.add(cyl(1.6, 1.6, 6, 8), '#3d4148', { p: [Math.cos(a) * 4.5, Math.sin(a) * 4.5, 8] });
  }
  const glow = new Builder().add(glowDisc(2.6), '#ff5030', { p: [0, 0, 7] });
  return { body: b.build(), glow: glow.build(), radius: 14 };
}

export function bossReactor(): ModelGeo {
  const b = new Builder();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.add(new BoxGeometry(4, 24, 5), '#4a4f58', {
      p: [Math.cos(a) * 17, Math.sin(a) * 17, 4],
      r: [0, 0, a + Math.PI / 2],
    });
  }
  const glow = new Builder().add(new IcosahedronGeometry(13, 2), '#6fe8ff', { p: [0, 0, 6] });
  return { body: b.build(), glow: glow.build(), radius: 20 };
}
