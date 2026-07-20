import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  collectMergePieces,
  mergePieces,
  splitMeshIntoPieces
} from './mergeScene';
import { LIGHTMAP_IGNORE_FLAG, LIGHTMAP_READONLY_FLAG } from './workbench';

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
  geometry.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2)
  );
  return geometry;
}

function positionsOf(geometry: THREE.BufferGeometry) {
  return Array.from(geometry.attributes.position.array);
}

function indicesOf(geometry: THREE.BufferGeometry) {
  return Array.from(geometry.index!.array);
}

describe('splitMeshIntoPieces', () => {
  it('produces a single piece for a mesh with no groups', () => {
    const mesh = new THREE.Mesh(
      makeTriangleGeometry(),
      new THREE.MeshStandardMaterial()
    );
    mesh.updateMatrixWorld(true);

    const pieces = splitMeshIntoPieces(mesh);

    expect(pieces).toHaveLength(1);
    expect(pieces[0].geometry.attributes.position.count).toBe(3);
    expect(pieces[0].material).toBe(mesh.material);
    expect(pieces[0].sourceMesh).toBe(mesh);
  });

  it('bakes the mesh world transform into the output positions', () => {
    const mesh = new THREE.Mesh(
      makeTriangleGeometry(),
      new THREE.MeshStandardMaterial()
    );
    mesh.position.set(10, 0, 0);
    mesh.updateMatrixWorld(true);

    const [piece] = splitMeshIntoPieces(mesh);

    // first vertex was (0,0,0) locally, should be (10,0,0) in world space
    expect(positionsOf(piece.geometry).slice(0, 3)).toEqual([10, 0, 0]);
  });

  it('bakes world transform through a nested, rotated/translated parent group', () => {
    const parent = new THREE.Group();
    parent.position.set(5, 0, 0);
    parent.rotation.set(0, Math.PI / 2, 0);

    const mesh = new THREE.Mesh(
      makeTriangleGeometry(),
      new THREE.MeshStandardMaterial()
    );
    parent.add(mesh);
    parent.updateMatrixWorld(true);

    const [piece] = splitMeshIntoPieces(mesh);

    // second vertex (1,0,0) rotated 90deg around Y and translated by (5,0,0)
    const expected = new THREE.Vector3(1, 0, 0)
      .applyMatrix4(mesh.matrixWorld)
      .toArray();
    const actual = positionsOf(piece.geometry).slice(3, 6);
    actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 5));
  });

  it('splits a mesh with multiple pre-existing groups into one piece per group', () => {
    const geometry = new THREE.BufferGeometry();
    // two triangles (6 verts), indexed, so groups refer to index-array ranges
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0],
        3
      )
    );
    geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(new Array(18).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3)
    );
    geometry.setIndex([0, 1, 2, 3, 4, 5]);
    geometry.addGroup(0, 3, 0);
    geometry.addGroup(3, 3, 1);

    const materialA = new THREE.MeshStandardMaterial({ color: 'red' });
    const materialB = new THREE.MeshStandardMaterial({ color: 'blue' });
    const mesh = new THREE.Mesh(geometry, [materialA, materialB]);
    mesh.updateMatrixWorld(true);

    const pieces = splitMeshIntoPieces(mesh);

    expect(pieces).toHaveLength(2);
    expect(pieces[0].material).toBe(materialA);
    expect(pieces[1].material).toBe(materialB);
    expect(pieces[0].geometry.attributes.position.count).toBe(3);
    expect(pieces[1].geometry.attributes.position.count).toBe(3);
    // second group's first vertex should be source vertex index 3: (2,0,0)
    expect(positionsOf(pieces[1].geometry).slice(0, 3)).toEqual([2, 0, 0]);
  });

  it('fills in zero uvs when the source mesh has no uv attribute', () => {
    const geometry = makeTriangleGeometry();
    geometry.deleteAttribute('uv');
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    mesh.updateMatrixWorld(true);

    const [piece] = splitMeshIntoPieces(mesh);
    expect(Array.from(piece.geometry.attributes.uv.array)).toEqual([
      0, 0, 0, 0, 0, 0
    ]);
  });

  it('has no uv2 attribute when the source mesh has no uv2 attribute', () => {
    const mesh = new THREE.Mesh(
      makeTriangleGeometry(),
      new THREE.MeshStandardMaterial()
    );
    mesh.updateMatrixWorld(true);

    const [piece] = splitMeshIntoPieces(mesh);
    expect(piece.geometry.hasAttribute('uv2')).toBe(false);
  });

  it('preserves a source mesh\'s pre-existing uv2 (e.g. artist-authored lightmap UVs)', () => {
    const geometry = makeTriangleGeometry();
    const uv2Data = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
    geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(uv2Data, 2));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    mesh.updateMatrixWorld(true);

    const [piece] = splitMeshIntoPieces(mesh);

    expect(piece.geometry.hasAttribute('uv2')).toBe(true);
    // compare against the Float32Array round-tripped source data, since the source
    // attribute itself is already float32-precision - not an approximation here
    expect(Array.from(piece.geometry.attributes.uv2.array)).toEqual(
      Array.from(new Float32Array(uv2Data))
    );
  });

  it('preserves the source geometry\'s own vertex sharing (e.g. an indexed quad)', () => {
    // quad made of two triangles sharing 2 of their 4 vertices, exactly the kind of
    // indexing a GLTF exporter would produce - this is the regression case for the
    // "always fully unroll then re-weld" approach, which lost this sharing
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
        3
      )
    );
    geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(
        [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
        3
      )
    );
    geometry.setIndex([0, 1, 2, 0, 2, 3]);

    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    mesh.updateMatrixWorld(true);

    const [piece] = splitMeshIntoPieces(mesh);

    // 6 index entries but only 4 unique source vertices - sharing must be preserved
    expect(indicesOf(piece.geometry)).toHaveLength(6);
    expect(piece.geometry.attributes.position.count).toBe(4);
    expect(indicesOf(piece.geometry)).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it('does not share vertices across a non-indexed source (nothing to preserve)', () => {
    // two triangles, non-indexed, no natural sharing in the source
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0],
        3
      )
    );
    geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(new Array(18).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3)
    );

    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    mesh.updateMatrixWorld(true);

    const [piece] = splitMeshIntoPieces(mesh);

    // no index on the source, so every vertex stays its own entry despite duplicate positions
    expect(piece.geometry.attributes.position.count).toBe(6);
    expect(indicesOf(piece.geometry)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('collectMergePieces', () => {
  it('collects pieces from contributing meshes and skips read-only/ignored subtrees', () => {
    const root = new THREE.Group();

    const contributing = new THREE.Mesh(
      makeTriangleGeometry(),
      new THREE.MeshStandardMaterial()
    );
    root.add(contributing);

    const readOnlyGroup = new THREE.Group();
    readOnlyGroup.userData = { [LIGHTMAP_READONLY_FLAG]: true };
    readOnlyGroup.add(
      new THREE.Mesh(makeTriangleGeometry(), new THREE.MeshStandardMaterial())
    );
    root.add(readOnlyGroup);

    const ignoredGroup = new THREE.Group();
    ignoredGroup.userData = { [LIGHTMAP_IGNORE_FLAG]: true };
    ignoredGroup.add(
      new THREE.Mesh(makeTriangleGeometry(), new THREE.MeshStandardMaterial())
    );
    root.add(ignoredGroup);

    const pieces = collectMergePieces(root);

    expect(pieces).toHaveLength(1);
    expect(pieces[0].sourceMesh).toBe(contributing);
  });
});

describe('mergePieces', () => {
  it('returns null when there is nothing to merge', () => {
    expect(mergePieces([])).toBeNull();
  });

  it('concatenates pieces into one indexed geometry with one group per piece', () => {
    const meshA = new THREE.Mesh(
      makeTriangleGeometry(),
      new THREE.MeshStandardMaterial({ color: 'red' })
    );
    meshA.updateMatrixWorld(true);
    const meshB = new THREE.Mesh(
      makeTriangleGeometry(),
      new THREE.MeshStandardMaterial({ color: 'blue' })
    );
    meshB.position.set(5, 0, 0);
    meshB.updateMatrixWorld(true);

    const pieces = [
      ...splitMeshIntoPieces(meshA),
      ...splitMeshIntoPieces(meshB)
    ];

    const result = mergePieces(pieces);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.geometry.index).not.toBeNull();
    expect(result.geometry.index?.count).toBe(6);
    expect(result.geometry.attributes.position.count).toBe(6);
    expect(result.materials).toEqual([meshA.material, meshB.material]);
    expect(result.sourceMeshes).toEqual([meshA, meshB]);

    // group ranges are index-buffer ranges (three.js convention for indexed geometry)
    expect(result.geometry.groups).toEqual([
      { start: 0, count: 3, materialIndex: 0 },
      { start: 3, count: 3, materialIndex: 1 }
    ]);
    expect(indicesOf(result.geometry)).toEqual([0, 1, 2, 3, 4, 5]);

    // second piece's first vertex should reflect meshB's world-space translation
    expect(positionsOf(result.geometry).slice(9, 12)).toEqual([5, 0, 0]);
  });

  it('preserves per-piece vertex sharing through the merge (offsetting indices correctly)', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3)
    );
    geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3)
    );
    geometry.setIndex([0, 1, 2, 0, 2, 3]);

    const meshA = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    meshA.updateMatrixWorld(true);
    const meshB = new THREE.Mesh(
      makeTriangleGeometry(),
      new THREE.MeshStandardMaterial()
    );
    meshB.updateMatrixWorld(true);

    const result = mergePieces([
      ...splitMeshIntoPieces(meshA),
      ...splitMeshIntoPieces(meshB)
    ]);
    expect(result).not.toBeNull();
    if (!result) return;

    // meshA: 4 unique verts (0-3), meshB: 3 unique verts offset by 4 (4-6)
    expect(result.geometry.attributes.position.count).toBe(7);
    expect(indicesOf(result.geometry)).toEqual([0, 1, 2, 0, 2, 3, 4, 5, 6]);
  });

  it('preserves uv2 through the merge, exactly matching the source, when every piece has it', () => {
    const geometryA = makeTriangleGeometry();
    const uv2DataA = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
    geometryA.setAttribute('uv2', new THREE.Float32BufferAttribute(uv2DataA, 2));
    const meshA = new THREE.Mesh(geometryA, new THREE.MeshStandardMaterial());
    meshA.updateMatrixWorld(true);

    const geometryB = makeTriangleGeometry();
    const uv2DataB = [0.7, 0.8, 0.9, 0.15, 0.25, 0.35];
    geometryB.setAttribute('uv2', new THREE.Float32BufferAttribute(uv2DataB, 2));
    const meshB = new THREE.Mesh(geometryB, new THREE.MeshStandardMaterial());
    meshB.updateMatrixWorld(true);

    const result = mergePieces([
      ...splitMeshIntoPieces(meshA),
      ...splitMeshIntoPieces(meshB)
    ]);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.geometry.attributes.uv2).toBeDefined();
    expect(Array.from(result.geometry.attributes.uv2.array)).toEqual(
      Array.from(new Float32Array([...uv2DataA, ...uv2DataB]))
    );
  });

  it('preserves uv2 through per-piece vertex de-duplication, matching the source at each shared vertex', () => {
    // indexed quad (2 triangles sharing 2 verts) with its own uv2 - de-dup must
    // carry the *same* uv2 value along with the position/normal for a shared vertex
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3)
    );
    geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3)
    );
    const uv2Data = [0.1, 0.1, 0.2, 0.1, 0.2, 0.2, 0.1, 0.2];
    geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(uv2Data, 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);

    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    mesh.updateMatrixWorld(true);

    const result = mergePieces(splitMeshIntoPieces(mesh));
    expect(result).not.toBeNull();
    if (!result) return;

    // 4 unique source vertices, each keeping its own original uv2 value
    expect(Array.from(result.geometry.attributes.uv2.array)).toEqual(
      Array.from(new Float32Array(uv2Data))
    );
  });

  it('falls back to no uv2 attribute when only some pieces have pre-existing uv2 (mixed sources)', () => {
    const geometryA = makeTriangleGeometry();
    geometryA.setAttribute(
      'uv2',
      new THREE.Float32BufferAttribute([0.1, 0.2, 0.3, 0.4, 0.5, 0.6], 2)
    );
    const meshA = new THREE.Mesh(geometryA, new THREE.MeshStandardMaterial());
    meshA.updateMatrixWorld(true);

    const meshB = new THREE.Mesh(
      makeTriangleGeometry(),
      new THREE.MeshStandardMaterial()
    );
    meshB.updateMatrixWorld(true);

    const result = mergePieces([
      ...splitMeshIntoPieces(meshA),
      ...splitMeshIntoPieces(meshB)
    ]);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.geometry.attributes.uv2).toBeUndefined();
  });

  it('deduplicates a source mesh that contributed multiple groups', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0],
        3
      )
    );
    geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(new Array(18).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3)
    );
    geometry.setIndex([0, 1, 2, 3, 4, 5]);
    geometry.addGroup(0, 3, 0);
    geometry.addGroup(3, 3, 1);

    const mesh = new THREE.Mesh(geometry, [
      new THREE.MeshStandardMaterial({ color: 'red' }),
      new THREE.MeshStandardMaterial({ color: 'blue' })
    ]);
    mesh.updateMatrixWorld(true);

    const result = mergePieces(splitMeshIntoPieces(mesh));
    expect(result).not.toBeNull();
    expect(result?.sourceMeshes).toEqual([mesh]);
    expect(result?.materials).toHaveLength(2);
  });
});
