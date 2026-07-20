/*
 * Copyright (c) 2021-now Nick Matantsev
 * Licensed under the MIT license
 */

import React, { useLayoutEffect, useRef, useState } from 'react';
import * as THREE from 'three';

// side-effect-only: augments JSX.IntrinsicElements with r3f host elements (<scene>, <group>)
import type {} from '@react-three/fiber';

import {
  runOffscreenWorkflow,
  Debug,
  OffscreenSettings
} from './offscreenWorkflow';
import { LIGHTMAP_READONLY_FLAG, LIGHTMAP_IGNORE_FLAG } from './workbench';

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

export type LightmapProps = OffscreenSettings & {
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
  // (can't wrap this in a hook since the linter would complain if it doesn't see bare useRef)
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // track latest settings without re-triggering the bake effect
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // debug helper
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const debug: Debug = {
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
  const debugRef = useRef(debug);
  debugRef.current = debug;

  const sceneRef = useRef<THREE.Scene>(null);

  // one-way latch: once "disabled" first goes falsy, "started" flips true and stays
  // true, so the effect below fires its one-shot bake exactly once, regardless of how
  // "disabled" is toggled afterwards - cleanup then only ever runs on actual unmount
  const [started, setStarted] = useState(!disabled);
  if (!disabled && !started) {
    setStarted(true);
  }

  useLayoutEffect(() => {
    if (!started) {
      return;
    }

    const scene = sceneRef.current;
    if (!scene) {
      throw new Error('expecting lightmap scene');
    }

    // set up abort signal promise
    let abortResolver = () => undefined as void;
    const abortPromise = new Promise<void>((resolve) => {
      abortResolver = resolve;
    });

    runOffscreenWorkflow(
      scene,
      settingsRef.current,
      abortPromise,
      debugRef.current
    ).then((result) => {
      if (!result) {
        return;
      }

      // the merged output mesh has already been reparented into this same live scene by
      // runOffscreenWorkflow - just hide the individual sources it replaces
      result.sourceMeshes.forEach((mesh) => {
        mesh.visible = false;
      });

      if (onCompleteRef.current) {
        onCompleteRef.current(result.outputTexture);
      }
    });

    // on early unmount, resolve the abort signal promise
    return () => {
      abortResolver();
    };
  }, [started]);

  return (
    <DebugContext.Provider value={debugInfo}>
      <scene name="Lightmap Scene" ref={sceneRef}>
        {children}
      </scene>
    </DebugContext.Provider>
  );
};

export default Lightmap;
