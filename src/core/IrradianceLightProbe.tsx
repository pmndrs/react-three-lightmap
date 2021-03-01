import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

import { AtlasMapItem } from './IrradianceAtlasMapper';

const tmpOrigin = new THREE.Vector3();
const tmpU = new THREE.Vector3();
const tmpV = new THREE.Vector3();

const tmpNormal = new THREE.Vector3();
const tmpLookAt = new THREE.Vector3();

const tmpProbeBox = new THREE.Vector4();
const tmpPrevClearColor = new THREE.Color();

const PROBE_BG_COLOR = new THREE.Color('#000000');

export const PROBE_BATCH_COUNT = 8;

export type ProbeDataHandler = (
  rgbaData: Float32Array,
  rowPixelStride: number,
  probeBox: THREE.Vector4,
  originX: number, // device coordinates of lower-left corner of the viewbox
  originY: number
) => void;

export type ProbeBatchRenderer = (
  texelIndex: number,
  atlasMapItem: AtlasMapItem,
  faceIndex: number,
  pU: number,
  pV: number
) => void;

export type ProbeBatchReader = (handleProbeData: ProbeDataHandler) => void;

export type ProbeBatcher = (
  gl: THREE.WebGLRenderer,
  lightScene: THREE.Scene,
  batchItemCallback: (renderer: ProbeBatchRenderer) => void,
  batchResultCallback: (batchIndex: number, reader: ProbeBatchReader) => void
) => void;

function setUpProbeUp(
  probeCam: THREE.Camera,
  mesh: THREE.Mesh,
  origin: THREE.Vector3,
  normal: THREE.Vector3,
  uDir: THREE.Vector3
) {
  probeCam.position.copy(origin);

  probeCam.up.copy(uDir);

  // add normal to accumulator and look at it
  tmpLookAt.copy(normal);
  tmpLookAt.add(origin);

  probeCam.lookAt(tmpLookAt);
  probeCam.scale.set(1, 1, 1);

  // then, transform camera into world space
  probeCam.applyMatrix4(mesh.matrixWorld);
}

function setUpProbeSide(
  probeCam: THREE.Camera,
  mesh: THREE.Mesh,
  origin: THREE.Vector3,
  normal: THREE.Vector3,
  direction: THREE.Vector3,
  directionSign: number
) {
  probeCam.position.copy(origin);

  // up is the normal
  probeCam.up.copy(normal);

  // add normal to accumulator and look at it
  tmpLookAt.copy(origin);
  tmpLookAt.addScaledVector(direction, directionSign);

  probeCam.lookAt(tmpLookAt);
  probeCam.scale.set(1, 1, 1);

  // then, transform camera into world space
  probeCam.applyMatrix4(mesh.matrixWorld);
}

