import React, { useEffect, useState, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { useWorkRequest } from './WorkManager';
import { scanAtlasTexels } from './IrradianceAtlasMapper';
import { Workbench } from './IrradianceSceneManager';
import { withLightScene } from './lightScene';
import {
  ProbeBatchReader,
  withLightProbe,
  generatePixelAreaLookup
} from './lightProbe';

const MAX_PASSES = 2;

const tmpRgba = new THREE.Vector4();

// applied inside the light probe scene
function createTemporaryLightMapTexture(
  atlasWidth: number,
  atlasHeight: number
): [THREE.Texture, Float32Array] {
  const atlasSize = atlasWidth * atlasHeight;
  const data = new Float32Array(4 * atlasSize);

  const texture = new THREE.DataTexture(
    data,
    atlasWidth,
    atlasHeight,
    THREE.RGBAFormat,
    THREE.FloatType
  );

  // use nearest filter inside the light probe scene for performance
  // @todo allow tweaking?
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;

  return [texture, data];
}

// collect and combine pixel aggregate from rendered probe viewports
// (this ignores the alpha channel from viewports)
function readTexel(
  rgba: THREE.Vector4,
  readLightProbe: ProbeBatchReader,
  probePixelAreaLookup: number[]
) {
  let r = 0,
    g = 0,
    b = 0,
    totalDivider = 0;

  for (const {
    rgbaData: probeData,
    rowPixelStride,
    probeBox: box,
    originX,
    originY
  } of readLightProbe()) {
    const probeTargetSize = box.z; // assuming width is always full

    const rowStride = rowPixelStride * 4;
    let rowStart = box.y * rowStride + box.x * 4;
    const totalMax = (box.y + box.w) * rowStride;
    let py = originY;

    while (rowStart < totalMax) {
      const rowMax = rowStart + box.z * 4;
      let px = originX;

      for (let i = rowStart; i < rowMax; i += 4) {
        // compute multiplier as affected by inclination of corresponding ray
        const area = probePixelAreaLookup[py * probeTargetSize + px];

        r += area * probeData[i];
        g += area * probeData[i + 1];
        b += area * probeData[i + 2];

        totalDivider += area;

        px += 1;
      }

      rowStart += rowStride;
      py += 1;
    }
  }

  // alpha is set later
  rgba.x = r / totalDivider;
  rgba.y = g / totalDivider;
  rgba.z = b / totalDivider;
}

// offsets for 3x3 brush
const offDirX = [1, 1, 0, -1, -1, -1, 0, 1];
const offDirY = [0, 1, 1, 1, 0, -1, -1, -1];

function storeLightMapValue(
  atlasData: Float32Array,
  atlasWidth: number,
  totalTexelCount: number,
  texelIndex: number,
  passOutputData: Float32Array
) {
  // read existing texel value (if adding)
  const mainOffTexelBase = texelIndex * 4;

  tmpRgba.w = 1; // reset alpha to 1 to indicate filled pixel

  // main texel write
  tmpRgba.toArray(passOutputData, mainOffTexelBase);

  // propagate combined value to 3x3 brush area
  const texelX = texelIndex % atlasWidth;
  const texelRowStart = texelIndex - texelX;

  for (let offDir = 0; offDir < 8; offDir += 1) {
    const offX = offDirX[offDir];
    const offY = offDirY[offDir];

    const offRowX = (atlasWidth + texelX + offX) % atlasWidth;
    const offRowStart =
      (totalTexelCount + texelRowStart + offY * atlasWidth) % totalTexelCount;
    const offTexelBase = (offRowStart + offRowX) * 4;

    // fill texel if it will not/did not receive real computed data otherwise;
    // also ensure strong neighbour values (not diagonal) take precedence
    // (using layer output data to check for past writes since it is re-initialized per pass)
    const offTexelFaceEnc = atlasData[offTexelBase + 2];
    const isStrongNeighbour = offX === 0 || offY === 0;
    const isUnfilled = passOutputData[offTexelBase + 3] === 0;

    if (offTexelFaceEnc === 0 && (isStrongNeighbour || isUnfilled)) {
      // no need to separately read existing value for brush-propagated texels
      tmpRgba.toArray(passOutputData, offTexelBase);
    }
  }
}

async function runBakingPasses(
  workbench: Workbench,
  requestWork: () => Promise<THREE.WebGLRenderer>
) {
  await withLightProbe(
    workbench.aoMode,
    workbench.aoDistance,
    workbench.settings,
    async (renderLightProbeBatch) => {
      const { atlasMap, irradiance, irradianceData } = workbench;
      const { width: atlasWidth, height: atlasHeight } = atlasMap;
      const totalTexelCount = atlasWidth * atlasHeight;

      // @todo make this async?
      const probePixelAreaLookup = generatePixelAreaLookup(
        workbench.settings.targetSize
      );

      for (let passCount = 0; passCount < MAX_PASSES; passCount += 1) {
        // set up a new output texture for new pass
        // @todo this might not even need to be a texture? but could be useful for live debug display
        const [passOutput, passOutputData] = createTemporaryLightMapTexture(
          atlasMap.width,
          atlasMap.height
        );

        // main work iteration
        let texelsDone = false;
        const texelIterator = scanAtlasTexels(atlasMap, () => {
          texelsDone = true;
        });

        while (!texelsDone) {
          const gl = await requestWork();

          for (const {
            texelIndex,
            partsReader: readLightProbe
          } of renderLightProbeBatch(gl, workbench.lightScene, texelIterator)) {
            readTexel(tmpRgba, readLightProbe, probePixelAreaLookup);

            // store resulting total illumination
            storeLightMapValue(
              atlasMap.data,
              atlasWidth,
              totalTexelCount,
              texelIndex,
              passOutputData
            );

            // make sure this shows up on next bounce pass
            // @todo move?
            passOutput.needsUpdate = true;
          }
        }

        // pass is complete, apply the computed texels into active lightmap
        // (used in the next pass and final display)
        irradianceData.set(passOutputData);
        irradiance.needsUpdate = true;

        // discard this pass's output texture
        passOutput.dispose();
      }
    }
  );
}

// individual renderer worker lifecycle instance
// (in parent, key to workbench.id to restart on changes)
// @todo report completed flag
const IrradianceRenderer: React.FC<{
  workbench: Workbench;
  onComplete: () => void;
  onDebugLightProbe?: (debugLightProbeTexture: THREE.Texture) => void;
}> = (props) => {
  // read once
  const workbenchRef = useRef(props.workbench);

  // wrap params in ref to avoid unintended re-triggering
  const onCompleteRef = useRef(props.onComplete);
  onCompleteRef.current = props.onComplete;
  const onDebugLightProbeRef = useRef(props.onDebugLightProbe);
  onDebugLightProbeRef.current = props.onDebugLightProbe;

  const [outputIsComplete, setOutputIsComplete] = useState(false);
  const requestWork = useWorkRequest(!outputIsComplete);

  // light scene setup
  useEffect(() => {
    // notify parent once scene cleanup is done
    if (outputIsComplete) {
      onCompleteRef.current();
      return;
    }

    const workbench = workbenchRef.current;

    // not tracking unmount here because the work manager will bail out anyway when unmounted early
    withLightScene(workbench, () =>
      runBakingPasses(workbench, requestWork)
    ).then(() => {
      setOutputIsComplete(true);
    });
  }, [outputIsComplete, requestWork]);

  // debug probe @todo rewrite
  /*
  const { renderLightProbeBatch: debugProbeBatch, debugLightProbeTexture } =
    useLightProbe(
      workbenchRef.current.aoMode,
      workbenchRef.current.aoDistance,
      workbenchRef.current.settings
    );
  const debugProbeRef = useRef(false);
  useFrame(({ gl }) => {
    // run only once
    if (debugProbeRef.current) {
      return;
    }
    debugProbeRef.current = true;

    const { atlasMap } = workbenchRef.current;

    const startX = 1;
    const startY = 1;
    function* debugIterator() {
      yield getTexelInfo(atlasMap, atlasMap.width * startY + startX);
    }

    for (const _item of debugProbeBatch(
      gl,
      workbenchRef.current.lightScene,
      debugIterator()
    )) {
      // no-op (not consuming the data)
    }
  });

  // report debug texture
  useEffect(() => {
    if (onDebugLightProbeRef.current) {
      onDebugLightProbeRef.current(debugLightProbeTexture);
    }
  }, [debugLightProbeTexture]);
  */

  return null;
};

export default IrradianceRenderer;
