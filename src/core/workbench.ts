import * as THREE from 'three';

import { renderAtlas, AtlasMap } from './atlas';
import { LightProbeSettings, DEFAULT_LIGHT_PROBE_SETTINGS } from './lightProbe';
import { computeAutoUV2Layout } from './AutoUV2';

export interface Workbench {
  aoMode: boolean;
  aoDistance: number;
  emissiveMultiplier: number;
  bounceMultiplier: number;

  lightScene: THREE.Scene;
  atlasMap: AtlasMap;

  // lightmap output
  irradiance: THREE.Texture;
  irradianceData: Float32Array;

  // sampler settings
  settings: LightProbeSettings;
}

const DEFAULT_LIGHTMAP_SIZE = 64;
const DEFAULT_TEXELS_PER_UNIT = 2;
const DEFAULT_AO_DISTANCE = 3;

// global conversion of display -> physical emissiveness
// this is useful because emissive textures normally do not produce enough light to bounce to scene,
// and simply increasing their emissiveIntensity would wash out the user-visible display colours
const DEFAULT_EMISSIVE_MULTIPLIER = 32;

// flags for marking up objects in scene
export const LIGHTMAP_IGNORE_FLAG = Symbol('lightmap ignore flag');
export const LIGHTMAP_UNMAPPED_FLAG = Symbol('lightmap unmapped flag');

const hasOwnProp = Object.prototype.hasOwnProperty;
export function objectHasFlag(object: THREE.Object3D, flag: symbol) {
  return hasOwnProp.call(object.userData, flag);
}

// based on traverse() in https://github.com/mrdoob/three.js/blob/dev/src/core/Object3D.js
// @todo in theory, there could be a need for flagging objects that have UV2 and should be
// in light scene, but ignored in atlas and have their own lightmap
// (really, the "unmapped" flag is not needed, and should instead be "read-only")
export function* traverseSceneItems(
  root: THREE.Object3D,
  ignoreUnmapped?: boolean,
  onIgnored?: (object: THREE.Object3D) => void
) {
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop()!;

    // skip everything invisible and inside opt-out wrappers
    if (
      !current.visible ||
      objectHasFlag(current, LIGHTMAP_IGNORE_FLAG) ||
      (ignoreUnmapped && objectHasFlag(current, LIGHTMAP_UNMAPPED_FLAG))
    ) {
      if (onIgnored) {
        onIgnored(current);
      }
      continue;
    }

    yield current;

    for (const childObject of current.children) {
      stack.push(childObject);
    }
  }
}

function createRendererTexture(
  atlasWidth: number,
  atlasHeight: number,
  textureFilter: THREE.TextureFilter
): [THREE.Texture, Float32Array] {
  const atlasSize = atlasWidth * atlasHeight;
  const data = new Float32Array(4 * atlasSize);

  // not filling texture with test pattern because this goes right into light probe computation
  const texture = new THREE.DataTexture(
    data,
    atlasWidth,
    atlasHeight,
    THREE.RGBAFormat,
    THREE.FloatType
  );

  // set desired texture filter (no mipmaps supported due to the nature of lightmaps)
  texture.magFilter = textureFilter;
  texture.minFilter = textureFilter;
  texture.generateMipmaps = false;

  return [texture, data];
}

// @todo use work manager (though maybe not RAF based?)
function requestNextTick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export type SamplerSettings = Partial<LightProbeSettings>;
export interface WorkbenchSettings {
  ao?: boolean;
  aoDistance?: number;
  emissiveMultiplier?: number;
  bounceMultiplier?: number; // crank up from 1 (default) to light up the corners
  lightMapSize?: number | [number, number];
  textureFilter?: THREE.TextureFilter;
  texelsPerUnit?: number;
  samplerSettings?: SamplerSettings;
}

export async function initializeWorkbench(
  scene: THREE.Scene,
  props: WorkbenchSettings,
  requestWork: () => Promise<THREE.WebGLRenderer>
) {
  const {
    ao,
    aoDistance,
    emissiveMultiplier,
    bounceMultiplier,
    lightMapSize,
    textureFilter,
    texelsPerUnit,
    samplerSettings
  } = props;

  const settings = {
    ...DEFAULT_LIGHT_PROBE_SETTINGS,
    ...samplerSettings
  };

  // parse the convenience setting
  const [initialWidth, initialHeight] = lightMapSize
    ? [
        typeof lightMapSize === 'number' ? lightMapSize : lightMapSize[0],
        typeof lightMapSize === 'number' ? lightMapSize : lightMapSize[1]
      ]
    : [undefined, undefined];

  // wait a bit for responsiveness
  await requestNextTick();

  // perform UV auto-layout in next tick

  const [computedWidth, computedHeight] = computeAutoUV2Layout(
    initialWidth,
    initialHeight,
    traverseSceneItems(scene, true),
    {
      texelsPerUnit: texelsPerUnit || DEFAULT_TEXELS_PER_UNIT
    }
  );

  const lightMapWidth = computedWidth || DEFAULT_LIGHTMAP_SIZE;
  const lightMapHeight = computedHeight || DEFAULT_LIGHTMAP_SIZE;

  await requestNextTick();

  // create renderer texture
  const [irradiance, irradianceData] = createRendererTexture(
    lightMapWidth,
    lightMapHeight,
    textureFilter || THREE.LinearFilter
  );

  // perform atlas mapping
  // (traversing unmapped items as well because some might have own UV2)
  const gl = await requestWork();
  const atlasMap = renderAtlas(
    gl,
    lightMapWidth,
    lightMapHeight,
    traverseSceneItems(scene, false)
  );

  // set up workbench
  return {
    aoMode: !!ao,
    aoDistance: aoDistance || DEFAULT_AO_DISTANCE,
    emissiveMultiplier:
      emissiveMultiplier === undefined
        ? DEFAULT_EMISSIVE_MULTIPLIER
        : emissiveMultiplier,
    bounceMultiplier: bounceMultiplier === undefined ? 1 : bounceMultiplier,

    lightScene: scene,
    atlasMap,

    irradiance,
    irradianceData,

    settings: settings
  };
}
