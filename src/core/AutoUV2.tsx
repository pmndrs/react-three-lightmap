import * as THREE from 'three';

/// <reference path="potpack.d.ts"/>
import potpack, { PotPackItem } from 'potpack';

const tmpOrigin = new THREE.Vector3();
const tmpU = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpW = new THREE.Vector3();

const tmpNormal = new THREE.Vector3();
const tmpUAxis = new THREE.Vector3();
const tmpVAxis = new THREE.Vector3();

const tmpWLocal = new THREE.Vector2();

const tmpMinLocal = new THREE.Vector2();
const tmpMaxLocal = new THREE.Vector2();

// used for auto-indexing
const tmpVert = new THREE.Vector3();
const tmpVert2 = new THREE.Vector3();
const tmpNormal2 = new THREE.Vector3();

function findVertex(
  posArray: ArrayLike<number>,
  normalArray: ArrayLike<number>,
  groupIndexArray: ArrayLike<number>,
  vertexIndex: number
): number {
  tmpVert.fromArray(posArray, vertexIndex * 3);
  tmpNormal.fromArray(normalArray, vertexIndex * 3);
  const gi = groupIndexArray[vertexIndex];

  // finish search before current vertex (since latter is the fallback return)
  for (let vStart = 0; vStart < vertexIndex; vStart += 1) {
    tmpVert2.fromArray(posArray, vStart * 3);
    tmpNormal2.fromArray(normalArray, vStart * 3);
    const gi2 = groupIndexArray[vStart];

    if (
      tmpVert2.equals(tmpVert) &&
      tmpNormal2.equals(tmpNormal) &&
      gi === gi2
    ) {
      return vStart;
    }
  }

  return vertexIndex;
}

function convertGeometryToIndexed(buffer: THREE.BufferGeometry) {
  const posArray = buffer.attributes.position.array;
  const posVertexCount = Math.floor(posArray.length / 3);
  const faceCount = Math.floor(posVertexCount / 3);

  const normalArray = buffer.attributes.normal.array;

  // fill out a group index lookup to keep faces separate by material
  const origGroups = buffer.groups || [];

  const groupIndexArray = new Array(posVertexCount);
  for (const group of origGroups) {
    groupIndexArray.fill(
      group.materialIndex,
      group.start,
      Math.min(posVertexCount, group.start + group.count)
    );
  }

  const indexAttr = new THREE.Uint16BufferAttribute(faceCount * 3, 3);
  indexAttr.count = faceCount * 3; // @todo without this the mesh does not show all faces

  for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
    const vStart = faceIndex * 3;
    const a = findVertex(posArray, normalArray, groupIndexArray, vStart);
    const b = findVertex(posArray, normalArray, groupIndexArray, vStart + 1);
    const c = findVertex(posArray, normalArray, groupIndexArray, vStart + 2);

    indexAttr.setXYZ(faceIndex, a, b, c);
  }

  buffer.setIndex(indexAttr);
}

function guessOrthogonalOrigin(
  indexArray: ArrayLike<number>,
  vStart: number,
  posArray: ArrayLike<number>
): number {
  let minAbsDot = 1;
  let minI = 0;

  for (let i = 0; i < 3; i += 1) {
    // for this ortho origin choice, compute defining edges
    tmpOrigin.fromArray(posArray, indexArray[vStart + i] * 3);
    tmpU.fromArray(posArray, indexArray[vStart + ((i + 2) % 3)] * 3);
    tmpV.fromArray(posArray, indexArray[vStart + ((i + 1) % 3)] * 3);

    tmpU.sub(tmpOrigin);
    tmpV.sub(tmpOrigin);

    // normalize and compute cross (cosine of angle)
    tmpU.normalize();
    tmpV.normalize();

    const absDot = Math.abs(tmpU.dot(tmpV));

    // compare with current minimum
    if (minAbsDot > absDot) {
      minAbsDot = absDot;
      minI = i;
    }
  }

  return minI;
}

const MAX_AUTO_SIZE = 512; // @todo make this configurable? but 512x512 is a lot to compute already

function autoSelectSize(layoutSize: number): number {
  // start with reasonable minimum size and keep trying increasing powers of 2
  for (let size = 4; size <= MAX_AUTO_SIZE; size *= 2) {
    if (layoutSize < size) {
      return size;
    }
  }

  throw new Error(
    `minimum lightmap dimension for auto-UV2 is ${layoutSize} which is too large: please reduce texelsPerUnit and/or polygon count`
  );
}

