/*
 * Copyright (c) 2021-now Nick Matantsev
 * Licensed under the MIT license
 */

import React, { useState, useMemo, useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';

import { AUTO_UV2_OPT_OUT_FLAG } from './AutoUV2';
import { ATLAS_OPT_OUT_FLAG } from './atlas';
import { withLightScene, SCENE_OPT_OUT_FLAG } from './lightScene';
import { initializeWorkbench, Workbench, WorkbenchSettings } from './workbench';
import { runBakingPasses } from './bake';
import WorkManager, { useWorkRequest } from './WorkManager';

// prevent automatic generation of UV2 coordinates for content
// (but still allow contribution to lightmap, for e.g. emissive objects, large occluders, etc)
export const AutoUV2Ignore: React.FC = ({ children }) => {
  return (
    <group
      name="Auto-UV2 opt-out wrapper"
      userData={{
        [AUTO_UV2_OPT_OUT_FLAG]: true
      }}
    >
      {children}
    </group>
  );
};

// prevent wrapped content from affecting the lightmap
// (hide during baking so that this content does not contribute to irradiance)
export const LightmapIgnore: React.FC = ({ children }) => {
  return (
    <group
      name="Lightmap opt-out wrapper"
      userData={{
        [SCENE_OPT_OUT_FLAG]: true,
        [AUTO_UV2_OPT_OUT_FLAG]: true, // no need for auto-UV2 if ignored during baking
        [ATLAS_OPT_OUT_FLAG]: true // no point in including this in atlas
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
}

const LightmapMain: React.FC<
  WorkbenchSettings & {
    children: React.ReactElement;
  }
> = (props) => {
  // read once
  const propsRef = useRef(props);

  const requestWork = useWorkRequest();

  // debug reference to workbench for intermediate display
  const [workbench, setWorkbench] = useState<Workbench | null>(null);

  const [progress, setProgress] = useState<{
    promise: Promise<void>;
    isComplete: boolean;
  } | null>(null);

  const sceneRef = useRef<unknown>();
  useLayoutEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !(scene instanceof THREE.Scene)) {
      throw new Error('expecting lightmap scene');
    }

    // not tracking unmount here because the work manager will bail out anyway when unmounted early
    // @todo check if this runs multiple times on some React versions???
    const promise = runWorkflow(
      scene,
      propsRef.current,
      requestWork,
      (debugWorkbench) => {
        setWorkbench(debugWorkbench);
      }
    ).then(() => {
      // @todo how well does this work while we are suspended?
      setProgress({ promise, isComplete: true });
    });

    setProgress({ promise, isComplete: false });
  }, [requestWork]);

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

  // suspend while our own processing is going on
  if (progress && !progress.isComplete) {
    throw progress.promise;
  }

  // wrap scene in an extra group object
  // so that when this is hidden during suspension only the wrapper has visible=false
  return (
    <DebugContext.Provider value={debugInfo}>
      <group name="Lightmap Scene Wrapper">
        {React.cloneElement(props.children, { ref: sceneRef })}
      </group>
    </DebugContext.Provider>
  );
};

export type LightmapProps = WorkbenchSettings;

const Lightmap = React.forwardRef<
  THREE.Scene,
  React.PropsWithChildren<LightmapProps>
>(({ children, ...props }, sceneRef) => {
  return (
    <WorkManager>
      <LightmapMain {...props}>
        <scene name="Lightmap Scene" ref={sceneRef}>
          {children}
        </scene>
      </LightmapMain>
    </WorkManager>
  );
});

export default Lightmap;
