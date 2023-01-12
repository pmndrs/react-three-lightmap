/*
 * Copyright (c) 2021-now Nick Matantsev
 * Licensed under the MIT license
 */

import React, { useState, useMemo, useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';

import { materialIsSupported } from './lightScene';
import {
  traverseSceneItems,
  WorkbenchSettings,
  LIGHTMAP_READONLY_FLAG,
  LIGHTMAP_IGNORE_FLAG
} from './workbench';
import { computeAutoUV2Layout } from './AutoUV2';
import { useOffscreenWorkflow, DebugListener } from './offscreenWorkflow';

// prevent lightmap and UV2 generation for content
// (but still allow contribution to lightmap, for e.g. emissive objects, large occluders, etc)
export const LightmapReadOnly: React.FC<{ children: React.ReactNode }> = ({
  children
}) => {
  return (
    <group
      name="Lightmap read-only wrapper"
      userData={{
        [LIGHTMAP_READONLY_FLAG]: true
      }}
    >
      {children}
    </group>
  );
};

// prevent wrapped content from affecting the lightmap
// (hide during baking so that this content does not contribute to irradiance)
export const LightmapIgnore: React.FC<{ children: React.ReactNode }> = ({
  children
}) => {
  return (
    <group
      name="Lightmap opt-out wrapper"
      userData={{
        [LIGHTMAP_IGNORE_FLAG]: true
      }}
    >
      {children}
    </group>
  );
};

export interface DebugInfo {
  atlasTexture: THREE.Texture;
  outputTexture: THREE.Texture;
}
export const DebugContext = React.createContext<DebugInfo | null>(null);

const DebugListenerContext = React.createContext<DebugListener | null>(null);

// debug helper hook that returns current known debug state and context wrapper
export function useLightmapDebug(): [
  DebugInfo | null,
  React.FC<React.PropsWithChildren>
] {
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);

  // stable value to pass down via context to the lightmap baker
  const debugContextValue = useMemo<DebugListener>(
    () => ({
      onAtlasMap(atlasMap) {
        // initialize debug display of atlas texture as well as blank placeholder for output
        const atlasTexture = new THREE.DataTexture(
          atlasMap.data,
          atlasMap.width,
          atlasMap.height,
          THREE.RGBAFormat,
          THREE.FloatType
        );

        const outputTexture = new THREE.DataTexture(
          new Float32Array(atlasMap.width * atlasMap.height * 4),
          atlasMap.width,
          atlasMap.height,
          THREE.RGBAFormat,
          THREE.FloatType
        );

        setDebugInfo({
          atlasTexture,
          outputTexture
        });
      },
      onPassComplete(data, width, height) {
        setDebugInfo(
          (prev) =>
            prev && {
              ...prev,

              // replace with a new texture with copied source buffer data
              outputTexture: new THREE.DataTexture(
                new Float32Array(data),
                width,
                height,
                THREE.RGBAFormat,
                THREE.FloatType
              )
            }
        );
      }
    }),
    []
  );

  return [
    debugInfo,
    ({ children }) => (
      <DebugListenerContext.Provider value={debugContextValue}>
        {children}
      </DebugListenerContext.Provider>
    )
  ];
}

// set the computed irradiance texture on real scene materials
function updateFinalSceneMaterials(
  scene: THREE.Scene,
  irradiance: THREE.Texture,
  aoMode: boolean
) {
  // process relevant meshes
  for (const object of traverseSceneItems(scene, false)) {
    // simple check for type (no need to check for uv2 presence)
    if (!(object instanceof THREE.Mesh)) {
      continue;
    }

    const mesh = object;

    const materialList: (THREE.Material | null)[] = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];

    // fill in the computed maps
    materialList.forEach((material) => {
      if (!material || !materialIsSupported(material)) {
        return;
      }

      // set up our AO or lightmap as needed
      if (aoMode) {
        material.aoMap = irradiance;
        material.needsUpdate = true;
      } else {
        material.lightMap = irradiance;
        material.needsUpdate = true;
      }
    });
  }
}

export type LightmapProps = WorkbenchSettings & {
  workPerFrame?: number; // @todo allow fractions, dynamic value
  disabled?: boolean;
  onComplete?: (result: THREE.Texture) => void;
};

const Lightmap: React.FC<React.PropsWithChildren<LightmapProps>> = ({
  disabled,
  onComplete,
  children,
  ...settings
}) => {
  // track latest reference to onComplete callback
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // debug helper
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const debug: DebugListener = {
    onAtlasMap(atlasMap) {
      // initialize debug display of atlas texture as well as blank placeholder for output
      const atlasTexture = new THREE.DataTexture(
        atlasMap.data,
        atlasMap.width,
        atlasMap.height,
        THREE.RGBAFormat,
        THREE.FloatType
      );

      const outputTexture = new THREE.DataTexture(
        new Float32Array(atlasMap.width * atlasMap.height * 4),
        atlasMap.width,
        atlasMap.height,
        THREE.RGBAFormat,
        THREE.FloatType
      );

      setDebugInfo({
        atlasTexture,
        outputTexture
      });
    },
    onPassComplete(data, width, height) {
      setDebugInfo(
        (prev) =>
          prev && {
            ...prev,

            // replace with a new texture with copied source buffer data
            outputTexture: new THREE.DataTexture(
              new Float32Array(data),
              width,
              height,
              THREE.RGBAFormat,
              THREE.FloatType
            )
          }
      );
    }
  };

  // main offscreen workflow state
  const result = useOffscreenWorkflow(
    disabled ? null : children,
    settings,
    debug
  );

  const sceneRef = useRef<THREE.Scene>(null);

  useLayoutEffect(() => {
    if (!result || !sceneRef.current) {
      return;
    }

    // create UV2 coordinates for the final scene meshes
    // @todo somehow reuse ones from the baker?
    computeAutoUV2Layout(
      [result.atlasMap.width, result.atlasMap.height],
      traverseSceneItems(sceneRef.current, true),
      {
        texelsPerUnit: result.texelsPerUnit
      }
    );

    // copy texture data since this is coming from a foreign canvas
    const texture = result.createOutputTexture();

    updateFinalSceneMaterials(sceneRef.current, texture, result.aoMode);

    // notify listener and pass the texture instance intended for parent GL context
    if (onCompleteRef.current) {
      onCompleteRef.current(texture);
    }
  }, [result]);

  // show final scene only when baking is done because it may contain loaded GLTF mesh instances
  // (which end up cached and reused, so only one scene can attach them at a time anyway)
  return (
    <DebugContext.Provider value={debugInfo}>
      {result ? (
        <scene name="Lightmap Result Scene" ref={sceneRef}>
          {children}
        </scene>
      ) : null}
    </DebugContext.Provider>
  );
};

export default Lightmap;