interface AutoUVBox extends PotPackItem {
  uv2Attr: THREE.Float32BufferAttribute;

  uAxis: THREE.Vector3;
  vAxis: THREE.Vector3;

  posArray: ArrayLike<number>;
  posIndices: number[];
  posLocalX: number[];
  posLocalY: number[];
}

export interface AutoUV2Settings {
  texelsPerUnit: number;
}

export function computeAutoUV2Layout(
  initialWidth: number | undefined,
  initialHeight: number | undefined,
  items: Generator<THREE.Object3D, void, unknown>,
  { texelsPerUnit }: AutoUV2Settings
): [number, number] {
  const layoutBoxes: AutoUVBox[] = [];
  let hasPredefinedUV2 = false;

  for (const mesh of items) {
    if (!(mesh instanceof THREE.Mesh)) {
      continue;
    }

    const buffer = mesh.geometry;

    if (!(buffer instanceof THREE.BufferGeometry)) {
      throw new Error('expecting buffer geometry');
    }

    // automatically convert to indexed
    if (!buffer.index) {
      convertGeometryToIndexed(buffer);
    }

    const indexAttr = buffer.index;
    if (!indexAttr) {
      throw new Error('unexpected missing geometry index attr');
    }

    const indexArray = indexAttr.array;
    const faceCount = Math.floor(indexArray.length / 3);

    const posArray = buffer.attributes.position.array;
    const normalArray = buffer.attributes.normal.array;

    const vertexBoxMap: (AutoUVBox | undefined)[] = new Array(
      posArray.length / 3
    );

    // complain if found predefined UV2 in a scene with computed UV2
    if (buffer.attributes.uv2) {
      if (layoutBoxes.length > 0) {
        throw new Error(
          'found a mesh with "uv2" attribute in a scene with auto-calculated UV2 data: please do not mix-and-match'
        );
      }

      hasPredefinedUV2 = true;
      continue;
    }

    // complain if trying to compute UV2 in a scene with predefined UV2
    if (hasPredefinedUV2) {
      throw new Error(
        'found a mesh with missing "uv2" attribute in a scene with predefined UV2 data: please do not mix-and-match'
      );
    }

    // pre-create uv2 attribute
    const uv2Attr = new THREE.Float32BufferAttribute(
      (2 * posArray.length) / 3,
      2
    );
    buffer.setAttribute('uv2', uv2Attr);

    for (let vStart = 0; vStart < faceCount * 3; vStart += 3) {
      // see if this face shares a vertex with an existing layout box
      let existingBox: AutoUVBox | undefined;

      for (let i = 0; i < 3; i += 1) {
        const possibleBox = vertexBoxMap[indexArray[vStart + i]];

        if (!possibleBox) {
          continue;
        }

        if (existingBox && existingBox !== possibleBox) {
          // absorb layout box into the other
          // (this may happen if same polygon's faces are defined non-consecutively)
          existingBox.posIndices.push(...possibleBox.posIndices);
          existingBox.posLocalX.push(...possibleBox.posLocalX);
          existingBox.posLocalY.push(...possibleBox.posLocalY);

          // re-assign by-vertex lookup
          for (const index of possibleBox.posIndices) {
            vertexBoxMap[index] = existingBox;
          }

          // remove from main list
          const removedBoxIndex = layoutBoxes.indexOf(possibleBox);
          if (removedBoxIndex === -1) {
            throw new Error('unexpected orphaned layout box');
          }
          layoutBoxes.splice(removedBoxIndex, 1);
        } else {
          existingBox = possibleBox;
        }
      }

      // set up new layout box if needed
      if (!existingBox) {
        // @todo guess axis choice based on angle?
        const originFI = guessOrthogonalOrigin(indexArray, vStart, posArray);

        const vOrigin = vStart + originFI;
        const vU = vStart + ((originFI + 2) % 3); // prev in face
        const vV = vStart + ((originFI + 1) % 3); // next in face

        // get the plane-defining edge vectors
        tmpOrigin.fromArray(posArray, indexArray[vOrigin] * 3);
        tmpU.fromArray(posArray, indexArray[vU] * 3);
        tmpV.fromArray(posArray, indexArray[vV] * 3);

        tmpU.sub(tmpOrigin);
        tmpV.sub(tmpOrigin);

        // compute orthogonal coordinate system for face plane
        tmpNormal.fromArray(normalArray, indexArray[vOrigin] * 3);
        tmpUAxis.crossVectors(tmpV, tmpNormal);
        tmpVAxis.crossVectors(tmpNormal, tmpUAxis);
        tmpUAxis.normalize();
        tmpVAxis.normalize();

        existingBox = {
          x: 0, // filled later
          y: 0, // filled later
          w: 0, // filled later
          h: 0, // filled later

          uv2Attr,

          uAxis: tmpUAxis.clone(),
          vAxis: tmpVAxis.clone(),

          posArray,
          posIndices: [],
          posLocalX: [],
          posLocalY: []
        };

        layoutBoxes.push(existingBox);
      }

      // add this face's vertices to the layout box local point set
      // @todo warn if normals deviate too much
      for (let i = 0; i < 3; i += 1) {
        const index = indexArray[vStart + i];

        if (vertexBoxMap[index]) {
          continue;
        }

        vertexBoxMap[index] = existingBox;
        existingBox.posIndices.push(index);
        existingBox.posLocalX.push(0); // filled later
        existingBox.posLocalY.push(0); // filled later
      }
    }
  }

  // fill in local coords and compute dimensions for layout boxes based on polygon point sets inside them
  for (const layoutBox of layoutBoxes) {
    const { uAxis, vAxis, posArray, posIndices, posLocalX, posLocalY } =
      layoutBox;

    // compute min and max extents of all coords
    tmpMinLocal.set(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    tmpMaxLocal.set(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);

    for (let i = 0; i < posIndices.length; i += 1) {
      const index = posIndices[i];

      tmpW.fromArray(posArray, index * 3);
      tmpWLocal.set(tmpW.dot(uAxis), tmpW.dot(vAxis));

      tmpMinLocal.min(tmpWLocal);
      tmpMaxLocal.max(tmpWLocal);

      posLocalX[i] = tmpWLocal.x;
      posLocalY[i] = tmpWLocal.y;
    }

    const realWidth = tmpMaxLocal.x - tmpMinLocal.x;
    const realHeight = tmpMaxLocal.y - tmpMinLocal.y;

    if (realWidth < 0 || realHeight < 0) {
      throw new Error('zero-point polygon?');
    }

    // texel box is aligned to texel grid
    const boxWidthInTexels = Math.ceil(realWidth * texelsPerUnit);
    const boxHeightInTexels = Math.ceil(realHeight * texelsPerUnit);

    // layout box positioning is in texels
    layoutBox.w = boxWidthInTexels + 2; // plus margins
    layoutBox.h = boxHeightInTexels + 2; // plus margins

    // make vertex local coords expressed as 0..1 inside texel box
    for (let i = 0; i < posIndices.length; i += 1) {
      posLocalX[i] = (posLocalX[i] - tmpMinLocal.x) / realWidth;
      posLocalY[i] = (posLocalY[i] - tmpMinLocal.y) / realHeight;
    }
  }

  // bail out if no layout is necessary
  if (layoutBoxes.length === 0) {
    return [initialWidth || 0, initialHeight || 0]; // report preferred size if given
  }

  // main layout magic
  const { w: layoutWidth, h: layoutHeight } = potpack(layoutBoxes);

  // check layout results against width/height if specified
  if (
    (initialWidth && layoutWidth > initialWidth) ||
    (initialHeight && layoutHeight > initialHeight)
  ) {
    throw new Error(
      `minimum lightmap size for auto-UV2 is ${layoutWidth}x${layoutHeight} which is too large to fit provided ${initialWidth}x${initialHeight}: please reduce texelsPerUnit and/or polygon count`
    );
  }

  // auto-select sizing if needed
  const finalWidth = initialWidth || autoSelectSize(layoutWidth);
  const finalHeight = initialHeight || autoSelectSize(layoutHeight);

  // based on layout box positions, fill in UV2 attribute data
  for (const layoutBox of layoutBoxes) {
    const { x, y, w, h, uv2Attr, posIndices, posLocalX, posLocalY } = layoutBox;

    // inner texel box without margins
    const ix = x + 1;
    const iy = y + 1;
    const iw = w - 2;
    const ih = h - 2;

    // convert texel box placement into atlas UV coordinates
    for (let i = 0; i < posIndices.length; i += 1) {
      uv2Attr.setXY(
        posIndices[i],
        (ix + posLocalX[i] * iw) / finalWidth,
        (iy + posLocalY[i] * ih) / finalHeight
      );
    }
  }

  // report final dimensions
  return [finalWidth, finalHeight];
}
