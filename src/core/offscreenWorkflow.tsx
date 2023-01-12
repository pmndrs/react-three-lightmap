/*
 * Copyright (c) 2021-now Nick Matantsev
 * Licensed under the MIT license
 */

import React, { useLayoutEffect, useRef } from 'react';
import { useThree, createRoot } from '@react-three/fiber';
import * as THREE from 'three';

import { withLightScene } from './lightScene';
import { initializeWorkbench, Workbench, WorkbenchSettings } from './workbench';
import { runBakingPasses } from './bake';
import { createWorkManager } from './WorkManager';

const WorkSceneWrapper: React.FC<{
  onReady: (gl: THREE.WebGLRenderer, scene: THREE.Scene) => void;
  children: React.ReactNode;
}> = (props) => {
  const { gl } = useThree(); // @todo use state selector

  // track latest reference to onReady callback
  const onReadyRef = useRef(props.onReady);
  onReadyRef.current = props.onReady;

  const sceneRef = useRef<THREE.Scene>(null);
  useLayoutEffect(() => {
    // kick off the asynchronous workflow process in the parent
    // (this runs when scene content is loaded and suspensions are finished)
    const scene = sceneRef.current;
    if (!scene) {
      throw new Error('expecting lightmap scene');
    }

    onReadyRef.current(gl, scene);
  }, [gl]);

  // main baking scene container
  return (
    <scene name="Lightmap Baking Scene" ref={sceneRef}>
      {props.children}
    </scene>
  );
};

export type OffscreenSettings = WorkbenchSettings & {
  workPerFrame?: number; // @todo allow fractions, dynamic value
};

export interface Debug {
  onAtlasMap: (atlasMap: Workbench['atlasMap']) => void;
  onPassComplete: (data: Float32Array, width: number, height: number) => void;
}

// main async workflow, allows early cancellation via abortPromise
export async function runOffscreenWorkflow(
  content: React.ReactNode,
  settings: OffscreenSettings,
  abortPromise: Promise<void>,
  debugListeners?: Debug
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
      <React.Suspense fallback={null}>
        <WorkSceneWrapper
          onReady={(gl, scene) => {
            resolve({ gl, scene });
          }}
        >
          {content}
        </WorkSceneWrapper>
      </React.Suspense>
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
  debugListeners?.onAtlasMap(workbench.atlasMap); // expose atlas map for debugging

  await withLightScene(workbench, async () => {
    await runBakingPasses(workbench, requestWork, (data, width, height) => {
      // expose current pass output for debugging
      debugListeners?.onPassComplete(data, width, height);
    });
  });

  return workbench;
}