export function useLightProbe(
  probeTargetSize: number
): {
  renderLightProbeBatch: ProbeBatcher;
  probePixelAreaLookup: number[];
  debugLightProbeTexture: THREE.Texture;
} {
  const probePixelCount = probeTargetSize * probeTargetSize;
  const halfSize = probeTargetSize / 2;

  const targetWidth = probeTargetSize * 4; // 4 tiles across
  const targetHeight = probeTargetSize * 2 * PROBE_BATCH_COUNT; // 2 tiles x batch count

  const probeTarget = useMemo(() => {
    // set up simple rasterization for pure data consumption
    return new THREE.WebGLRenderTarget(targetWidth, targetHeight, {
      type: THREE.FloatType,
      magFilter: THREE.NearestFilter,
      minFilter: THREE.NearestFilter,
      generateMipmaps: false
    });
  }, [targetWidth, targetHeight]);

  // for each pixel in the individual probe viewport, compute contribution to final tally
  // (edges are weaker because each pixel covers less of a view angle)
  const probePixelAreaLookup = useMemo(() => {
    const lookup = new Array(probePixelCount);

    const probePixelBias = 0.5 / probeTargetSize;

    for (let py = 0; py < probeTargetSize; py += 1) {
      // compute offset from center (with a bias for target pixel size)
      const dy = py / probeTargetSize - 0.5 + probePixelBias;

      for (let px = 0; px < probeTargetSize; px += 1) {
        // compute offset from center (with a bias for target pixel size)
        const dx = px / probeTargetSize - 0.5 + probePixelBias;

        // compute multiplier as affected by inclination of corresponding ray
        const span = Math.hypot(dx * 2, dy * 2);
        const hypo = Math.hypot(span, 1);
        const area = 1 / hypo;

        lookup[py * probeTargetSize + px] = area;
      }
    }

    return lookup;
  }, [probePixelCount, probeTargetSize]);

  useEffect(
    () => () => {
      // clean up on unmount
      probeTarget.dispose();
    },
    [probeTarget]
  );

  const probeCam = useMemo(() => {
    const rtFov = 90; // view cone must be quarter of the hemisphere
    const rtAspect = 1; // square render target
    const rtNear = 0.05;
    const rtFar = 50;
    return new THREE.PerspectiveCamera(rtFov, rtAspect, rtNear, rtFar);
  }, []);

  const probeData = useMemo(() => {
    return new Float32Array(targetWidth * targetHeight * 4);
  }, [targetWidth, targetHeight]);

  const batchTexels = new Array(PROBE_BATCH_COUNT) as (number | undefined)[];

  // @todo ensure there is biasing to be in middle of texel physical square
  const renderLightProbeBatch: ProbeBatcher = function renderLightProbeBatch(
    gl,
    lightScene,
    batchItemCallback,
    batchResultCallback
  ) {
    // save existing renderer state
    gl.getClearColor(tmpPrevClearColor);
    const prevClearAlpha = gl.getClearAlpha();
    const prevAutoClear = gl.autoClear;
    const prevToneMapping = gl.toneMapping;

    // reset tone mapping output to linear because we are aggregating unprocessed luminance output
    gl.toneMapping = THREE.LinearToneMapping;

    // set up render target for overall clearing
    // (bypassing setViewport means that the renderer conveniently preserves previous state)
    probeTarget.scissorTest = true;
    probeTarget.scissor.set(0, 0, targetWidth, targetHeight);
    probeTarget.viewport.set(0, 0, targetWidth, targetHeight);
    gl.setRenderTarget(probeTarget);
    gl.autoClear = false;

    // clear entire area
    gl.setClearColor(PROBE_BG_COLOR, 1);
    gl.clear(true, true, false);

    for (let batchItem = 0; batchItem < PROBE_BATCH_COUNT; batchItem += 1) {
      batchTexels[batchItem] = undefined;

      batchItemCallback((texelIndex, atlasMapItem, faceIndex, pU, pV) => {
        // each batch is 2 tiles high
        const batchOffsetY = batchItem * probeTargetSize * 2;

        // save which texel is being rendered for later reporting
        batchTexels[batchItem] = texelIndex;

        const { originalMesh, originalBuffer } = atlasMapItem;

        if (!originalBuffer.index) {
          throw new Error('expected indexed mesh');
        }

        // read vertex position for this face and interpolate along U and V axes
        const origIndexArray = originalBuffer.index.array;
        const origPosArray = originalBuffer.attributes.position.array;
        const origNormalArray = originalBuffer.attributes.normal.array;

        // get face vertex positions
        const faceVertexBase = faceIndex * 3;
        tmpOrigin.fromArray(origPosArray, origIndexArray[faceVertexBase] * 3);
        tmpU.fromArray(origPosArray, origIndexArray[faceVertexBase + 1] * 3);
        tmpV.fromArray(origPosArray, origIndexArray[faceVertexBase + 2] * 3);

        // compute face dimensions
        tmpU.sub(tmpOrigin);
        tmpV.sub(tmpOrigin);

        // set camera to match texel, first in mesh-local space
        tmpOrigin.addScaledVector(tmpU, pU);
        tmpOrigin.addScaledVector(tmpV, pV);

        // compute "real" normal direction from geometry
        // (mesh normals can deviate to simulate curvature, so using that might clip light probe frustum through surface)
        tmpNormal.fromArray(origPosArray, origIndexArray[faceVertexBase] * 3);

        tmpU.fromArray(origPosArray, origIndexArray[faceVertexBase + 1] * 3);
        tmpU.sub(tmpNormal);

        tmpV.fromArray(origPosArray, origIndexArray[faceVertexBase + 2] * 3);
        tmpV.sub(tmpNormal);

        tmpNormal.crossVectors(tmpU, tmpV);

        // check against mesh normal data if we should flip direction due to winding order
        tmpU.fromArray(origNormalArray, origIndexArray[faceVertexBase] * 3);
        if (tmpU.dot(tmpNormal) < 0) {
          tmpNormal.negate();
        }

        // compute cardinal directions
        // use consistent "left" and "up" directions based on just the normal
        if (tmpNormal.x === 0 && tmpNormal.y === 0) {
          tmpU.set(1, 0, 0);
        } else {
          tmpU.set(0, 0, 1);
        }

        tmpV.crossVectors(tmpNormal, tmpU);
        tmpV.normalize();

        tmpU.crossVectors(tmpNormal, tmpV);
        tmpU.normalize();

        // proceed with the renders
        setUpProbeUp(probeCam, originalMesh, tmpOrigin, tmpNormal, tmpU);
        probeTarget.viewport.set(
          0,
          batchOffsetY + probeTargetSize,
          probeTargetSize,
          probeTargetSize
        );
        probeTarget.scissor.set(
          0,
          batchOffsetY + probeTargetSize,
          probeTargetSize,
          probeTargetSize
        );
        gl.setRenderTarget(probeTarget); // propagate latest target params
        gl.render(lightScene, probeCam);

        // sides only need the upper half of rendered view, so we set scissor accordingly
        setUpProbeSide(probeCam, originalMesh, tmpOrigin, tmpNormal, tmpU, 1);
        probeTarget.viewport.set(
          0,
          batchOffsetY,
          probeTargetSize,
          probeTargetSize
        );
        probeTarget.scissor.set(
          0,
          batchOffsetY + halfSize,
          probeTargetSize,
          halfSize
        );
        gl.setRenderTarget(probeTarget); // propagate latest target params
        gl.render(lightScene, probeCam);

        setUpProbeSide(probeCam, originalMesh, tmpOrigin, tmpNormal, tmpU, -1);
        probeTarget.viewport.set(
          probeTargetSize,
          batchOffsetY,
          probeTargetSize,
          probeTargetSize
        );
        probeTarget.scissor.set(
          probeTargetSize,
          batchOffsetY + halfSize,
          probeTargetSize,
          halfSize
        );
        gl.setRenderTarget(probeTarget); // propagate latest target params
        gl.render(lightScene, probeCam);

        setUpProbeSide(probeCam, originalMesh, tmpOrigin, tmpNormal, tmpV, 1);
        probeTarget.viewport.set(
          probeTargetSize * 2,
          batchOffsetY,
          probeTargetSize,
          probeTargetSize
        );
        probeTarget.scissor.set(
          probeTargetSize * 2,
          batchOffsetY + halfSize,
          probeTargetSize,
          halfSize
        );
        gl.setRenderTarget(probeTarget); // propagate latest target params
        gl.render(lightScene, probeCam);

        setUpProbeSide(probeCam, originalMesh, tmpOrigin, tmpNormal, tmpV, -1);
        probeTarget.viewport.set(
          probeTargetSize * 3,
          batchOffsetY,
          probeTargetSize,
          probeTargetSize
        );
        probeTarget.scissor.set(
          probeTargetSize * 3,
          batchOffsetY + halfSize,
          probeTargetSize,
          halfSize
        );
        gl.setRenderTarget(probeTarget); // propagate latest target params
        gl.render(lightScene, probeCam);
      });

      // if nothing was rendered there is no need to finish the batch
      if (batchTexels[batchItem] === undefined) {
        break;
      }
    }

    // fetch rendered data in one go (this is very slow)
    gl.readRenderTargetPixels(
      probeTarget,
      0,
      0,
      targetWidth,
      targetHeight,
      probeData
    );

    // restore renderer state
    gl.setRenderTarget(null); // this restores original scissor/viewport
    gl.setClearColor(tmpPrevClearColor, prevClearAlpha);
    gl.autoClear = prevAutoClear;
    gl.toneMapping = prevToneMapping;

    // if something was rendered, send off the data for consumption
    for (let batchItem = 0; batchItem < PROBE_BATCH_COUNT; batchItem += 1) {
      const renderedTexelIndex = batchTexels[batchItem];

      // see if the batch ended early
      if (renderedTexelIndex === undefined) {
        break;
      }

      batchResultCallback(renderedTexelIndex, (handleProbeData) => {
        // each batch is 2 tiles high
        const batchOffsetY = batchItem * probeTargetSize * 2;
        const rowPixelStride = probeTargetSize * 4;

        tmpProbeBox.set(
          0,
          batchOffsetY + probeTargetSize,
          probeTargetSize,
          probeTargetSize
        );
        handleProbeData(probeData, rowPixelStride, tmpProbeBox, 0, 0);

        tmpProbeBox.set(0, batchOffsetY + halfSize, probeTargetSize, halfSize);
        handleProbeData(probeData, rowPixelStride, tmpProbeBox, 0, halfSize);

        tmpProbeBox.set(
          probeTargetSize,
          batchOffsetY + halfSize,
          probeTargetSize,
          halfSize
        );
        handleProbeData(probeData, rowPixelStride, tmpProbeBox, 0, halfSize);

        tmpProbeBox.set(
          probeTargetSize * 2,
          batchOffsetY + halfSize,
          probeTargetSize,
          halfSize
        );
        handleProbeData(probeData, rowPixelStride, tmpProbeBox, 0, halfSize);

        tmpProbeBox.set(
          probeTargetSize * 3,
          batchOffsetY + halfSize,
          probeTargetSize,
          halfSize
        );
        handleProbeData(probeData, rowPixelStride, tmpProbeBox, 0, halfSize);
      });
    }
  };

  return {
    renderLightProbeBatch,
    probePixelAreaLookup,
    debugLightProbeTexture: probeTarget.texture
  };
}
