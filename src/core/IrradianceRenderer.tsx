import React, { useEffect, useState, useMemo, useContext, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { WorkManagerContext } from './WorkManager';
import { traverseAtlasItems, AtlasMap } from './IrradianceAtlasMapper';
import { Workbench } from './IrradianceSceneManager';
import {
  ProbeBatchRenderer,
  ProbeBatchReader,
  useLightProbe
} from './IrradianceLightProbe';

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

function queueTexel(
  atlasMap: AtlasMap,
  texelIndex: number,
  renderLightProbe: ProbeBatchRenderer
): boolean {
  // get current atlas face we are filling up
  const texelInfoBase = texelIndex * 4;
  const texelPosU = atlasMap.data[texelInfoBase];
  const texelPosV = atlasMap.data[texelInfoBase + 1];
  const texelItemEnc = atlasMap.data[texelInfoBase + 2];
  const texelFaceEnc = atlasMap.data[texelInfoBase + 3];

  // skip computation if this texel is empty
  if (texelItemEnc === 0) {
    return false;
  }

  // otherwise, proceed with computation and exit
  const texelItemIndex = Math.round(texelItemEnc - 1);
  const texelFaceIndex = Math.round(texelFaceEnc - 1);

  if (texelItemIndex < 0 || texelItemIndex >= atlasMap.items.length) {
    throw new Error(
      `incorrect atlas map item data: ${texelPosU}, ${texelPosV}, ${texelItemEnc}, ${texelFaceEnc}`
    );
  }

  const atlasItem = atlasMap.items[texelItemIndex];

  if (texelFaceIndex < 0 || texelFaceIndex >= atlasItem.faceCount) {
    throw new Error(
      `incorrect atlas map face data: ${texelPosU}, ${texelPosV}, ${texelItemEnc}, ${texelFaceEnc}`
    );
  }

  // render the probe viewports (will read the data later)
  renderLightProbe(texelIndex, atlasItem, texelFaceIndex, texelPosU, texelPosV);

  // signal that computation happened
  return true;
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

  readLightProbe((probeData, rowPixelStride, box, originX, originY) => {
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
  });

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

type SupportedMaterial =
  | THREE.MeshLambertMaterial
  | THREE.MeshPhongMaterial
  | THREE.MeshStandardMaterial
  | THREE.MeshPhysicalMaterial;

function materialIsSupported(
  material: THREE.Material
): material is SupportedMaterial {
  return (
    material instanceof THREE.MeshLambertMaterial ||
    material instanceof THREE.MeshPhongMaterial ||
    material instanceof THREE.MeshStandardMaterial ||
    material instanceof THREE.MeshPhysicalMaterial
  );
}

const ORIGINAL_MATERIAL_KEY = Symbol(
  'lightmap baker: stashed original material'
);
type UserDataStore<T extends symbol, V> = Record<T, V | undefined>;

function useScenePrep(
  workbenchRef: React.MutableRefObject<Workbench>,
  outputIsComplete: boolean
) {
  useEffect(() => {
    // nothing to do if finished
    if (outputIsComplete) {
      return () => undefined;
    }

    // prepare the scene for baking
    const { aoMode, emissiveMultiplier, lightScene, irradiance } =
      workbenchRef.current;

    // process relevant meshes
    const meshCleanupList: THREE.Mesh[] = [];
    const lightCleanupList: THREE.Light[] = [];

    traverseAtlasItems(lightScene, (object) => {
      // hide any visible lights to prevent interfering with AO
      if (aoMode && object instanceof THREE.Light && object.visible) {
        object.visible = false;
        lightCleanupList.push(object);

        return;
      }

      // simple check for type (no need to check for uv2 presence)
      if (!(object instanceof THREE.Mesh)) {
        return;
      }

      const mesh = object;

      // attach the lightmap to materials that we recognize
      // (checking against accidentally overriding some unrelated lightmap)
      // @todo allow manually attaching to custom materials too
      const material = mesh.material;
      if (
        material &&
        !Array.isArray(material) &&
        materialIsSupported(material)
      ) {
        // basic safety check
        if (aoMode) {
          if (material.aoMap && material.aoMap !== irradiance) {
            throw new Error(
              'do not set your own AO map manually on baked scene meshes'
            );
          }
        } else {
          if (material.lightMap && material.lightMap !== irradiance) {
            throw new Error(
              'do not set your own light map manually on baked scene meshes'
            );
          }
        }

        // stash material to be replaced with ours
        (
          mesh.userData as UserDataStore<
            typeof ORIGINAL_MATERIAL_KEY,
            SupportedMaterial
          >
        )[ORIGINAL_MATERIAL_KEY] = material;

        // clone sensible presentation properties
        const stagingMaterial = new THREE.MeshPhongMaterial();
        stagingMaterial.alphaMap = material.alphaMap;
        stagingMaterial.alphaTest = material.alphaTest;
        if (!(material instanceof THREE.MeshLambertMaterial)) {
          stagingMaterial.displacementBias = material.displacementBias;
          stagingMaterial.displacementMap = material.displacementMap;
          stagingMaterial.displacementScale = material.displacementScale;
          stagingMaterial.flatShading = material.flatShading;
        }
        stagingMaterial.morphNormals = material.morphNormals;
        stagingMaterial.morphTargets = material.morphTargets;
        stagingMaterial.opacity = material.opacity;
        stagingMaterial.premultipliedAlpha = material.premultipliedAlpha;
        stagingMaterial.side = material.side;
        stagingMaterial.skinning = material.skinning;
        stagingMaterial.transparent = material.transparent;
        stagingMaterial.visible = material.visible;

        // in non-AO mode, also transfer pigmentation/emissive/other settings
        if (!aoMode) {
          stagingMaterial.aoMap = material.aoMap;
          stagingMaterial.aoMapIntensity = material.aoMapIntensity;
          stagingMaterial.color = material.color;
          stagingMaterial.emissive = material.emissive;
          stagingMaterial.emissiveIntensity =
            material.emissiveIntensity * emissiveMultiplier;
          stagingMaterial.emissiveMap = material.emissiveMap;
          stagingMaterial.map = material.map;
          stagingMaterial.shadowSide = material.shadowSide;
          stagingMaterial.vertexColors = material.vertexColors;
        }

        // mandatory settings
        stagingMaterial.shininess = 0; // always fully diffuse
        stagingMaterial.toneMapped = false; // must output in raw linear space

        // mode-specific texture setup
        if (aoMode) {
          stagingMaterial.aoMap = irradiance; // use the AO texture
        } else {
          stagingMaterial.lightMap = irradiance; // use the lightmap texture
        }

        mesh.material = stagingMaterial;

        // keep a simple list for later cleanup
        meshCleanupList.push(mesh);
      }
    });

    let aoSceneLight: THREE.Light | null = null;
    if (aoMode) {
      // add our own ambient light for second pass of ambient occlusion
      // (this lights the texels unmasked by previous AO passes for further propagation)
      aoSceneLight = new THREE.AmbientLight('#ffffff');
      lightScene.add(aoSceneLight);
    }

    return () => {
      // remove the staging ambient light
      if (aoSceneLight) {
        lightScene.remove(aoSceneLight);
      }

      // re-enable scene lights
      lightCleanupList.forEach((light) => {
        light.visible = true;
      });

      // replace staging material with original
      meshCleanupList.forEach((mesh) => {
        // get stashed material and clean up object key
        const userData = mesh.userData as UserDataStore<
          typeof ORIGINAL_MATERIAL_KEY,
          SupportedMaterial
        >;
        const material = userData[ORIGINAL_MATERIAL_KEY];
        delete userData[ORIGINAL_MATERIAL_KEY];

        if (material) {
          mesh.material = material;

          // also fill in the resulting map
          if (aoMode) {
            material.aoMap = irradiance;
          } else {
            material.lightMap = irradiance;
          }
        } else {
          console.error('lightmap baker: missing original material', mesh);
        }
      });
    };
  }, [outputIsComplete]);
}

// individual renderer worker lifecycle instance
// (in parent, key to workbench.id to restart on changes)
// @todo report completed flag
const IrradianceRenderer: React.FC<{
  workbench: Workbench;
  onComplete: () => void;
  onDebugLightProbe?: (debugLightProbeTexture: THREE.Texture) => void;
}> = (props) => {
  // get the work manager hook
  const useWorkManager = useContext(WorkManagerContext);
  if (useWorkManager === null) {
    throw new Error('expected work manager');
  }

  // read once
  const workbenchRef = useRef(props.workbench);

  // wrap params in ref to avoid unintended re-triggering
  const onCompleteRef = useRef(props.onComplete);
  onCompleteRef.current = props.onComplete;
  const onDebugLightProbeRef = useRef(props.onDebugLightProbe);
  onDebugLightProbeRef.current = props.onDebugLightProbe;

  // texel indexes for randomized processing (literally just a randomly shuffled index array)
  // @todo is this relevant anymore?
  const texelPickMap = useMemo(() => {
    const { atlasMap } = workbenchRef.current;
    const { width: atlasWidth, height: atlasHeight } = atlasMap;
    const totalTexelCount = atlasWidth * atlasHeight;

    const result = new Array<number>(totalTexelCount) as number[] & {
      pickMapReady?: boolean;
    };

    // perform main fill in separate tick for responsiveness
    setTimeout(() => {
      const originalSequence = new Array<number>(totalTexelCount);

      // nested loop to avoid tripping sandbox infinite loop detection
      for (let i = 0; i < atlasHeight; i += 1) {
        for (let j = 0; j < atlasWidth; j += 1) {
          const index = i * atlasWidth + j;
          originalSequence[index] = index;
        }
      }

      // nested loop to avoid tripping sandbox infinite loop detection
      for (let i = 0; i < atlasHeight; i += 1) {
        for (let j = 0; j < atlasWidth; j += 1) {
          const index = i * atlasWidth + j;
          const randomIndex = Math.random() * originalSequence.length;
          const sequenceElement = originalSequence.splice(randomIndex, 1)[0];
          result[index] = sequenceElement;
        }
      }

      // signal completion
      result.pickMapReady = true;
    }, 0);

    return result;
  }, []);

  const [processingState, setProcessingState] = useState(() => {
    return {
      passOutput: undefined as THREE.Texture | undefined, // current pass's output
      passOutputData: undefined as Float32Array | undefined, // current pass's output data
      passTexelCounter: [0], // directly changed in place to avoid re-renders
      passComplete: true, // this triggers new pass on next render
      passesRemaining: MAX_PASSES
    };
  });

  // kick off new pass when current one is complete
  useEffect(() => {
    const { passComplete, passesRemaining } = processingState;

    // check if there is anything to do
    if (!passComplete) {
      return;
    }

    const { irradiance, irradianceData } = workbenchRef.current;

    // store and discard the active layer output texture
    if (processingState.passOutput && processingState.passOutputData) {
      irradianceData.set(processingState.passOutputData);
      irradiance.needsUpdate = true;
      processingState.passOutput.dispose();
    }

    // check if a new pass has to be set up
    if (passesRemaining === 0) {
      // if done, dereference large data objects to help free up memory
      setProcessingState((prev) => {
        if (!prev.passOutputData) {
          return prev;
        }
        return { ...prev, passOutputData: undefined };
      });

      // notify parent
      onCompleteRef.current();

      return;
    }

    // set up a new output texture for new pass
    // @todo this might not even need to be a texture? but could be useful for live debug display
    const [passOutput, passOutputData] = createTemporaryLightMapTexture(
      workbenchRef.current.atlasMap.width,
      workbenchRef.current.atlasMap.height
    );

    setProcessingState((prev) => {
      return {
        passOutput,
        passOutputData,
        passTexelCounter: [0],
        passComplete: false,
        passesRemaining: prev.passesRemaining - 1
      };
    });
  }, [processingState]);

  const { renderLightProbeBatch, probePixelAreaLookup } = useLightProbe(
    workbenchRef.current.aoMode,
    workbenchRef.current.aoDistance,
    workbenchRef.current.settings
  );

  const outputIsComplete =
    processingState.passesRemaining === 0 && processingState.passComplete;

  useScenePrep(workbenchRef, outputIsComplete);

  useWorkManager(
    outputIsComplete
      ? null
      : (gl) => {
          const { passTexelCounter, passOutput, passOutputData } =
            processingState;

          const { atlasMap } = workbenchRef.current;
          const { width: atlasWidth, height: atlasHeight } = atlasMap;
          const totalTexelCount = atlasWidth * atlasHeight;

          // wait for lookup map to be built up
          if (!texelPickMap.pickMapReady) {
            return;
          }

          if (!passOutputData || !passOutput) {
            throw new Error('unexpected missing output');
          }

          renderLightProbeBatch(
            gl,
            workbenchRef.current.lightScene,
            (renderBatchItem) => {
              // allow for skipping a certain amount of empty texels
              const maxCounter = Math.min(
                totalTexelCount,
                passTexelCounter[0] + 100
              );

              // keep trying texels until non-empty one is found
              while (passTexelCounter[0] < maxCounter) {
                const currentCounter = passTexelCounter[0];

                // always update texel count
                passTexelCounter[0] += 1;

                if (
                  !queueTexel(
                    atlasMap,
                    texelPickMap[currentCounter],
                    renderBatchItem
                  )
                ) {
                  continue;
                }

                // if something was queued, stop the loop
                break;
              }
            },
            (texelIndex, readLightProbe) => {
              readTexel(tmpRgba, readLightProbe, probePixelAreaLookup);

              // store resulting total illumination
              storeLightMapValue(
                atlasMap.data,
                atlasWidth,
                totalTexelCount,
                texelIndex,
                passOutputData
              );
              passOutput.needsUpdate = true;
            }
          );

          // mark state as completed once all texels are done
          if (passTexelCounter[0] >= totalTexelCount) {
            setProcessingState((prev) => {
              return {
                ...prev,
                passComplete: true
              };
            });
          }
        }
  );

  // debug probe
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

    let batchCount = 0;

    debugProbeBatch(
      gl,
      workbenchRef.current.lightScene,
      (renderBatchItem) => {
        queueTexel(
          atlasMap,
          atlasMap.width * 1 + 1 + batchCount,
          renderBatchItem
        );
        batchCount += 1;
      },
      () => {
        // no-op (not consuming the data)
      }
    );
  });

  // report debug texture
  useEffect(() => {
    if (onDebugLightProbeRef.current) {
      onDebugLightProbeRef.current(debugLightProbeTexture);
    }
  }, [debugLightProbeTexture]);

  return null;
};

export default IrradianceRenderer;
