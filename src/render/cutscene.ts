import {
  Group,
  Mesh,
  MeshBasicMaterial,
  Color,
  Quaternion,
  Vector3,
  Euler,
  type MeshStandardMaterial,
  type PerspectiveCamera,
} from 'three';
import { MODEL_FACTORIES } from './registry';
import { PlayerView } from './entities';

/**
 * Take-off and landing cutscenes (F16): a scripted jet, the home carrier and a
 * camera path, played in their own little sea-level frame. Skippable.
 */
export type CutsceneId = 'takeoff' | 'landing';

interface Key {
  t: number;
  pos: [number, number, number];
  look: [number, number, number];
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const _a = new Vector3();
const _b = new Vector3();
const _e = new Euler();

/** Piecewise camera path with smoothstepped segments. */
function sampleKeys(keys: Key[], t: number, pos: Vector3, look: Vector3): void {
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const k0 = keys[i];
  const k1 = keys[Math.min(i + 1, keys.length - 1)];
  const u = k1.t > k0.t ? smooth(Math.min(1, Math.max(0, (t - k0.t) / (k1.t - k0.t)))) : 1;
  pos.set(...k0.pos).lerp(_a.set(...k1.pos), u);
  look.set(...k0.look).lerp(_b.set(...k1.look), u);
}

export class Cutscene {
  readonly group = new Group();
  private readonly carrier: Group;
  private readonly jet: PlayerView;
  private id: CutsceneId = 'takeoff';
  time = 0;
  duration = 0;
  active = false;
  private readonly look = new Vector3();
  /** Carrier sails at a steady clip so the sea scrolls under it. */
  readonly seaSpeed = 18;

  constructor(bodyMat: MeshStandardMaterial) {
    const geo = MODEL_FACTORIES.carrier();
    this.carrier = new Group();
    this.carrier.add(new Mesh(geo.body, bodyMat));
    if (geo.glow)
      this.carrier.add(
        new Mesh(geo.glow, new MeshBasicMaterial({ vertexColors: true, color: new Color(0.9, 0.9, 0.9) })),
      );
    this.jet = new PlayerView(bodyMat);
    this.group.add(this.carrier, this.jet.group);
    this.group.visible = false;
  }

  start(id: CutsceneId, jetModel: string): void {
    this.id = id;
    this.time = 0;
    this.duration = id === 'takeoff' ? 7.5 : 9.5;
    this.active = true;
    this.group.visible = true;
    this.jet.setModel(jetModel);
  }

  stop(): void {
    this.active = false;
    this.group.visible = false;
  }

  get done(): boolean {
    return this.time >= this.duration;
  }

  /** Advances the scene; positions the camera. Returns the distance "flown" (for sea scroll). */
  update(dt: number, camera: PerspectiveCamera): number {
    this.time += dt;
    const t = this.time;
    const jet = this.jet.group;
    let throttle: number;
    if (this.id === 'takeoff') {
      // Deck run from the stern, rotate at the bow, climb out.
      const accel = t < 1 ? 0 : t - 1;
      const z = 115 - 26 * accel * accel;
      const lift = Math.max(0, t - 3.4);
      jet.position.set(0, 13.2 + lift * lift * 14, z - lift * 180);
      _e.set(Math.min(0.24, lift * 0.3), 0, 0, 'YXZ');
      jet.quaternion.setFromEuler(_e);
      throttle = t < 0.8 ? 1 : 1.6;
      sampleKeys(
        [
          { t: 0, pos: [-38, 26, 168], look: [0, 14, 112] },
          { t: 2.2, pos: [-60, 34, 60], look: [0, 16, jet.position.z] },
          {
            t: 4.2,
            pos: [-12, jet.position.y + 22, jet.position.z + 75],
            look: [0, jet.position.y, jet.position.z - 120],
          },
          {
            t: 7.5,
            pos: [0, jet.position.y + 15, jet.position.z + 58],
            look: [0, jet.position.y + 5, jet.position.z - 260],
          },
        ],
        t,
        camera.position,
        this.look,
      );
    } else {
      // Glide slope onto the deck, trap, roll out.
      const touch = 5.6;
      const k = Math.min(1, t / touch);
      const slope = 1 - k;
      const z = t < touch ? 60 + slope * 1500 : 60 - 120 * (1 - Math.exp(-(t - touch) * 2.2));
      jet.position.set(slope * 40 * Math.sin(t * 0.8), 13.2 + slope * slope * 150, z);
      _e.set(t < touch ? 0.12 : 0.04, 0, slope * 0.2 * Math.sin(t * 0.8), 'YXZ');
      jet.quaternion.setFromEuler(_e);
      throttle = t < touch ? 0.9 : 0.6;
      const orbit = Math.max(0, t - 6.5) * 0.35;
      sampleKeys(
        [
          { t: 0, pos: [jet.position.x, jet.position.y + 18, jet.position.z + 70], look: [0, 20, -200] },
          { t: 3.8, pos: [0, jet.position.y + 20, jet.position.z + 90], look: [0, 13, 0] },
          { t: 5.4, pos: [-110, 34, 120], look: [jet.position.x, jet.position.y, jet.position.z] },
          {
            t: 9.5,
            pos: [-180 * Math.cos(orbit), 90, -40 + 180 * Math.sin(orbit)],
            look: [0, 13, -20],
          },
        ],
        t,
        camera.position,
        this.look,
      );
    }
    this.jet.setThrottle(throttle, t);
    camera.up.set(0, 1, 0);
    camera.lookAt(this.look);
    return t * this.seaSpeed;
  }

  /** World-space jet position, for trailing FX. */
  get jetPosition(): Vector3 {
    return this.jet.group.position;
  }

  get jetRotation(): Quaternion {
    return this.jet.group.quaternion;
  }
}
