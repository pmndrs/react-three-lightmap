import * as THREE from 'three';
import { BufferGeometryUtils } from 'three/examples/jsm/utils/BufferGeometryUtils';

import { traverseSceneItems } from './workbench';

// one material group's worth of world-space geometry, already indexed and de-duplicated
// exactly as the source was: genuinely indexed sources like GLTF imports keep their
// exporter-provided vertex sharing, while genuinely non-indexed sources like CSG output
// end up with every vertex unique
export interface MergePiece {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  sourceMesh: THREE.Mesh;
}

export interface MergedSceneResult {
  geometry: THREE.BufferGeometry;
  materials: THREE.Material[];
  sourceMeshes: THREE.Mesh[];
}

const tmpVec3 = new THREE.Vector3();

// splits one mesh's geometry into one indexed, world-space piece per material group
// (defaulting to a single group covering the whole mesh if it has none), so that later
// merging can concatenate pieces via BufferGeometryUtils without losing per-source materials
export function splitMeshIntoPieces(mesh: THREE.Mesh): MergePiece[] {
  const geometry = mesh.geometry;
  if (!(geometry instanceof THREE.BufferGeometry)) {
    throw new Error('expected buffer geometry');
  }

  const posAttr = geometry.attributes.position;
  const normalAttr = geometry.attributes.normal;
  const uvAttr = geometry.attributes.uv;
  const uv2Attr = geometry.attributes.uv2;

  if (!posAttr || !normalAttr) {
    throw new Error(
      'expected mesh geometry to have position and normal attributes'
    );
  }

  const indexAttr = geometry.index;
  const vertexCount = indexAttr ? indexAttr.count : posAttr.count;

  const groups =
    geometry.groups && geometry.groups.length > 0
      ? geometry.groups
      : [{ start: 0, count: vertexCount, materialIndex: 0 }];

  const materials = Array.isArray(mesh.material)
    ? mesh.material
    : [mesh.material];

  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);

  const pieces: MergePiece[] = [];

  for (const group of groups) {
    const count = Math.min(group.count, vertexCount - group.start);
    if (count <= 0) {
      continue;
    }

    // dedupe by *source* vertex index within this piece, so any sharing the source
    // geometry already had (e.g. a GLTF exporter's own indexing) is preserved rather
    // than lost - for a non-indexed source, srcIndex is unique per iteration anyway,
    // so this naturally degrades to "every vertex is its own entry"
    const localIndexBySrc = new Map<number, number>();
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const uv2s: number[] = [];
    const indices = new Uint32Array(count);

    for (let i = 0; i < count; i += 1) {
      const srcIndex = indexAttr
        ? indexAttr.getX(group.start + i)
        : group.start + i;

      let localIndex = localIndexBySrc.get(srcIndex);
      if (localIndex === undefined) {
        localIndex = positions.length / 3;
        localIndexBySrc.set(srcIndex, localIndex);

        tmpVec3.fromBufferAttribute(posAttr, srcIndex);
        tmpVec3.applyMatrix4(mesh.matrixWorld);
        positions.push(tmpVec3.x, tmpVec3.y, tmpVec3.z);

        tmpVec3.fromBufferAttribute(normalAttr, srcIndex);
        tmpVec3.applyMatrix3(normalMatrix).normalize();
        normals.push(tmpVec3.x, tmpVec3.y, tmpVec3.z);

        if (uvAttr) {
          uvs.push(uvAttr.getX(srcIndex), uvAttr.getY(srcIndex));
        } else {
          uvs.push(0, 0);
        }

        if (uv2Attr) {
          uv2s.push(uv2Attr.getX(srcIndex), uv2Attr.getY(srcIndex));
        }
      }

      indices[i] = localIndex;
    }

    const material = materials[group.materialIndex ?? 0] || materials[0];
    if (!material) {
      throw new Error('mesh is missing a material for one of its groups');
    }

    const pieceGeometry = new THREE.BufferGeometry();
    pieceGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3)
    );
    pieceGeometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(normals, 3)
    );
    pieceGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    if (uv2Attr) {
      pieceGeometry.setAttribute(
        'uv2',
        new THREE.Float32BufferAttribute(uv2s, 2)
      );
    }
    pieceGeometry.setIndex(new THREE.Uint32BufferAttribute(indices, 1));

    pieces.push({ geometry: pieceGeometry, material, sourceMesh: mesh });
  }

  return pieces;
}

// walks the live mount (same ignoreReadOnly=true traversal already used for UV2/atlas
// computation) and splits every contributing mesh into merge pieces
export function collectMergePieces(root: THREE.Object3D): MergePiece[] {
  root.updateMatrixWorld(true);

  const pieces: MergePiece[] = [];
  for (const object of traverseSceneItems(root, true)) {
    if (!(object instanceof THREE.Mesh)) {
      continue;
    }
    pieces.push(...splitMeshIntoPieces(object));
  }

  return pieces;
}

// concatenates pieces into one indexed BufferGeometry via three.js's own geometry-merge
// utility, with one .groups entry per piece (useGroups=true) - so per-source materials
// stay addressable by group/material index exactly the way three.js multi-material
// meshes already work.
//
// uv2 (lightmap UV) is only carried through when *every* piece brought its own
// pre-existing uv2 - matching AutoUV2.tsx's own all-or-nothing "hasPredefinedUV2"
// semantics, just decided across pieces instead of across scene objects. If any piece
// is missing uv2, the merged mesh gets none at all and falls back to full auto-layout
// regeneration for everyone, same as mixing bare and pre-UV2'd meshes always has.
// (mergeBufferGeometries() itself requires every input to expose the same attribute
// set, which is exactly why the inconsistent case has to be resolved before calling it.)
export function mergePieces(pieces: MergePiece[]): MergedSceneResult | null {
  if (pieces.length === 0) {
    return null;
  }

  const preserveUv2 = pieces.every((piece) => piece.geometry.hasAttribute('uv2'));
  if (!preserveUv2) {
    pieces.forEach((piece) => piece.geometry.deleteAttribute('uv2'));
  }

  const geometry = BufferGeometryUtils.mergeBufferGeometries(
    pieces.map((piece) => piece.geometry),
    true
  );
  if (!geometry) {
    throw new Error('failed to merge scene geometry');
  }

  const materials = pieces.map((piece) => piece.material);

  const sourceMeshes: THREE.Mesh[] = [];
  for (const piece of pieces) {
    if (!sourceMeshes.includes(piece.sourceMesh)) {
      sourceMeshes.push(piece.sourceMesh);
    }
  }

  return { geometry, materials, sourceMeshes };
}
