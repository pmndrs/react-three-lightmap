import * as THREE from 'three';

import { renderAtlas, AtlasMap } from './atlas';
import { LightProbeSettings, DEFAULT_LIGHT_PROBE_SETTINGS } from './lightProbe';
import { computeAutoUV2Layout } from './AutoUV2';

export interface Workbench {
  aoMode: boolean;
  aoDistance: number;
  emissiveMultiplier: number;

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
    scene,
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
  const gl = await requestWork();
  const atlasMap = renderAtlas(gl, lightMapWidth, lightMapHeight, scene);

  // set up workbench
  return {
    aoMode: !!ao,
    aoDistance: aoDistance || DEFAULT_AO_DISTANCE,
    emissiveMultiplier:
      emissiveMultiplier === undefined
        ? DEFAULT_EMISSIVE_MULTIPLIER
        : emissiveMultiplier,

    lightScene: scene,
    atlasMap,

    irradiance,
    irradianceData,

    settings: settings
  };
}