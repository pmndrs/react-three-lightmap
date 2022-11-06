/*
 * Copyright (c) 2021-now Nick Matantsev
 * Licensed under the MIT license
 */

import React, { useState, useMemo, useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';

import { withLightScene, materialIsSupported } from './lightScene';
import {
  initializeWorkbench,
  traverseSceneItems,
  Workbench,
  WorkbenchSettings,
  LIGHTMAP_READONLY_FLAG,
  LIGHTMAP_IGNORE_FLAG
} from './workbench';
import { runBakingPasses } from './bake';
import WorkManager, { useWorkRequest } from './WorkManager';

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

// main asynchronous workflow sequence
async function runWorkflow(
  scene: THREE.Scene,
  props: WorkbenchSettings,
  requestWork: () => Promise<THREE.WebGLRenderer>,
  onWorkbenchDebug: (workbench: Workbench) => void
) {
  const workbench = await initializeWorkbench(scene, props, requestWork);
  onWorkbenchDebug(workbench);

  await withLightScene(workbench, async () => {
    await runBakingPasses(workbench, requestWork);
  });

  updateFinalSceneMaterials(
    workbench.lightScene,
    workbench.irradiance,
    workbench.aoMode
  );

  return workbench.irradiance;
}

const LightmapMain: React.FC<
  WorkbenchSettings & {
    disabled?: boolean;
    onComplete?: (result: THREE.Texture) => void;
    children: React.ReactElement;
  }
> = (props) => {
  // read once
  const initialPropsRef = useRef(props);

  const requestWork = useWorkRequest();

  // disabled prop can start out true and become false, but afterwards we ignore it
  const enabledRef = useRef(!props.disabled);
  enabledRef.current = enabledRef.current || !props.disabled;
  const allowStart = enabledRef.current;

  // track latest reference to onComplete callback
  const onCompleteRef = useRef(props.onComplete);
  onCompleteRef.current = props.onComplete;
  useLayoutEffect(() => {
    return () => {
      // if we unmount early, prevent our async workflow from calling a stale callback
      onCompleteRef.current = undefined;
    };
  }, []);

  // debug reference to workbench for intermediate display
  const [workbench, setWorkbench] = useState<Workbench | null>(null);

  const sceneRef = useRef<unknown>();
  useLayoutEffect(() => {
    // ignore if nothing to do yet
    if (!allowStart) {
      return;
    }

    // kick off the asynchronous workflow process
    // (this runs when scene content is loaded and suspensions are finished)
    Promise.resolve()
      .then(() => {
        const scene = sceneRef.current;
        if (!scene || !(scene instanceof THREE.Scene)) {
          throw new Error('expecting lightmap scene');
        }

        // not tracking unmount here because the work manager will bail out anyway when unmounted early
        // @todo check if this runs multiple times on some React versions???
        return runWorkflow(
          scene,
          initialPropsRef.current,
          requestWork,
          (debugWorkbench) => {
            setWorkbench(debugWorkbench);
          }
        );
      })
      .then((result) => {
        if (onCompleteRef.current) {
          onCompleteRef.current(result);
        }
      });
  }, [allowStart, requestWork]);

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

  // wrap scene in an extra group object
  // so that when this is hidden during suspension only the wrapper has visible=false
  const content = (
    <group name="Lightmap Scene Wrapper">
      {React.cloneElement(props.children, { ref: sceneRef })}
    </group>
  );

  return (
    <DebugContext.Provider value={debugInfo}>{content}</DebugContext.Provider>
  );
};

export type LightmapProps = WorkbenchSettings & {
  disabled?: boolean;
  workPerFrame?: number; // @todo allow fractions, dynamic value
  onComplete?: (result: THREE.Texture) => void;
};

const Lightmap: React.FC<React.PropsWithChildren<LightmapProps>> = ({
  workPerFrame,
  children,
  ...props
}) => {
  return (
    <WorkManager workPerFrame={workPerFrame}>
      <LightmapMain {...props}>
        <scene name="Lightmap Scene">{children}</scene>
      </LightmapMain>
    </WorkManager>
  );
};

export default Lightmap;
