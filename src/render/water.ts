import { Color, Mesh, PlaneGeometry, ShaderMaterial, Vector2 } from 'three';
import { SKY_FUNCTION, applySkyUniforms, skyUniforms, type LightingPreset } from './environment';

/**
 * Ocean surface (F5): a camera-following plane whose waves are evaluated in
 * world coordinates (frame position + scroll offset), so the sea rushes past
 * at the true flight speed. Normals come from a sum of directional sine waves;
 * colour mixes a deep/shallow base with a Fresnel sky reflection and a sun glint.
 */
const vertex = /* glsl */ `
  uniform vec2 uOffset;
  varying vec3 vFrame;
  varying vec2 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vFrame = wp.xyz;
    vWorld = wp.xz + uOffset;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const fragment = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uDetail;
  varying vec3 vFrame;
  varying vec2 vWorld;
  ${SKY_FUNCTION}

  vec2 wave(vec2 p, vec2 dir, float k, float w, float a) {
    float ph = dot(dir, p) * k + uTime * w;
    return dir * (a * k * cos(ph));
  }

  void main() {
    float dist = length(vFrame - cameraPosition);
    float fade = 1.0 - smoothstep(600.0, 4200.0, dist);
    vec2 p = vWorld;
    vec2 d = vec2(0.0);
    d += wave(p, normalize(vec2(0.3, 1.0)), 0.0061, 1.1, 5.0);
    d += wave(p, normalize(vec2(-0.7, 0.6)), 0.0123, 1.7, 2.2);
    d += wave(p, normalize(vec2(0.9, 0.2)), 0.0245, 2.3, 0.9) * fade;
    d += wave(p, normalize(vec2(-0.2, -1.0)), 0.049, 3.1, 0.45) * fade;
    d += wave(p, normalize(vec2(0.6, -0.8)), 0.098, 4.3, 0.2) * fade * uDetail;
    d += wave(p, normalize(vec2(-0.9, -0.3)), 0.196, 6.0, 0.08) * fade * uDetail;
    vec3 n = normalize(vec3(-d.x, 1.0, -d.y));
    vec3 v = normalize(cameraPosition - vFrame);
    float ndv = max(dot(n, v), 0.0);
    float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
    vec3 r = reflect(-v, n);
    r.y = abs(r.y);
    vec3 sky = skyColor(r, 0.0);
    float crest = smoothstep(0.35, 0.9, length(d));
    vec3 base = mix(uDeep, uShallow, 0.25 + 0.5 * crest);
    vec3 col = mix(base, sky, clamp(fresnel, 0.0, 1.0) * 0.62);
    float s = max(dot(r, uSunDir), 0.0);
    col += uSunColor * (pow(s, 600.0) * 5.0 + pow(s, 90.0) * 0.08);
    col += vec3(0.8) * crest * 0.08 * fade;
    float fogF = smoothstep(uFogNear, uFogFar, dist);
    col = mix(col, uFogColor, fogF);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Ocean {
  readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;

  constructor() {
    const uniforms = {
      ...skyUniforms(),
      uTime: { value: 0 },
      uOffset: { value: new Vector2() },
      uDeep: { value: new Color() },
      uShallow: { value: new Color() },
      uFogColor: { value: new Color() },
      uFogNear: { value: 800 },
      uFogFar: { value: 6000 },
      uDetail: { value: 1 },
    };
    this.mat = new ShaderMaterial({ uniforms, vertexShader: vertex, fragmentShader: fragment, fog: false });
    const geo = new PlaneGeometry(16000, 16000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -5;
  }

  applyPreset(p: LightingPreset): void {
    const u = this.mat.uniforms;
    applySkyUniforms(u as unknown as ReturnType<typeof skyUniforms>, p);
    u.uDeep.value.set(p.waterDeep);
    u.uShallow.value.set(p.waterShallow);
    u.uFogColor.value.set(p.fog);
    u.uFogNear.value = p.fogNear;
    u.uFogFar.value = p.fogFar * 0.95;
  }

  setDetail(high: boolean): void {
    this.mat.uniforms.uDetail.value = high ? 1 : 0;
  }

  /**
   * @param seaY sea level in frame coordinates (-rail altitude)
   * @param worldX world x of the frame origin (rail x)
   * @param dist distance travelled (world z = -dist at the frame origin)
   */
  update(time: number, camX: number, camZ: number, seaY: number, worldX: number, dist: number): void {
    this.mesh.position.set(camX, seaY, camZ - 4000);
    const u = this.mat.uniforms;
    u.uTime.value = time;
    // Wrap the scroll offset to keep float precision; a stage rarely travels
    // past the wrap distance, so the one-frame wave pop is practically unseen.
    const wrap = 32 * 1024;
    u.uOffset.value.set(worldX % wrap, -(dist % wrap));
  }
}
