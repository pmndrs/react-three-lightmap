import * as THREE from 'three';

import { collectMergePieces, mergePieces } from './mergeScene';
import {
  LIGHTMAP_IGNORE_FLAG,
  LIGHTMAP_READONLY_FLAG,
  objectHasFlag,
  traverseSceneItems
} from './workbench';

export interface BakeSceneResult {
  bakeScene: THREE.Scene;
  mergedMesh: THREE.Mesh;
  materials: THREE.Material[];
  sourceMeshes: THREE.Mesh[];
  dispose: () => void;
}

const tmpPosition = new THREE.Vector3();
const tmpQuaternion = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();

// flattens an object's current world transform into a target object's local transform
// (used to reparent a clone at scene-top-level while keeping its effective world position)
function flattenWorldTransform(source: THREE.Object3D, target: THREE.Object3D) {
  source.updateWorldMatrix(true, false);
  source.matrixWorld.decompose(tmpPosition, tmpQuaternion, tmpScale);
  target.position.copy(tmpPosition);
  target.quaternion.copy(tmpQuaternion);
  target.scale.copy(tmpScale);
}

// Object3D.copy() JSON-round-trips userData, which silently drops our Symbol-keyed flags -
// re-stamp them from the original onto the clone, walking both trees in lockstep
function cloneSymbolFlags(source: THREE.Object3D, clone: THREE.Object3D) {
  if (objectHasFlag(source, LIGHTMAP_READONLY_FLAG)) {
    clone.userData = { ...clone.userData, [LIGHTMAP_READONLY_FLAG]: true };
  }
  if (objectHasFlag(source, LIGHTMAP_IGNORE_FLAG)) {
    clone.userData = { ...clone.userData, [LIGHTMAP_IGNORE_FLAG]: true };
  }

  for (let i = 0; i < source.children.length; i += 1) {
    cloneSymbolFlags(source.children[i], clone.children[i]);
  }
}

// finds the top-most LightmapReadOnly-flagged node in each subtree - does not descend
// past it, since .clone(true) below grabs everything beneath it in one shot
function collectReadOnlyRoots(root: THREE.Object3D): THREE.Object3D[] {
  const roots: THREE.Object3D[] = [];

  function visit(object: THREE.Object3D) {
    if (!object.visible || objectHasFlag(object, LIGHTMAP_IGNORE_FLAG)) {
      return;
    }
    if (objectHasFlag(object, LIGHTMAP_READONLY_FLAG)) {
      roots.push(object);
      return;
    }
    object.children.forEach(visit);
  }

  visit(root);

  return roots;
}

function hasLightTarget(
  light: THREE.Light
): light is THREE.DirectionalLight | THREE.SpotLight {
  return (
    light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight
  );
}

// assembles an isolated, throwaway THREE.Scene for the bake renderer: one merged mesh
// (geometry only - materials get assigned by lightScene.ts's staging step), cloned lights
// (an Object3D can only have one parent, so live lights can't be reused by reference), and
// cloned read-only content (contributes occlusion/bounce, never gets its own UV2/lightmap)
export function buildBakeScene(
  liveRoot: THREE.Object3D
): BakeSceneResult | null {
  liveRoot.updateMatrixWorld(true);

  const pieces = collectMergePieces(liveRoot);
  const merged = mergePieces(pieces);
  if (!merged) {
    return null;
  }

  const bakeScene = new THREE.Scene();
  bakeScene.name = 'Lightmap Baking Scene';

  const mergedMesh = new THREE.Mesh(merged.geometry);
  mergedMesh.name = 'Lightmap Merged Mesh';
  mergedMesh.castShadow = true;
  mergedMesh.receiveShadow = true;
  bakeScene.add(mergedMesh);

  const readOnlyRoots = collectReadOnlyRoots(liveRoot);

  for (const readOnlyRoot of readOnlyRoots) {
    const clone = readOnlyRoot.clone(true);
    cloneSymbolFlags(readOnlyRoot, clone);
    flattenWorldTransform(readOnlyRoot, clone);
    bakeScene.add(clone);
  }

  for (const light of traverseSceneItems(liveRoot, false)) {
    if (!(light instanceof THREE.Light)) {
      continue;
    }

    const lightClone = light.clone();
    flattenWorldTransform(light, lightClone);
    bakeScene.add(lightClone);

    if (hasLightTarget(light) && hasLightTarget(lightClone)) {
      // Light.copy() already cloned .target, but only preserved its local transform -
      // flatten the target's own world transform too and mount it as a real scene child,
      // since shadow-camera logic reads target.matrixWorld
      flattenWorldTransform(light.target, lightClone.target);
      bakeScene.add(lightClone.target);
    }
  }

  return {
    bakeScene,
    mergedMesh,
    materials: merged.materials,
    sourceMeshes: merged.sourceMeshes,

    dispose() {
      // deliberately do NOT call .dispose() on any geometry/material/texture here: clone
      // geometries and original materials are shared by reference with the live scene, and
      // three.js disposal has no ref-counting, so disposing a shared resource here would
      // silently break the live scene. The bake's own dedicated WebGLRenderer/canvas gets
      // thrown away right after this call, which frees all GPU resources tied to it
      // (including compiled staging-material programs) regardless of per-object disposal.
      bakeScene.clear();
    }
  };
}
