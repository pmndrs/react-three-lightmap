/*
 * Copyright (c) 2021-now Nick Matantsev
 * Licensed under the MIT license
 */

import React, { useState, useMemo, useCallback, useRef } from 'react';
import * as THREE from 'three';

import { AUTO_UV2_OPT_OUT_FLAG } from './AutoUV2';
import { ATLAS_OPT_OUT_FLAG } from './atlas';
import { SCENE_OPT_OUT_FLAG } from './lightScene';
import { initializeWorkbench, Workbench, WorkbenchSettings } from './workbench';
import WorkManager, { useWorkRequest } from './WorkManager';
import IrradianceRenderer from './IrradianceRenderer';
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

const LightmapMain: React.FC<
  WorkbenchSettings & {
    children: (
      workbench: Workbench | null,
      startWorkbench: (scene: THREE.Scene) => void
    ) => React.ReactNode;
  }
> = (props) => {
  // read once
  const propsRef = useRef(props);

  const requestWork = useWorkRequest();

  // full workbench with atlas map
  const [workbench, setWorkbench] = useState<Workbench | null>(null);

  const startHandler = useCallback(
    (scene: THREE.Scene) => {
      initializeWorkbench(scene, propsRef.current, requestWork).then(
        (result) => {
          setWorkbench(result);
        }
      );
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
      {props.children(workbench, startHandler)}
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
      <LightmapMain {...props}>
        {(workbench, startWorkbench) => (
          <>
            {workbench && !isComplete && (
              <IrradianceRenderer
                workbench={workbench}
                onComplete={() => {
                  setIsComplete(true);
                }}
              />
            )}

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
