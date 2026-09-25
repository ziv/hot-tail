import type { LightingId } from '@/sim/defs';
import {
  AmbientLight,
  BackSide,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Scene,
} from 'three';

/**
 * Sky, fog and lighting presets per biome time-of-day (F4).
 */
export interface LightingPreset {
  zenith: string;
  horizon: string;
  below: string;
  fog: string;
  fogNear: number;
  fogFar: number;
  sunDir: [number, number, number];
  sunColor: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  waterDeep: string;
  waterShallow: string;
  cloudLit: string;
  cloudShade: string;
  exposure: number;
  bloom: number;
  /** 0..1: star field strength (night, edge of space). */
  stars?: number;
  /** 0..1: how many city windows are lit. */
  night?: number;
}

export const PRESETS: Record<LightingId, LightingPreset> = {
  day: {
    zenith: '#1f58b8',
    horizon: '#a6d0ee',
    below: '#8fbcd8',
    fog: '#a2c9e4',
    fogNear: 900,
    fogFar: 6200,
    sunDir: [0.45, 0.62, -0.64],
    sunColor: '#fff1d8',
    sunIntensity: 2.6,
    hemiSky: '#cfe6ff',
    hemiGround: '#2d4a5c',
    hemiIntensity: 1.1,
    waterDeep: '#062c4c',
    waterShallow: '#12708f',
    cloudLit: '#ffffff',
    cloudShade: '#a9bfd6',
    exposure: 1.0,
    bloom: 0.55,
  },
  sunset: {
    zenith: '#30407e',
    horizon: '#ffb07a',
    below: '#e59a78',
    fog: '#eaa37e',
    fogNear: 700,
    fogFar: 5600,
    sunDir: [-0.15, 0.12, -1],
    sunColor: '#ffb77a',
    sunIntensity: 2.8,
    hemiSky: '#ffc9a0',
    hemiGround: '#40304a',
    hemiIntensity: 0.9,
    waterDeep: '#15213f',
    waterShallow: '#5a4a66',
    cloudLit: '#ffd0a8',
    cloudShade: '#8a6a8a',
    exposure: 1.0,
    bloom: 0.7,
  },
  dusk: {
    zenith: '#141838',
    horizon: '#cf6a58',
    below: '#6a4a6a',
    fog: '#6d5174',
    fogNear: 600,
    fogFar: 5000,
    sunDir: [0.55, 0.07, -0.83],
    sunColor: '#ff8a5c',
    sunIntensity: 2.2,
    hemiSky: '#8d7ab8',
    hemiGround: '#221a2e',
    hemiIntensity: 0.85,
    waterDeep: '#0a1128',
    waterShallow: '#33355a',
    cloudLit: '#f5a58a',
    cloudShade: '#4d3f66',
    exposure: 1.05,
    bloom: 0.85,
  },
  desertDay: {
    zenith: '#3b6fc2',
    horizon: '#e3cda6',
    below: '#d6b88a',
    fog: '#d9c29c',
    fogNear: 900,
    fogFar: 6400,
    sunDir: [0.3, 0.72, -0.6],
    sunColor: '#fff0d2',
    sunIntensity: 2.9,
    hemiSky: '#ffe8c4',
    hemiGround: '#8a5a34',
    hemiIntensity: 1.0,
    waterDeep: '#0b3a5e',
    waterShallow: '#1e7d9c',
    cloudLit: '#ffffff',
    cloudShade: '#d6c0a2',
    exposure: 1.0,
    bloom: 0.5,
  },
  desertDusk: {
    zenith: '#28194a',
    horizon: '#ff8748',
    below: '#b0583a',
    fog: '#c46d4f',
    fogNear: 700,
    fogFar: 5200,
    sunDir: [-0.3, 0.08, -1],
    sunColor: '#ff9a5a',
    sunIntensity: 2.6,
    hemiSky: '#ffb48a',
    hemiGround: '#3a2030',
    hemiIntensity: 0.85,
    waterDeep: '#15213f',
    waterShallow: '#5a4a66',
    cloudLit: '#ffb890',
    cloudShade: '#7a4a60',
    exposure: 1.05,
    bloom: 0.8,
  },
  mountainDay: {
    zenith: '#2c62b8',
    horizon: '#cfe0ee',
    below: '#b8c8d6',
    fog: '#c3d5e4',
    fogNear: 1000,
    fogFar: 7000,
    sunDir: [0.4, 0.66, -0.64],
    sunColor: '#fff6e6',
    sunIntensity: 2.8,
    hemiSky: '#dcebff',
    hemiGround: '#3e4a3a',
    hemiIntensity: 1.1,
    waterDeep: '#0b3a5e',
    waterShallow: '#1e7d9c',
    cloudLit: '#ffffff',
    cloudShade: '#aebdd0',
    exposure: 1.0,
    bloom: 0.5,
  },
  mountainDusk: {
    zenith: '#2a2c66',
    horizon: '#ff9f6e',
    below: '#b8708a',
    fog: '#b87c8a',
    fogNear: 800,
    fogFar: 6000,
    sunDir: [-0.5, 0.1, -0.86],
    sunColor: '#ffa36a',
    sunIntensity: 2.6,
    hemiSky: '#ffc4a8',
    hemiGround: '#2e2a40',
    hemiIntensity: 0.9,
    waterDeep: '#15213f',
    waterShallow: '#5a4a66',
    cloudLit: '#ffc6a8',
    cloudShade: '#6e5a82',
    exposure: 1.02,
    bloom: 0.75,
  },
  storm: {
    zenith: '#3a4450',
    horizon: '#8a949c',
    below: '#6a737a',
    fog: '#7c868e',
    fogNear: 400,
    fogFar: 3600,
    sunDir: [0.2, 0.8, -0.5],
    sunColor: '#c8d0d8',
    sunIntensity: 1.3,
    hemiSky: '#aab4bc',
    hemiGround: '#303438',
    hemiIntensity: 1.2,
    waterDeep: '#1a2630',
    waterShallow: '#3a4a54',
    cloudLit: '#c4cad0',
    cloudShade: '#6a727a',
    exposure: 1.05,
    bloom: 0.45,
  },
  cityNight: {
    zenith: '#05070f',
    horizon: '#2a2440',
    below: '#161522',
    fog: '#1c1a2c',
    fogNear: 500,
    fogFar: 5200,
    sunDir: [0.3, 0.5, -0.8],
    sunColor: '#56648a',
    sunIntensity: 0.55,
    hemiSky: '#4a5680',
    hemiGround: '#141018',
    hemiIntensity: 0.7,
    waterDeep: '#04060e',
    waterShallow: '#141a30',
    cloudLit: '#5a5a7a',
    cloudShade: '#242438',
    exposure: 1.1,
    bloom: 1.0,
    stars: 0.7,
    night: 1,
  },
  cityDawn: {
    zenith: '#3a5c9c',
    horizon: '#ffc59a',
    below: '#d8a08a',
    fog: '#d8b0a0',
    fogNear: 800,
    fogFar: 6200,
    sunDir: [0.6, 0.14, -0.78],
    sunColor: '#ffc896',
    sunIntensity: 2.4,
    hemiSky: '#ffd8c0',
    hemiGround: '#3a3040',
    hemiIntensity: 0.95,
    waterDeep: '#15213f',
    waterShallow: '#5a4a66',
    cloudLit: '#ffe0c8',
    cloudShade: '#9a8aa8',
    exposure: 1.0,
    bloom: 0.65,
    night: 0.25,
  },
  stratoLow: {
    zenith: '#0e2c78',
    horizon: '#9cc4f0',
    below: '#e8eef6',
    fog: '#b8d0ec',
    fogNear: 2000,
    fogFar: 9000,
    sunDir: [0.35, 0.45, -0.82],
    sunColor: '#ffffff',
    sunIntensity: 3,
    hemiSky: '#cfe0ff',
    hemiGround: '#c8d4e4',
    hemiIntensity: 1.2,
    waterDeep: '#0b3a5e',
    waterShallow: '#1e7d9c',
    cloudLit: '#ffffff',
    cloudShade: '#c0cce0',
    exposure: 1.0,
    bloom: 0.55,
    stars: 0.1,
  },
  stratoSpace: {
    zenith: '#01030a',
    horizon: '#3a6ab8',
    below: '#dbe6f4',
    fog: '#5f84bf',
    fogNear: 3000,
    fogFar: 11000,
    sunDir: [-0.35, 0.3, -0.88],
    sunColor: '#ffffff',
    sunIntensity: 3.4,
    hemiSky: '#9ab4e8',
    hemiGround: '#c8d4e4',
    hemiIntensity: 1.0,
    waterDeep: '#0b3a5e',
    waterShallow: '#1e7d9c',
    cloudLit: '#ffffff',
    cloudShade: '#aeb8cc',
    exposure: 1.0,
    bloom: 0.7,
    stars: 1,
  },
};

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;

