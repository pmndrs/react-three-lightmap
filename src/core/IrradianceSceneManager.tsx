import React, {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef
} from 'react';
import * as THREE from 'three';

import IrradianceAtlasMapper, {
  Workbench,
  AtlasMap
} from './IrradianceAtlasMapper';
import { computeAutoUV2Layout } from './AutoUV2';

export const IrradianceDebugContext = React.createContext<{
  atlasTexture: THREE.Texture;
  outputTexture: THREE.Texture;
} | null>(null);

const DEFAULT_LIGHTMAP_SIZE = 64;

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

const IrradianceSceneManager: React.FC<{
  initialWidth?: number;
  initialHeight?: number;
  textureFilter?: THREE.TextureFilter;
  texelsPerUnit?: number;
  children: (
    workbench: Workbench | null,
    startWorkbench: (scene: THREE.Scene) => void
  ) => React.ReactNode;
}> = ({
  initialWidth,
  initialHeight,
  textureFilter,
  texelsPerUnit,
  children
}) => {
  // read once
  const initialWidthRef = useRef(initialWidth);
  const initialHeightRef = useRef(initialHeight);
  const textureFilterRef = useRef(textureFilter);
  const texelsPerUnitRef = useRef(texelsPerUnit); // read only once

  // basic snapshot triggered by start handler
  const [workbenchBasics, setWorkbenchBasics] = useState<{
    id: number; // for refresh
    scene: THREE.Scene;
  } | null>(null);

  const startHandler = useCallback((scene: THREE.Scene) => {
    // save a snapshot copy of staging data
    setWorkbenchBasics((prev) => ({
      id: prev ? prev.id + 1 : 1,
      scene
    }));
  }, []);

  // auto-UV step
  const [dimensions, setDimensions] = useState<{
    lightMapWidth: number;
    lightMapHeight: number;
  } | null>(null);
  useEffect(() => {
    if (!workbenchBasics) {
      return;
    }

    const { scene } = workbenchBasics;

    // always clear on any change to workbench
    setDimensions(null);

    // perform UV auto-layout in next tick
    const timeoutId = setTimeout(() => {
      if (texelsPerUnitRef.current) {
        const [lightMapWidth, lightMapHeight] = computeAutoUV2Layout(
          initialWidthRef.current,
          initialHeightRef.current,
          scene,
          {
            texelsPerUnit: texelsPerUnitRef.current
          }
        );

        setDimensions({ lightMapWidth, lightMapHeight });
      } else {
        setDimensions({
          lightMapWidth: initialWidthRef.current || DEFAULT_LIGHTMAP_SIZE,
          lightMapHeight: initialHeightRef.current || DEFAULT_LIGHTMAP_SIZE
        });
      }
    }, 0);

    // always clean up timeout
    return () => clearTimeout(timeoutId);
  }, [workbenchBasics]);

  // lightmap texture (dependent on auto-UV2 step completion)
  const [lightMapBasics, setLightMapBasics] = useState<{
    width: number;
    height: number;
    irradiance: THREE.Texture;
    irradianceData: Float32Array;
  } | null>(null);
  useEffect(() => {
    setLightMapBasics((prev) => {
      // always dispose of old texture
      if (prev) {
        prev.irradiance.dispose();
      }

      // reset old state if restarting the workbench
      if (!dimensions) {
        return null;
      }

      const [irradiance, irradianceData] = createRendererTexture(
        dimensions.lightMapWidth,
        dimensions.lightMapHeight,
        textureFilterRef.current || THREE.LinearFilter
      );

      return {
        width: dimensions.lightMapWidth,
        height: dimensions.lightMapHeight,
        irradiance,
        irradianceData
      };
    });
  }, [dimensions]);

  // full workbench with atlas map
  const [workbench, setWorkbench] = useState<Workbench | null>(null);

  const atlasMapHandler = useCallback(
    (atlasMap: AtlasMap) => {
      if (!workbenchBasics || !lightMapBasics) {
        throw new Error('unexpected early call');
      }

      // save final copy of workbench
      setWorkbench({
        id: workbenchBasics.id,
        lightScene: workbenchBasics.scene,
        atlasMap,

        irradiance: lightMapBasics.irradiance,
        irradianceData: lightMapBasics.irradianceData
      });
    },
    [workbenchBasics, lightMapBasics]
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

      {workbenchBasics && lightMapBasics && (
        <IrradianceAtlasMapper
          key={workbenchBasics.id} // re-create for new workbench
          width={lightMapBasics.width}
          height={lightMapBasics.height}
          lightMap={lightMapBasics.irradiance}
          lightScene={workbenchBasics.scene}
          onComplete={atlasMapHandler}
        />
      )}
    </IrradianceDebugContext.Provider>
  );
};

export default IrradianceSceneManager;
