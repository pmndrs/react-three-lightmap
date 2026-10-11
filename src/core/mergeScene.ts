import * as THREE from 'three';
import { mergeBufferGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils';

import { traverseSceneItems } from './workbench';

// one material group's worth of world-space geometry, already indexed and de-duplicated:
// genuinely indexed sources like GLTF imports keep their exporter-provided vertex sharing,
// while genuinely non-indexed sources like CSG output get identical vertices welded, so
// that adjacent faces form shared UV2 layout islands
export interface MeshMaterialPart {
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

type VertexAttribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

function getVertexKey(attributes: VertexAttribute[], index: number) {
  const values: number[] = [];
  for (const attribute of attributes) {
    values.push(attribute.getX(index));
    if (attribute.itemSize > 1) values.push(attribute.getY(index));
    if (attribute.itemSize > 2) values.push(attribute.getZ(index));
  }
  return values.join(',');
}

// splits one mesh's geometry into one indexed, world-space piece per material group
// (defaulting to a single group covering the whole mesh if it has none), so that later
// merging can concatenate pieces via BufferGeometryUtils without losing per-source materials
export function splitMeshIntoPieces(mesh: THREE.Mesh): MeshMaterialPart[] {
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
  const weldAttributes = [posAttr, normalAttr, uvAttr, uv2Attr].filter(
    (attribute) => attribute
  ) as VertexAttribute[];
  const vertexCount = indexAttr ? indexAttr.count : posAttr.count;

  const groups =
    geometry.groups && geometry.groups.length > 0
      ? geometry.groups
      : [{ start: 0, count: vertexCount, materialIndex: 0 }];

  const materials = Array.isArray(mesh.material)
    ? mesh.material
    : [mesh.material];

  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);

  const pieces: MeshMaterialPart[] = [];

  for (const group of groups) {
    const count = Math.min(group.count, vertexCount - group.start);
    if (count <= 0) {
      continue;
    }

    // indexed sources dedupe by source vertex index (keeping the exporter's own sharing),
    // non-indexed sources dedupe by exact attribute values (welding coincident vertices)
    const localIndexBySrc = new Map<number | string, number>();
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const uv2s: number[] = [];
    const indices = new Uint32Array(count);

    for (let i = 0; i < count; i += 1) {
      const srcIndex = indexAttr
        ? indexAttr.getX(group.start + i)
        : group.start + i;

      const srcKey = indexAttr
        ? srcIndex
        : getVertexKey(weldAttributes, srcIndex);

      let localIndex = localIndexBySrc.get(srcKey);
      if (localIndex === undefined) {
        localIndex = positions.length / 3;
        localIndexBySrc.set(srcKey, localIndex);

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
export function collectMergePieces(root: THREE.Object3D): MeshMaterialPart[] {
  root.updateMatrixWorld(true);

  const pieces: MeshMaterialPart[] = [];
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
// stay addressable by group/material index.
//
// uv2 (lightmap UV) is only carried through when *every* piece brought its own
// pre-existing uv2 - matching AutoUV2.tsx's own all-or-nothing "hasPredefinedUV2"
// semantics, just decided across pieces instead of across scene objects. If any piece
// is missing uv2, the merged mesh gets none at all and falls back to full auto-layout
// regeneration for everyone, same as mixing bare and pre-UV2'd meshes always has.
// (mergeBufferGeometries() itself requires every input to expose the same attribute
// set, which is exactly why the inconsistent case has to be resolved before calling it.)
export function mergePieces(
  pieces: MeshMaterialPart[]
): MergedSceneResult | null {
  if (pieces.length === 0) {
    return null;
  }

  const allHaveUV2 = pieces.every((piece) =>
    piece.geometry.hasAttribute('uv2')
  );
  if (!allHaveUV2) {
    pieces.forEach((piece) => piece.geometry.deleteAttribute('uv2'));
  }

  const geometry = mergeBufferGeometries(
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
