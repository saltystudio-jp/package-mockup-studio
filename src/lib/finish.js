// Surface finishes for printed box faces: マット / グロス / エンボス(網目).
//
//  matte  — rough, no reflections (uncoated board)
//  gloss  — smooth, reflecting a soft studio environment (gloss lamination). Without
//           something to reflect, a glossy material only ever shows a small highlight
//           from the key light and reads as merely "shiny plastic", so gloss faces get
//           an environment map of a simple lit room.
//  emboss — a fine woven "網目" texture pressed into the board, as a normal map.
//
// Emboss detail: three r128 samples every map on a material through ONE uv transform,
// taken from the artwork map (repeat 1) — so a normal map can't be tiled with its own
// texture.repeat while a print is on the face; it would stretch across the whole face.
// The shader is patched instead to sample the normal map at uv × embossRepeat, where
// embossRepeat is the face's size in mm divided by the weave pitch. The weave then has
// the same physical scale on every face, whatever its size.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export const BOX_FINISHES = [
  { key: "matte", label: "マット" },
  { key: "gloss", label: "グロス" },
  { key: "emboss", label: "網目エンボス" },
];
const EMBOSS_PITCH_MM = 0.8; // one thread spacing of the weave

export function makeEnvMap(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return env;
}

// one repeating tile of a plain weave: warp and weft threads alternately over and
// under, as a height field → tangent-space normal map
export function makeEmbossNormalMap() {
  const N = 128;
  const THREADS = 4; // per tile, each direction — so a tile is 4 pitches wide
  const cell = N / THREADS;
  const h = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const ix = Math.floor(x / cell);
      const iy = Math.floor(y / cell);
      const tx = x / cell - ix - 0.5;
      const ty = y / cell - iy - 0.5;
      const warp = Math.max(0, Math.cos((Math.PI * tx) / 0.9));
      const weft = Math.max(0, Math.cos((Math.PI * ty) / 0.9));
      const warpOver = (ix + iy) % 2 === 0;
      h[y * N + x] = warpOver ? Math.max(warp, 0.55 * weft) : Math.max(0.55 * warp, weft);
    }
  }
  // soften the over/under steps a little so they read as threads, not cut edges
  const blur = (src) => {
    const out = new Float32Array(N * N);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += src[((y + dy + N) % N) * N + ((x + dx + N) % N)];
        out[y * N + x] = s / 9;
      }
    return out;
  };
  const hs = blur(blur(h));
  const canvas = document.createElement("canvas");
  canvas.width = N;
  canvas.height = N;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(N, N);
  const k = 3.2; // relief strength baked into the map (normalScale scales it further)
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = hs[y * N + ((x + 1) % N)] - hs[y * N + ((x - 1 + N) % N)];
      const dy = hs[((y + 1) % N) * N + x] - hs[((y - 1 + N) % N) * N + x];
      let nx = -dx * k;
      let ny = dy * k; // canvas y runs down, texture v runs up
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * N + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

const baseOnBeforeCompile = THREE.Material.prototype.onBeforeCompile;
const baseCacheKey = THREE.Material.prototype.customProgramCacheKey;

// `mat.userData.sizeMm` = [u, v] size of the face in mm (set by boxModels.js)
export function applyFinish(mat, finish, { envMap, embossMap }) {
  mat.metalness = 0;
  if (finish === "gloss") {
    mat.roughness = 0.14;
    mat.envMap = envMap;
    mat.envMapIntensity = 0.9;
  } else if (finish === "emboss") {
    mat.roughness = 0.62;
    mat.envMap = envMap;
    mat.envMapIntensity = 0.25;
  } else {
    mat.roughness = 0.85;
    mat.envMap = null;
  }

  if (finish === "emboss") {
    const [u, v] = mat.userData.sizeMm || [50, 50];
    const TILE_MM = 4 * EMBOSS_PITCH_MM; // the map holds 4 pitches per tile
    mat.userData.embossRepeat = new THREE.Vector2(u / TILE_MM, v / TILE_MM);
    mat.normalMap = embossMap;
    mat.normalScale = new THREE.Vector2(0.8, 0.8);
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.embossRepeat = { value: mat.userData.embossRepeat };
      // at this point the shader still holds `#include <normal_fragment_maps>` — the
      // sampling line only exists inside that chunk, so expand it here and patch that
      const chunk = THREE.ShaderChunk.normal_fragment_maps.replace(/texture2D\( normalMap, vUv \)/g, "texture2D( normalMap, vUv * embossRepeat )");
      shader.fragmentShader = "uniform vec2 embossRepeat;\n" + shader.fragmentShader.replace("#include <normal_fragment_maps>", chunk);
    };
    mat.customProgramCacheKey = () => "pms-emboss-v1";
  } else {
    mat.normalMap = null;
    mat.onBeforeCompile = baseOnBeforeCompile;
    mat.customProgramCacheKey = baseCacheKey;
  }
  mat.needsUpdate = true;
}