export const SKY_FUNCTION = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uBelow;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uStars;
  float starHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  vec3 skyColor(vec3 dir, float sunDisc) {
    float h = dir.y;
    vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
    col = mix(col, uBelow, smoothstep(0.0, -0.12, h));
    float s = max(dot(dir, uSunDir), 0.0);
    float glow = 1.0 - 0.75 * uStars;
    col += uSunColor * (pow(s, 900.0) * 12.0 * sunDisc + (pow(s, 10.0) * 0.35 + pow(s, 3.0) * 0.12) * glow);
    if (uStars > 0.0 && h > 0.0) {
      vec3 cell = floor(dir * 420.0);
      float st = step(0.9988, starHash(cell)) * smoothstep(0.02, 0.3, h) * sunDisc;
      col += vec3(st * uStars * 0.9);
    }
    return col;
  }
`;

const skyFragment = /* glsl */ `
  varying vec3 vDir;
  ${SKY_FUNCTION}
  void main() {
    gl_FragColor = vec4(skyColor(normalize(vDir), 1.0), 1.0);
  }
`;

export function skyUniforms() {
  return {
    uZenith: { value: new Color() },
    uHorizon: { value: new Color() },
    uBelow: { value: new Color() },
    uSunDir: { value: new Vector3(0, 1, 0) },
    uSunColor: { value: new Color() },
    uStars: { value: 0 },
  };
}

export type SkyUniforms = ReturnType<typeof skyUniforms>;

export function applySkyUniforms(u: SkyUniforms, p: LightingPreset): void {
  u.uZenith.value.set(p.zenith);
  u.uHorizon.value.set(p.horizon);
  u.uBelow.value.set(p.below);
  u.uSunDir.value.set(...p.sunDir).normalize();
  u.uSunColor.value.set(p.sunColor);
  u.uStars.value = p.stars ?? 0;
}

export class Environment {
  readonly sky: Mesh;
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  readonly ambient: AmbientLight;
  readonly fog: Fog;
  readonly skyUniforms = skyUniforms();
  preset: LightingPreset = PRESETS.day;

  constructor(scene: Scene) {
    const mat = new ShaderMaterial({
      uniforms: this.skyUniforms,
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new Mesh(new SphereGeometry(8000, 32, 16), mat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    this.sun = new DirectionalLight(0xffffff, 2.5);
    scene.add(this.sun, this.sun.target);
    this.hemi = new HemisphereLight(0xffffff, 0x333333, 1);
    scene.add(this.hemi);
    this.ambient = new AmbientLight(0xffffff, 0.15);
    scene.add(this.ambient);
    this.fog = new Fog(0xffffff, 800, 6000);
    scene.fog = this.fog;
    scene.background = null;
  }

  apply(p: LightingPreset): void {
    this.preset = p;
    applySkyUniforms(this.skyUniforms, p);
    this.sun.color.set(p.sunColor);
    this.sun.intensity = p.sunIntensity;
    this.sun.position
      .set(...p.sunDir)
      .normalize()
      .multiplyScalar(100);
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;
    this.fog.color.set(p.fog);
    this.fog.near = p.fogNear;
    this.fog.far = p.fogFar;
  }

  /** Keeps the sky centred on the camera. */
  follow(cam: Vector3): void {
    this.sky.position.copy(cam);
  }
}
