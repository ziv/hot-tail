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
}

export const PRESETS: Record<'day' | 'sunset' | 'dusk', LightingPreset> = {
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
  vec3 skyColor(vec3 dir, float sunDisc) {
    float h = dir.y;
    vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
    col = mix(col, uBelow, smoothstep(0.0, -0.12, h));
    float s = max(dot(dir, uSunDir), 0.0);
    col += uSunColor * (pow(s, 900.0) * 12.0 * sunDisc + pow(s, 10.0) * 0.35 + pow(s, 3.0) * 0.12);
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
  };
}

export type SkyUniforms = ReturnType<typeof skyUniforms>;

export function applySkyUniforms(u: SkyUniforms, p: LightingPreset): void {
  u.uZenith.value.set(p.zenith);
  u.uHorizon.value.set(p.horizon);
  u.uBelow.value.set(p.below);
  u.uSunDir.value.set(...p.sunDir).normalize();
  u.uSunColor.value.set(p.sunColor);
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
