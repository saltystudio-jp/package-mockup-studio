// Depth of field (被写界深度) as a post-process: scene → bokeh blur by depth → output.
//
// Rendering into a texture (which any post-process needs) skips two things three r128
// only does when drawing straight to the screen: tone mapping (our exposure is a
// LinearToneMapping multiply) and the linear → sRGB conversion. Left out, the image came
// out darker and ignored the 露出 slider, so the last pass puts both back.
//
// BokehPass also draws the scene once with a depth material to know how far each pixel
// is — with the scene background on, the background picture got drawn into that depth
// image too and read as random distances. It's switched off for the depth draw only, so
// the background counts as "far" and blurs evenly.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

const OutputShader = {
  uniforms: { tDiffuse: { value: null }, exposure: { value: 1 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float exposure;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      c.rgb *= exposure;
      gl_FragColor = LinearTosRGB(c);
    }`,
};

export function createDof(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const target = renderer.capabilities.isWebGL2
    ? new THREE.WebGLMultisampleRenderTarget(size.x, size.y, { format: THREE.RGBAFormat }) // keeps edges antialiased
    : new THREE.WebGLRenderTarget(size.x, size.y, { format: THREE.RGBAFormat });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bokeh = new BokehPass(scene, camera, { focus: 5, aperture: 0.002, maxblur: 0.01, width: size.x, height: size.y });
  const bokehRender = bokeh.render.bind(bokeh);
  bokeh.render = (...args) => {
    const bg = scene.background;
    scene.background = null;
    try {
      bokehRender(...args);
    } finally {
      scene.background = bg;
    }
  };
  // BokehPass expects to be the last pass and doesn't swap buffers; with the output
  // pass after it, that left the output reading the UNblurred image
  bokeh.needsSwap = true;
  composer.addPass(bokeh);
  const output = new ShaderPass(OutputShader);
  composer.addPass(output);

  const v = new THREE.Vector3();
  return {
    composer,
    // BokehPass has no setSize of its own: its depth image and aspect follow the canvas here
    setSize(w, h) {
      composer.setSize(w, h);
      bokeh.renderTargetDepth.setSize(w, h);
      bokeh.uniforms.aspect.value = w / h;
    },
    // focusPoint: world position to keep sharp; strength 0..100
    render({ focusPoint, focusDistance, strength }) {
      camera.updateMatrixWorld();
      let focus = focusDistance;
      if (focusPoint) {
        v.copy(focusPoint).applyMatrix4(camera.matrixWorldInverse);
        focus = Math.max(0.01, -v.z); // distance along the view direction
      }
      const k = Math.max(0, Math.min(100, strength)) / 100;
      bokeh.uniforms.focus.value = focus;
      bokeh.uniforms.aperture.value = 0.006 * k * k;
      bokeh.uniforms.maxblur.value = 0.003 + 0.012 * k;
      output.uniforms.exposure.value = renderer.toneMappingExposure;
      composer.render();
    },
  };
}
