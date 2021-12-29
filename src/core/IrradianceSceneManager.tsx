import React, { useState, useMemo, useCallback, useRef } from 'react';
import * as THREE from 'three';

import { useWorkRequest } from './WorkManager';
import { renderAtlas, AtlasMap } from './atlas';
import { LightProbeSettings } from './lightProbe';
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

export const IrradianceDebugContext = React.createContext<{
  atlasTexture: THREE.Texture;
  outputTexture: THREE.Texture;
} | null>(null);

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

const IrradianceSceneManager: React.FC<{
  aoMode: boolean;
  aoDistance?: number;
  emissiveMultiplier?: number;
  initialWidth?: number;
  initialHeight?: number;
  textureFilter?: THREE.TextureFilter;
  texelsPerUnit?: number;
  settings: LightProbeSettings;
  children: (
    workbench: Workbench | null,
    startWorkbench: (scene: THREE.Scene) => void
  ) => React.ReactNode;
}> = ({
  aoMode,
  aoDistance,
  emissiveMultiplier,
  initialWidth,
  initialHeight,
  textureFilter,
  texelsPerUnit,
  settings,
  children
}) => {
  // read once
  const aoModeRef = useRef(aoMode);
  const aoDistanceRef = useRef(aoDistance);
  const emissiveMultiplierRef = useRef(emissiveMultiplier);
  const initialWidthRef = useRef(initialWidth);
  const initialHeightRef = useRef(initialHeight);
  const textureFilterRef = useRef(textureFilter);
  const texelsPerUnitRef = useRef(texelsPerUnit); // read only once
  const settingsRef = useRef(settings); // read only once

  const requestWork = useWorkRequest();

  // full workbench with atlas map
  const [workbench, setWorkbench] = useState<Workbench | null>(null);

  const startHandler = useCallback(
    (scene: THREE.Scene) => {
      async function initialize() {
        // wait a bit for responsiveness
        await requestNextTick();

        // perform UV auto-layout in next tick

        const [computedWidth, computedHeight] = computeAutoUV2Layout(
          initialWidthRef.current,
          initialHeightRef.current,
          scene,
          {
            texelsPerUnit: texelsPerUnitRef.current || DEFAULT_TEXELS_PER_UNIT
          }
        );

        const lightMapWidth = computedWidth || DEFAULT_LIGHTMAP_SIZE;
        const lightMapHeight = computedHeight || DEFAULT_LIGHTMAP_SIZE;

        await requestNextTick();

        // create renderer texture
        const [irradiance, irradianceData] = createRendererTexture(
          lightMapWidth,
          lightMapHeight,
          textureFilterRef.current || THREE.LinearFilter
        );

        // perform atlas mapping
        const gl = await requestWork();
        const atlasMap = renderAtlas(gl, lightMapWidth, lightMapHeight, scene);

        // set up workbench
        setWorkbench({
          aoMode: aoModeRef.current,
          aoDistance: aoDistanceRef.current || DEFAULT_AO_DISTANCE,
          emissiveMultiplier:
            emissiveMultiplierRef.current === undefined
              ? DEFAULT_EMISSIVE_MULTIPLIER
              : emissiveMultiplierRef.current,

          lightScene: scene,
          atlasMap,

          irradiance,
          irradianceData,

          settings: settingsRef.current
        });
      }

      initialize();
    },
    [requestWork]
  );

  const debugInfo = useMemo(
    () =>
      workbench
        ? {
            atlasTexture: workbench.atlasMap.texture,
            outputTexture: workbench.irradiance
          }
        : null,
    [workbench]
  );

  return (
    <IrradianceDebugContext.Provider value={debugInfo}>
      {children(workbench, startHandler)}
    </IrradianceDebugContext.Provider>
  );
};

export default IrradianceSceneManager;
