import type { MeshStandardMaterial } from 'three';

/**
 * Per-vertex surface response for model materials (see `Surf` in models.ts):
 * the `surf` attribute carries roughness, metalness and panel-line strength,
 * so one instanced draw can mix glossy canopies, bare-metal nozzles and
 * painted skin. Panel lines are drawn procedurally in model space (so they
 * stick to the airframe), with a slight tone shift between panels, and fade
 * out before they could alias at a distance.
 */
export function applySurfaceDetail(mat: MeshStandardMaterial): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec3 surf;\nvarying vec3 vSurf;\nvarying vec3 vModel;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurf = surf;\nvModel = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSurf;\nvarying vec3 vModel;')
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        if (vSurf.z > 0.0) {
          vec2 q = vModel.zx / vec2(2.3, 3.1);
          vec2 d = abs(fract(q) - 0.5);
          vec2 fw = max(fwidth(q), vec2(1e-4));
          vec2 line = smoothstep(vec2(0.5) - fw * 1.5, vec2(0.5), d) * (1.0 - smoothstep(0.06, 0.2, fw));
          float panel = fract(sin(dot(floor(q), vec2(12.9898, 78.233))) * 43758.5453);
          diffuseColor.rgb *= (1.0 - vSurf.z * max(line.x, line.y * 0.7)) * (1.0 + (panel - 0.5) * vSurf.z * 0.35);
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nif (vSurf.x > 0.0) roughnessFactor = vSurf.x;',
      )
      .replace(
        '#include <metalnessmap_fragment>',
        '#include <metalnessmap_fragment>\nif (vSurf.x > 0.0) metalnessFactor = vSurf.y;',
      );
  };
  mat.customProgramCacheKey = () => 'surface-detail';
}
