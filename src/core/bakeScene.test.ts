import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { buildBakeScene } from './bakeScene';
import {
  LIGHTMAP_IGNORE_FLAG,
  LIGHTMAP_READONLY_FLAG,
  objectHasFlag
} from './workbench';

function makeTriangleGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3)
  );
  geometry.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3)
  );
  return geometry;
}

describe('buildBakeScene', () => {
  it('returns null when there is nothing to merge', () => {
    const root = new THREE.Scene();
    expect(buildBakeScene(root)).toBeNull();
  });

  it('builds a merged mesh from contributing content and exposes source meshes/materials', () => {
    const root = new THREE.Scene();
    const mesh = new THREE.Mesh(
      makeTriangleGeometry(),
      new THREE.MeshStandardMaterial()
    );
    root.add(mesh);

    const result = buildBakeScene(root);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.mergedMesh.geometry.attributes.position.count).toBe(3);
    expect(result.sourceMeshes).toEqual([mesh]);
    expect(result.materials).toEqual([mesh.material]);
    expect(result.bakeScene.children).toContain(result.mergedMesh);
  });

  it('clones LightmapReadOnly content and preserves its userData flag on the clone', () => {
    const root = new THREE.Scene();

    // something to merge, so buildBakeScene doesn't bail early
    root.add(
      new THREE.Mesh(makeTriangleGeometry(), new THREE.MeshStandardMaterial())
    );

    const readOnlyGroup = new THREE.Group();
    readOnlyGroup.name = 'read-only root';
    readOnlyGroup.userData = { [LIGHTMAP_READONLY_FLAG]: true };
    const readOnlyMesh = new THREE.Mesh(
      makeTriangleGeometry(),
      new THREE.MeshStandardMaterial()
    );
    readOnlyGroup.add(readOnlyMesh);
    root.add(readOnlyGroup);

    const result = buildBakeScene(root);
    expect(result).not.toBeNull();
    if (!result) return;

    const clonedRoot = result.bakeScene.children.find(
      (child) => child.name === 'read-only root'
    );
    expect(clonedRoot).toBeDefined();
    expect(clonedRoot).not.toBe(readOnlyGroup);

    // this is the exact bug: Object3D.copy() JSON-round-trips userData and silently
    // drops Symbol-keyed properties, so this assertion fails without the fixup pass
    expect(objectHasFlag(clonedRoot!, LIGHTMAP_READONLY_FLAG)).toBe(true);

    // the read-only mesh itself was cloned too (deep clone)
    expect(clonedRoot!.children).toHaveLength(1);
    expect(clonedRoot!.children[0]).not.toBe(readOnlyMesh);
    // geometry/material shared by reference (cheap clone, per Mesh.copy() semantics)
    expect((clonedRoot!.children[0] as THREE.Mesh).geometry).toBe(
      readOnlyMesh.geometry
    );
  });

  it('does not clone LightmapIgnore content at all', () => {
    const root = new THREE.Scene();
    root.add(
      new THREE.Mesh(makeTriangleGeometry(), new THREE.MeshStandardMaterial())
    );

    const ignoredGroup = new THREE.Group();
    ignoredGroup.name = 'ignored root';
    ignoredGroup.userData = { [LIGHTMAP_IGNORE_FLAG]: true };
    ignoredGroup.add(
      new THREE.Mesh(makeTriangleGeometry(), new THREE.MeshStandardMaterial())
    );
    root.add(ignoredGroup);

    const result = buildBakeScene(root);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(
      result.bakeScene.children.find((child) => child.name === 'ignored root')
    ).toBeUndefined();
  });

  it('clones lights and flattens their world transform onto the clone', () => {
    const root = new THREE.Scene();
    root.add(
      new THREE.Mesh(makeTriangleGeometry(), new THREE.MeshStandardMaterial())
    );

    const parent = new THREE.Group();
    parent.position.set(1, 2, 3);
    const light = new THREE.PointLight('#ffffff', 1);
    light.position.set(10, 0, 0);
    parent.add(light);
    root.add(parent);

    const result = buildBakeScene(root);
    expect(result).not.toBeNull();
    if (!result) return;

    const lightClone = result.bakeScene.children.find(
      (child) => child instanceof THREE.PointLight
    ) as THREE.PointLight | undefined;
    expect(lightClone).toBeDefined();
    expect(lightClone).not.toBe(light);

    // world position should be (11, 2, 3): parent offset + light's local offset,
    // baked into the clone's own local position since it's now a top-level scene child
    expect(lightClone!.position.x).toBeCloseTo(11, 5);
    expect(lightClone!.position.y).toBeCloseTo(2, 5);
    expect(lightClone!.position.z).toBeCloseTo(3, 5);
  });

  it('clones a directional light target and flattens its world transform too', () => {
    const root = new THREE.Scene();
    root.add(
      new THREE.Mesh(makeTriangleGeometry(), new THREE.MeshStandardMaterial())
    );

    const light = new THREE.DirectionalLight('#ffffff', 1);
    light.position.set(0, 5, 0);
    light.target.position.set(2, 0, 0);
    root.add(light);
    root.add(light.target);

    const result = buildBakeScene(root);
    expect(result).not.toBeNull();
    if (!result) return;

    const lightClone = result.bakeScene.children.find(
      (child) => child instanceof THREE.DirectionalLight
    ) as THREE.DirectionalLight | undefined;
    expect(lightClone).toBeDefined();

    expect(result.bakeScene.children).toContain(lightClone!.target);
    expect(lightClone!.target.position.x).toBeCloseTo(2, 5);
    expect(lightClone!.target.position.y).toBeCloseTo(0, 5);
  });

  it('dispose() clears the bake scene without touching shared geometry/material', () => {
    const root = new THREE.Scene();
    const mesh = new THREE.Mesh(
      makeTriangleGeometry(),
      new THREE.MeshStandardMaterial()
    );
    root.add(mesh);

    const result = buildBakeScene(root);
    expect(result).not.toBeNull();
    if (!result) return;

    result.dispose();
    expect(result.bakeScene.children).toHaveLength(0);
    // original mesh's geometry/material untouched (not disposed - no exception, still usable)
    expect(mesh.geometry.attributes.position).toBeDefined();
  });
});
