import * as THREE from 'three';
import { addPatch, replaceOnce } from '../../render/materials/MaterialPatches';

// Light goes into skin and comes out a little way off, reddened by blood:
// that is why lit faces glow softly past the shadow line instead of
// cutting off like plaster. A wrap term on direct light, tinted `scatter`,
// stands in for it: the diffuse is let round the terminator by a fraction.

const DIFFUSE_LINE = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );';

export function applySkinShading(material: THREE.MeshStandardMaterial, scatter: THREE.Color, wrap = 0.45): void {
  const uniforms = { uSkinScatter: { value: scatter }, uSkinWrap: { value: wrap } };
  addPatch(material, {
    key: 'skin-scatter',
    apply(shader) {
      Object.assign(shader.uniforms, uniforms);
      const chunk = THREE.ShaderChunk.lights_physical_pars_fragment;
      if (!chunk.includes(DIFFUSE_LINE)) throw new Error('Skin shading: Three.js lighting chunk changed');
      const wrapped = chunk.replace(
        DIFFUSE_LINE,
        `${DIFFUSE_LINE}
	{
		float wrapNL = saturate( ( dot( geometryNormal, directLight.direction ) + uSkinWrap ) / ( 1.0 + uSkinWrap ) );
		reflectedLight.directDiffuse += max( wrapNL - dotNL, 0.0 ) * directLight.color * uSkinScatter * BRDF_Lambert( material.diffuseContribution );
	}`,
      );
      shader.fragmentShader = replaceOnce(shader.fragmentShader, '#include <common>', '#include <common>\nuniform vec3 uSkinScatter;\nuniform float uSkinWrap;', 'skin pars');
      shader.fragmentShader = replaceOnce(shader.fragmentShader, '#include <lights_physical_pars_fragment>', wrapped, 'skin wrap');
    },
  });
}
