/*
 * Copyright (c) 2021-now Nick Matantsev
 * Licensed under the MIT license
 */

import React, { useState, useMemo, useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';

import { withLightScene } from './lightScene';
import {
  initializeWorkbench,
  Workbench,
  WorkbenchSettings,
  LIGHTMAP_UNMAPPED_FLAG,
  LIGHTMAP_IGNORE_FLAG
} from './workbench';
import { runBakingPasses } from './bake';
import WorkManager, { useWorkRequest } from './WorkManager';

// prevent automatic generation of UV2 coordinates for content
// (but still allow contribution to lightmap, for e.g. emissive objects, large occluders, etc)
export const AutoUV2Ignore: React.FC = ({ children }) => {
  return (
    <group
      name="Auto-UV2 opt-out wrapper"
      userData={{
        [LIGHTMAP_UNMAPPED_FLAG]: true
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

const Suspender: React.FC<{ promise: Promise<void> }> = ({ promise }) => {
  throw promise;
};

// simply expose a promise that completes when this element is unmounted
const LegacySuspenseFallbackIntercept: React.FC<{
  onStarted: (promise: Promise<void>) => void;
}> = ({ onStarted }) => {
  const onStartedRef = useRef(onStarted);
  onStartedRef.current = onStarted;

  useLayoutEffect(() => {
    let onFinished = () => {};
    const unmountPromise = new Promise<void>((resolve) => {
      onFinished = resolve;
    });

    onStartedRef.current(unmountPromise);

    return () => {
      onFinished();
    };
  }, []);

  // parent will re-suspend with own long-running promise
  return null;
};

const LightmapMain: React.FC<
  WorkbenchSettings & {
    disabled?: boolean;
    legacySuspense?: boolean;
    children: React.ReactElement;
  }
> = (props) => {
  // read once
  const propsRef = useRef(props);
  const isLegacyRef = useRef(!!props.legacySuspense);

  const requestWork = useWorkRequest();

  // disabled prop can start out true and become false, but afterwards we ignore it
  const enabledRef = useRef(!props.disabled);
  enabledRef.current = enabledRef.current || !props.disabled;
  const allowStart = enabledRef.current;

  // debug reference to workbench for intermediate display
  const [workbench, setWorkbench] = useState<Workbench | null>(null);

  const [progress, setProgress] = useState<{
    promise: Promise<void>;
    isComplete: boolean;
  } | null>(null);

  const legacySuspenseWaitPromiseRef = useRef<Promise<void> | null>(null);
  const sceneRef = useRef<unknown>();
  useLayoutEffect(() => {
    // ignore if nothing to do yet
    if (!allowStart) {
      return;
    }

    // await until wrapped scene is loaded, if suspense was triggered
    const sceneReadyPromise =
      legacySuspenseWaitPromiseRef.current || Promise.resolve();

    const promise = sceneReadyPromise
      .then(() => {
        const scene = sceneRef.current;
        if (!scene || !(scene instanceof THREE.Scene)) {
          throw new Error('expecting lightmap scene');
        }

        // not tracking unmount here because the work manager will bail out anyway when unmounted early
        // @todo check if this runs multiple times on some React versions???
        return runWorkflow(
          scene,
          propsRef.current,
          requestWork,
          (debugWorkbench) => {
            setWorkbench(debugWorkbench);
          }
        );
      })
      .then(() => {
        // @todo how well does this work while we are suspended?
        setProgress({ promise, isComplete: true });
      });

    setProgress({ promise, isComplete: false });
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
    <DebugContext.Provider value={debugInfo}>
      {progress && !progress.isComplete ? (
        <Suspender promise={progress.promise} />
      ) : null}

      {isLegacyRef.current ? (
        // in legacy suspense mode, our effect runs before content may load
        // so we use a special "detector"  to see when the content suspense is complete
        <React.Suspense
          fallback={
            <LegacySuspenseFallbackIntercept
              onStarted={(promise) => {
                legacySuspenseWaitPromiseRef.current = promise;
              }}
            />
          }
        >
          {content}
        </React.Suspense>
      ) : (
        content
      )}
    </DebugContext.Provider>
  );
};

// set "legacySuspense" to correctly wait for content load in legacy Suspense mode
export type LightmapProps = WorkbenchSettings & {
  disabled?: boolean;
  legacySuspense?: boolean;
  workPerFrame?: number; // @todo allow fractions, dynamic value
};

const Lightmap = React.forwardRef<
  THREE.Scene,
  React.PropsWithChildren<LightmapProps>
>(({ workPerFrame, children, ...props }, sceneRef) => {
  return (
    <WorkManager workPerFrame={workPerFrame}>
      <LightmapMain {...props}>
        <scene name="Lightmap Scene" ref={sceneRef}>
          {children}
        </scene>
      </LightmapMain>
    </WorkManager>
  );
});

export default Lightmap;
