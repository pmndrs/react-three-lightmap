/*
 * Copyright (c) 2021-now Nick Matantsev
 * Licensed under the MIT license
 */

import React, { useState, useMemo, useLayoutEffect, useRef } from 'react';
import { useThree, createRoot } from '@react-three/fiber';
import * as THREE from 'three';

import { setLightSceneMaterials, materialIsSupported } from './lightScene';
import {
  initializeWorkbench,
  traverseSceneItems,
  Workbench,
  WorkbenchSettings,
  LIGHTMAP_READONLY_FLAG,
  LIGHTMAP_IGNORE_FLAG
} from './workbench';
import { runBakingPasses } from './bake';
import { computeAutoUV2Layout } from './AutoUV2';
import { createWorkManager } from './WorkManager';

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

export const DebugContext = React.createContext<{
  atlasTexture: THREE.Texture;
  outputTexture: THREE.Texture;
} | null>(null);

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

// @todo disabled prop
const WorkSceneWrapper: React.FC<{
  onReady: (gl: THREE.WebGLRenderer, scene: THREE.Scene) => void;
  children: React.ReactNode;
}> = (props) => {
  const { gl } = useThree(); // @todo use state selector

  // track latest reference to onComplete callback
  const onReadyRef = useRef(props.onReady);
  onReadyRef.current = props.onReady;

  const sceneRef = useRef<THREE.Scene>();
  useLayoutEffect(() => {
    // kick off the asynchronous workflow process in the parent
    // (this runs when scene content is loaded and suspensions are finished)
    const scene = sceneRef.current;
    if (!scene) {
      throw new Error('expecting lightmap scene');
    }

    onReadyRef.current(gl, scene);
  }, [gl]);

  // @todo debug reference to workbench for intermediate display
  const debugInfo = useMemo(() => null, []);

  // wrap scene in an extra group object
  // so that when this is hidden during suspension only the wrapper has visible=false
  const content = (
    <scene name="Lightmap Baking Scene" ref={sceneRef}>
      {props.children}
    </scene>
  );

  return (
    <DebugContext.Provider value={debugInfo}>{content}</DebugContext.Provider>
  );
};

// @todo deal with disabled flag
type OffscreenSettings = WorkbenchSettings & {
  workPerFrame?: number; // @todo allow fractions, dynamic value
};

// main async workflow, allows early cancellation via abortPromise
async function runOffscreenWorkflow(
  content: React.ReactNode,
  settings: OffscreenSettings,
  abortPromise: Promise<void>
) {
  // render hidden canvas with the given content, wait for suspense to finish loading inside it
  const scenePromise = await new Promise<{
    gl: THREE.WebGLRenderer;
    scene: THREE.Scene;
  }>((resolve) => {
    // just sensible small canvas, not actually used for direct output
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;

    const root = createRoot(canvas).configure({
      frameloop: 'never', // framebuffer target rendering is inside own RAF loop
      shadows: true // @todo use the original GL context settings
    });

    root.render(
      <WorkSceneWrapper
        onReady={(gl, scene) => {
          resolve({ gl, scene });
        }}
      >
        {content}
      </WorkSceneWrapper>
    );
  });

  // preempt any further logic if already aborted
  const { gl, scene } = await Promise.race([
    scenePromise,
    abortPromise.then(() => {
      throw new Error('aborted before scene is complete');
    })
  ]);

  // our own work manager (which is aware of the abort signal promise)
  const requestWork = createWorkManager(
    gl,
    abortPromise,
    settings.workPerFrame
  );

  const workbench = await initializeWorkbench(scene, settings, requestWork);
  // @todo this onWorkbenchDebug(workbench);

  await setLightSceneMaterials(workbench);
  await runBakingPasses(workbench, requestWork);

  return workbench;
}

export type LightmapProps = WorkbenchSettings & {
  disabled?: boolean;
  workPerFrame?: number; // @todo allow fractions, dynamic value
  onComplete?: (result: THREE.Texture) => void;
};

const Lightmap: React.FC<React.PropsWithChildren<LightmapProps>> = ({
  onComplete,
  ...props
}) => {
  const initialPropsRef = useRef(props);

  const [result, setResult] = useState<Workbench | null>(null);

  useLayoutEffect(() => {
    // @todo check if this runs multiple times on some React versions???
    const { children, ...settings } = initialPropsRef.current;

    // set up abort signal promise
    let abortResolver = () => undefined as void;
    const abortPromise = new Promise<void>((resolve) => {
      abortResolver = resolve;
    });

    // run main logic with the abort signal promise
    const workflowResult = runOffscreenWorkflow(
      children,
      settings,
      abortPromise
    );

    workflowResult.then((result) => {
      setResult(result);
    });

    // on early unmount, resolve the abort signal promise
    return () => {
      abortResolver();
    };
  }, []);

  const sceneRef = useRef<THREE.Scene>(null);

  useLayoutEffect(() => {
    if (!result || !sceneRef.current) {
      return;
    }

    // create UV2 coordinates for the final scene meshes
    // @todo somehow reuse ones from the baker?
    computeAutoUV2Layout(
      initialPropsRef.current.lightMapSize,
      traverseSceneItems(sceneRef.current, true),
      {
        texelsPerUnit: result.texelsPerUnit
      }
    );

    // copy texture data since this is a foreign canvas
    const texture = result.createOutputTexture();

    updateFinalSceneMaterials(
      sceneRef.current,
      texture,
      !!initialPropsRef.current.ao
    );
  }, [result]);

  return (
    <scene name="Lightmap Result Scene" ref={sceneRef}>
      {props.children}
    </scene>
  );
};

export default Lightmap;
