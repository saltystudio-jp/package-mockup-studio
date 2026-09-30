// Colors as the user picked them.
//
// The renderer outputs sRGB (so image textures, tagged sRGB, come out exactly as
// uploaded), but three.js r128 treats a Color set from a hex/CSS value as LINEAR light.
// Passed straight through, every flat color then gets gamma-encoded a second time on
// output and comes out paler: #c08447 (a hardwood brown) rendered as 225,190,144 — a
// pale cream. Every material color that comes from a hex value goes through here.
import * as THREE from "three";

export function srgb(value) {
  return new THREE.Color(value).convertSRGBToLinear();
}

export function setSrgb(color, value) {
  return color.set(value).convertSRGBToLinear();
}
