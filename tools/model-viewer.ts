/**
 * Dev-only model viewer (not part of the build): `pnpm dev` →
 * http://localhost:5173/tools/models.html
 *
 *   ?m=player,fighter   models to show (default: every aircraft), laid out in a grid
 *   ?preset=dusk        lighting preset (see PRESETS)
 *   ?view=chase|front|side|top|three-quarter
 *   ?zoom=3&look=0,1,-25   magnify around a model-space point (single model)
 *
 * Drag to orbit, wheel to zoom. Uses the game's sky, lights and model material.
 */
import {
  ACESFilmicToneMapping,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  Color,
  Vector3,
  WebGLRenderer,
} from 'three';
import { Environment, PRESETS, type LightingPreset } from '@/render/environment';
import { MODEL_FACTORIES } from '@/render/registry';
import { applySurfaceDetail } from '@/render/surface';

const AIRCRAFT = [
  'player',
  'playerDart',
  'playerManta',
  'fighter',
  'chaser',
  'drone',
  'ace',
  'missile',
  'gunship',
  'bomber',
  'awacs',
  'tanker',
  'stealth',
];
const params = new URLSearchParams(location.search);
const keys = params.get('m')?.split(',') ?? AIRCRAFT;
const presetName = (params.get('preset') ?? 'day') as keyof typeof PRESETS;
const view = params.get('view') ?? 'three-quarter';

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = ACESFilmicToneMapping;
document.body.append(renderer.domElement);

const scene = new Scene();
const env = new Environment(scene);
const preset: LightingPreset = PRESETS[presetName] ?? PRESETS.day;
env.apply(preset);
scene.fog = null;
renderer.toneMappingExposure = preset.exposure;
const pmrem = new PMREMGenerator(renderer);
const skyScene = new Scene();
skyScene.add(new Mesh(env.sky.geometry, env.sky.material));
const envTex = pmrem.fromScene(skyScene, 0, 1, 9000).texture;

const bodyMat = new MeshStandardMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.5 });
applySurfaceDetail(bodyMat);
bodyMat.envMap = envTex;
bodyMat.envMapIntensity = 0.9;
const glowMat = new MeshBasicMaterial({ vertexColors: true, color: new Color(2.6, 2.6, 2.6) });

// Grid layout: each model normalised to the same cell size.
const cols = Math.ceil(Math.sqrt(keys.length * 1.6));
const cell = 26;
const root = new Group();
let tris = '';
keys.forEach((key, i) => {
  const geo = MODEL_FACTORIES[key]();
  const g = new Group();
  g.add(new Mesh(geo.body, bodyMat));
  if (geo.glow) g.add(new Mesh(geo.glow, glowMat));
  const r = geo.body.boundingSphere?.radius ?? geo.radius;
  g.scale.setScalar(keys.length > 1 ? 11 / r : 1);
  if (keys.length > 1) {
    g.position.set(
      ((i % cols) - (cols - 1) / 2) * cell,
      0,
      (Math.floor(i / cols) - (Math.ceil(keys.length / cols) - 1) / 2) * cell,
    );
  }
  root.add(g);
  const n = (geo.body.index ? geo.body.index.count : geo.body.getAttribute('position').count) / 3;
  tris += `${key.padEnd(12)} ${Math.round(n)} tris  r=${r.toFixed(1)}\n`;
});
scene.add(root);
document.getElementById('hud')!.textContent = `${presetName}\n${tris}`;

const camera = new PerspectiveCamera(35, innerWidth / innerHeight, 0.5, 20000);
const target = new Vector3();
const spans =
  keys.length > 1
    ? (cols * cell) / 2 + 10
    : (MODEL_FACTORIES[keys[0]]().body.boundingSphere?.radius ?? 10) * 1.6;
const views: Record<string, [number, number]> = {
  'three-quarter': [0.75, 0.45],
  chase: [Math.PI, 0.28],
  front: [0, 0.15],
  side: [Math.PI / 2, 0.02],
  top: [0, 1.5],
};
let [yaw, pitch] = views[view] ?? views['three-quarter'];
let dist = (spans * 2.1) / Number(params.get('zoom') ?? 1);
const look = params.get('look')?.split(',').map(Number);
if (look?.length === 3) target.set(look[0], look[1], look[2]);
function place(): void {
  camera.position
    .set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
    .multiplyScalar(dist)
    .add(target);
  camera.lookAt(target);
}
let drag: { x: number; y: number } | null = null;
addEventListener('pointerdown', (e) => (drag = { x: e.clientX, y: e.clientY }));
addEventListener('pointerup', () => (drag = null));
addEventListener('pointermove', (e) => {
  if (!drag) return;
  yaw += (e.clientX - drag.x) * 0.008;
  pitch = Math.max(-1.5, Math.min(1.5, pitch + (e.clientY - drag.y) * 0.008));
  drag = { x: e.clientX, y: e.clientY };
});
addEventListener('wheel', (e) => (dist *= e.deltaY > 0 ? 1.1 : 0.9));
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
renderer.setAnimationLoop(() => {
  place();
  env.follow(camera.position);
  renderer.render(scene, camera);
});
Object.assign(window, {
  __viewer: { setView: (y: number, p: number, d?: number) => ((yaw = y), (pitch = p), d && (dist = d)) },
});
