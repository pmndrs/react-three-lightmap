/*
 * Copyright (c) 2021-now Nick Matantsev
 * Licensed under the MIT license
 */

import React, { useState, useMemo, useCallback, useRef } from 'react';
import * as THREE from 'three';

import { AUTO_UV2_OPT_OUT_FLAG } from './AutoUV2';
import { ATLAS_OPT_OUT_FLAG } from './atlas';
import { withLightScene, SCENE_OPT_OUT_FLAG } from './lightScene';
import { initializeWorkbench, Workbench, WorkbenchSettings } from './workbench';
import { runBakingPasses } from './bake';
import WorkManager, { useWorkRequest } from './WorkManager';
import IrradianceScene from './IrradianceScene';

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

const LocalSuspender: React.FC = () => {
  // always suspend
  const completionPromise = useMemo(() => new Promise(() => undefined), []);
  throw completionPromise;
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
    onComplete: () => void;
    children: (startWorkbench: (scene: THREE.Scene) => void) => React.ReactNode;
  }
> = (props) => {
  // read once
  const propsRef = useRef(props);

  // always have latest callback reference
  const onCompleteRef = useRef(props.onComplete);
  onCompleteRef.current = props.onComplete;

  const requestWork = useWorkRequest();

  // debug reference to workbench for intermediate display
  const [workbench, setWorkbench] = useState<Workbench | null>(null);

  const startHandler = useCallback(
    (scene: THREE.Scene) => {
      // not tracking unmount here because the work manager will bail out anyway when unmounted early
      runWorkflow(scene, propsRef.current, requestWork, (debugWorkbench) => {
        setWorkbench(debugWorkbench);
      }).then(() => {
        onCompleteRef.current();
      });
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
    <DebugContext.Provider value={debugInfo}>
      {props.children(startHandler)}
    </DebugContext.Provider>
  );
};

export type LightmapProps = WorkbenchSettings;

const Lightmap = React.forwardRef<
  THREE.Scene,
  React.PropsWithChildren<LightmapProps>
>(({ children, ...props }, sceneRef) => {
  const [isComplete, setIsComplete] = useState(false);

  return (
    <WorkManager>
      <LightmapMain
        {...props}
        onComplete={() => {
          setIsComplete(true);
        }}
      >
        {(startWorkbench) => (
          <>
            <IrradianceScene ref={sceneRef} onReady={startWorkbench}>
              {children}
            </IrradianceScene>
          </>
        )}
      </LightmapMain>

      {!isComplete && <LocalSuspender />}
    </WorkManager>
  );
});

export default Lightmap;
