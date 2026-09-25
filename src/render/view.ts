import {
  ACESFilmicToneMapping,
  Mesh,
  PMREMGenerator,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Texture,
} from 'three';
import type { Sim } from '@/sim/sim';
import type { StageDef } from '@/sim/defs';
import { hashSeed } from '@/core/rng';
import { Environment, PRESETS } from './environment';
import { Ocean } from './water';
import { Terrain } from './terrain';
import { EntityRenderer, PlayerView, interpolate } from './entities';
import { CameraRig } from './camera';
import { SpeedLines } from './speedlines';
import { PostFX } from './post';
import { createParticleSystems, type ParticleSystem } from './particles';
import { Fx } from './fx';
import { QUALITY, type QualityLevel, type QualitySettings } from './quality';

/**
 * Owns the renderer and every visual system; draws the simulation with render
 * interpolation. Nothing here mutates simulation state.
 */
export class GameView {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly rig = new CameraRig();
  readonly env: Environment;
  private readonly ocean = new Ocean();
  private readonly terrain = new Terrain();
  private readonly entities = new EntityRenderer();
  private readonly player: PlayerView;
  private readonly speedLines = new SpeedLines();
  private readonly post: PostFX;
  private readonly fxSys: ParticleSystem;
  private readonly smokeSys: ParticleSystem;
  readonly fx: Fx;
  private readonly pmrem: PMREMGenerator;
  private envMap: Texture | null = null;
  private quality: QualitySettings;
  private time = 0;
  private readonly playerPos = new Vector3();
  private readonly playerRot = new Quaternion();
  flashes = true;
  contextLost = false;

  constructor(
    readonly canvas: HTMLCanvasElement,
    level: QualityLevel,
  ) {
    this.quality = QUALITY[level];
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.maxDpr));
    this.renderer.info.autoReset = false;
    this.pmrem = new PMREMGenerator(this.renderer);

    this.env = new Environment(this.scene);
    this.scene.add(this.ocean.mesh, this.terrain.group, this.entities.group, this.speedLines.mesh);
    this.player = new PlayerView(this.entities.bodyMat);
    this.scene.add(this.player.group);

    const ps = createParticleSystems(1);
    this.fxSys = ps.fx;
    this.smokeSys = ps.smoke;
    this.smokeSys.points.renderOrder = 6;
    this.fxSys.points.renderOrder = 7;
    this.scene.add(this.smokeSys.points, this.fxSys.points);

    this.post = new PostFX(this.renderer, this.scene, this.rig.camera, this.quality);
    this.fx = new Fx(this.fxSys, this.smokeSys, this.rig, this.post);
    this.applyQuality(level);
    this.setLighting('day');

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.setLighting(this.lighting);
    });
    this.resize();
  }

  private lighting: keyof typeof PRESETS = 'day';

  get qualityLevel(): QualityLevel {
    return this.quality.level;
  }

  applyQuality(level: QualityLevel): void {
    this.quality = QUALITY[level];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.maxDpr));
    this.post.applyQuality(this.quality);
    this.ocean.setDetail(this.quality.waterDetail);
    this.terrain.setCloudsVisible(this.quality.clouds);
    this.fxSys.density = this.smokeSys.density = this.quality.particleDensity;
    this.resize();
  }

  setLighting(name: keyof typeof PRESETS): void {
    this.lighting = name;
    const p = PRESETS[name];
    this.env.apply(p);
    this.ocean.applyPreset(p);
    this.terrain.applyPreset(p);
    this.renderer.toneMappingExposure = p.exposure;
    this.post.setBloomStrength(p.bloom);
    // Reflection environment from the sky only (cheap, regenerated per preset).
    const skyScene = new Scene();
    const sky = new Mesh(this.env.sky.geometry, this.env.sky.material);
    skyScene.add(sky);
    this.envMap?.dispose();
    this.envMap = this.pmrem.fromScene(skyScene, 0, 1, 9000).texture;
    this.entities.setEnvMap(this.envMap);
  }

  bind(sim: Sim): void {
    this.fx.bind(sim);
  }

  setStage(sim: Sim, stage: StageDef): void {
    this.setLighting(stage.lighting);
    this.terrain.setStage(sim.rail, hashSeed(stage.id));
    this.fxSys.clear();
    this.smokeSys.clear();
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h);
  }

  /** World position of the player (interpolated) for HUD projection. */
  get interpolatedPlayer(): Vector3 {
    return this.playerPos;
  }

  render(sim: Sim, alpha: number, frameDt: number): void {
    if (this.contextLost) return;
    this.time += frameDt;
    const dist = sim.prevDist + (sim.dist - sim.prevDist) * alpha;
    const railX = sim.railPrev.x + (sim.railNow.x - sim.railPrev.x) * alpha;
    const railY = sim.railPrev.y + (sim.railNow.y - sim.railPrev.y) * alpha;

    interpolate(sim.player.e, alpha, this.playerPos, this.playerRot);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.rig.update(sim, this.playerPos, frameDt, this.time, w / Math.max(1, h));
    const cam = this.rig.camera;
    this.env.follow(cam.position);
    this.ocean.update(this.time, cam.position.x, cam.position.z, -railY, railX, dist);
    this.terrain.update(dist, railX, railY);
    this.entities.update(sim, alpha);
    this.player.update(sim, alpha, this.time);
    this.speedLines.update(frameDt, sim.speed, sim.cruiseSpeed, cam.position.x, cam.position.y);

    this.fx.flashes = this.flashes;
    this.fx.frame(sim, alpha, frameDt, this.playerPos);
    this.fxSys.update(this.time, dist, h * this.renderer.getPixelRatio(), cam.fov);
    this.smokeSys.update(this.time, dist, h * this.renderer.getPixelRatio(), cam.fov);

    const boost = Math.max(0, (sim.player.speedFactor - 1) / 0.6);
    this.renderer.info.reset();
    this.post.render(frameDt, boost, this.flashes);
  }

  stats(): { calls: number; triangles: number; geometries: number; textures: number } {
    const i = this.renderer.info;
    return {
      calls: i.render.calls,
      triangles: i.render.triangles,
      geometries: i.memory.geometries,
      textures: i.memory.textures,
    };
  }
}
