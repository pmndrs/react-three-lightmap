import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { storeLightMapValue } from './bake';

describe('storeLightMapValue', () => {
  it('writes the main texel and propagates to its full 3x3 brush neighbourhood', () => {
    const atlasWidth = 3;
    const atlasHeight = 3;
    const totalTexelCount = atlasWidth * atlasHeight;

    // all-zero atlas data means every texel looks like an empty/unfilled face slot
    const atlasData = new Float32Array(4 * totalTexelCount);
    const passOutputData = new Float32Array(4 * totalTexelCount);

    const centerTexelIndex = 4; // row 1, col 1 of a 3x3 grid
    const rgba = new THREE.Vector4(0.25, 0.5, 0.75, 0);

    storeLightMapValue(
      atlasData,
      atlasWidth,
      totalTexelCount,
      centerTexelIndex,
      rgba,
      passOutputData
    );

    // every texel in a 3x3 torus is within one step of the center, so all should be filled
    for (let texelIndex = 0; texelIndex < totalTexelCount; texelIndex += 1) {
      const base = texelIndex * 4;
      expect(
        [
          passOutputData[base],
          passOutputData[base + 1],
          passOutputData[base + 2],
          passOutputData[base + 3]
        ],
        `texel ${texelIndex}`
      ).toEqual([0.25, 0.5, 0.75, 1]);
    }
  });

  it('does not overwrite an already-filled diagonal neighbour with a weaker write', () => {
    const atlasWidth = 3;
    const atlasHeight = 3;
    const totalTexelCount = atlasWidth * atlasHeight;

    const atlasData = new Float32Array(4 * totalTexelCount);
    const passOutputData = new Float32Array(4 * totalTexelCount);

    // pre-fill texel 0 (the diagonal NW neighbour of center texel 4) as already handled
    passOutputData[0 * 4 + 3] = 1;

    storeLightMapValue(
      atlasData,
      atlasWidth,
      totalTexelCount,
      4,
      new THREE.Vector4(1, 1, 1, 0),
      passOutputData
    );

    // texel 0 should be untouched by the diagonal write (still zeroed rgb, alpha preserved)
    expect(passOutputData.slice(0, 4)).toEqual(
      new Float32Array([0, 0, 0, 1])
    );
  });

  it('leaves texels that already belong to a real face untouched by brush propagation', () => {
    const atlasWidth = 3;
    const atlasHeight = 3;
    const totalTexelCount = atlasWidth * atlasHeight;

    const atlasData = new Float32Array(4 * totalTexelCount);
    // mark texel 0's face-encoding slot as non-zero, i.e. it belongs to a real face
    atlasData[0 * 4 + 2] = 42;

    const passOutputData = new Float32Array(4 * totalTexelCount);

    storeLightMapValue(
      atlasData,
      atlasWidth,
      totalTexelCount,
      4,
      new THREE.Vector4(1, 1, 1, 0),
      passOutputData
    );

    expect(passOutputData.slice(0, 4)).toEqual(new Float32Array([0, 0, 0, 0]));
  });
});
