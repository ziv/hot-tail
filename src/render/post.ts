import {
  HalfFloatType,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import type { QualitySettings } from './quality';

/**
 * Post-processing (B10): bloom → tone map/sRGB → colour grade (vignette,
 * speed aberration, damage/impact flashes) → FXAA on tiers without MSAA.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.35 },
    uAberration: { value: 0 },
    uSaturation: { value: 1.12 },
    uFlash: { value: 0 },
    uFlashColor: { value: [1, 1, 1] },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uAberration;
    uniform float uSaturation;
    uniform float uFlash;
    uniform vec3 uFlashColor;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      vec2 off = c * uAberration;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, uSaturation);
      float v = 1.0 - uVignette * smoothstep(0.35, 0.95, length(c) * 1.3);
      col *= v;
      col = mix(col, uFlashColor, uFlash);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/**
 * Guards bloom against stray NaN/Inf pixels (a single one gets smeared over
 * the whole screen by the blur chain) and clamps extreme HDR values.
 * uDebug paints offending pixels magenta.
 */
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null }, uDebug: { value: 0 } },
  vertexShader: GradeShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uDebug;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      bool bad = any(isnan(c)) || any(isinf(c));
      if (bad) c = uDebug > 0.5 ? vec4(50.0, 0.0, 50.0, 1.0) : vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(min(c.rgb, vec3(64.0)), c.a);
    }
  `,
};

export class PostFX {
  readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly grade: ShaderPass;
  private readonly fxaa: ShaderPass;
  readonly sanitize: ShaderPass;
  private flash = 0;
  private flashDecay = 3;

  constructor(
    private readonly renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    quality: QualitySettings,
  ) {
    const size = renderer.getDrawingBufferSize(new Vector2());
    const rt = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: quality.msaa });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.sanitize = new ShaderPass(SanitizeShader);
    this.composer.addPass(this.sanitize);
    this.bloom = new UnrealBloomPass(new Vector2(size.x / 2, size.y / 2), 0.6, 0.4, 1.0);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaa);
    this.applyQuality(quality);
  }

  applyQuality(q: QualitySettings, retro = false): void {
    this.bloom.enabled = q.bloom;
    // FXAA would smear the deliberately chunky pixels of the retro style.
    this.fxaa.enabled = q.fxaa && !retro;
  }

  setBloomStrength(v: number): void {
    this.bloom.strength = v;
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
  }

  /** Full-screen flash (impact/damage); disabled when flashes are turned off. */
  flashScreen(r: number, g: number, b: number, strength: number, decay = 3): void {
    if (strength < this.flash) return;
    this.flash = strength;
    this.flashDecay = decay;
    this.grade.uniforms.uFlashColor.value = [r, g, b];
  }

  render(dt: number, speedBoost: number, flashes: boolean): void {
    this.flash = Math.max(0, this.flash - dt * this.flashDecay);
    const u = this.grade.uniforms;
    u.uFlash.value = flashes ? this.flash : 0;
    u.uAberration.value = 0.004 * speedBoost;
    this.composer.render(dt);
  }
}
