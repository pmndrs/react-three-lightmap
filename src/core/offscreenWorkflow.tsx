import * as THREE from 'three';

import { initializeWorkbench, Workbench, WorkbenchSettings } from './workbench';
import { buildBakeScene } from './bakeScene';
import { materialIsSupported, stageLightSceneMaterials } from './lightScene';
import { runBakingPasses } from './bake';
import { createWorkManager } from './WorkManager';

export type OffscreenSettings = WorkbenchSettings & {
  workPerFrame?: number; // @todo allow fractions, dynamic value
};

export interface Debug {
  onAtlasMap: (atlasMap: Workbench['atlasMap']) => void;
  onPassComplete: (
    data: Float32Array<ArrayBuffer>,
    width: number,
    height: number
  ) => void;
}

export interface BakeWorkflowResult {
  mergedMesh: THREE.Mesh;
  sourceMeshes: THREE.Mesh[];
  outputTexture: THREE.Texture;
  aoMode: boolean;
}

// orchestrates a single bake: collect+merge the live scene's contributing content into an
// isolated bake scene (buildBakeScene), run the existing UV2/atlas/light-probe pipeline
// against it with a dedicated, throwaway WebGLRenderer (no second React root anywhere),
// then reparent the same merged mesh - now carrying baked UV2 + lightmap - into the live
// scene. Returns null when there is nothing to bake (only read-only/ignored content present).
export async function runOffscreenWorkflow(
  liveScene: THREE.Scene,
  settings: OffscreenSettings,
  abortPromise: Promise<void>,
  debugListeners?: Debug
): Promise<BakeWorkflowResult | null> {
  const bakeSceneResult = buildBakeScene(liveScene);
  if (!bakeSceneResult) {
    return null;
  }

  const { bakeScene, mergedMesh, materials, sourceMeshes } = bakeSceneResult;

  // dedicated, throwaway canvas + renderer for the isolated bake render passes - never
  // attached to the DOM, never a React root, disposed (with the canvas) once baking finishes
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;

  const gl = new THREE.WebGLRenderer({ canvas, antialias: false });
  gl.shadowMap.enabled = true; // @todo mirror the live canvas's actual GL/shadow settings

  try {
    const requestWork = createWorkManager(
      gl,
      abortPromise,
      settings.workPerFrame
    );

    const workbench = await initializeWorkbench(
      bakeScene,
      settings,
      requestWork
    );
    debugListeners?.onAtlasMap(workbench.atlasMap);

    await stageLightSceneMaterials(
      workbench,
      mergedMesh,
      materials,
      async () => {
        await runBakingPasses(workbench, requestWork, (data, width, height) => {
          debugListeners?.onPassComplete(data, width, height);
        });
      }
    );

    // build final materials - clone each original rather than mutating the shared
    // instance, since it may still be referenced elsewhere (e.g. read-only content)
    const outputTexture = workbench.createOutputTexture();

    const finalMaterials = materials.map((material) => {
      if (!materialIsSupported(material)) {
        return material;
      }

      const finalMaterial = material.clone();
      if (workbench.aoMode) {
        finalMaterial.aoMap = outputTexture;
      } else {
        finalMaterial.lightMap = outputTexture;
      }
      finalMaterial.needsUpdate = true;
      return finalMaterial;
    });

    mergedMesh.material = finalMaterials;

    // reparent the same mesh/geometry object into the live scene
    bakeScene.remove(mergedMesh);
    liveScene.add(mergedMesh);

    return {
      mergedMesh,
      sourceMeshes,
      outputTexture,
      aoMode: workbench.aoMode
    };
  } finally {
    // if successful, mergedMesh has already been reparented out of bakeScene by this point
    bakeSceneResult.dispose();
    gl.dispose();
  }
}
