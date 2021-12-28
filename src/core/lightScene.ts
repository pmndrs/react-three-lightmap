import * as THREE from 'three';
import { traverseAtlasItems } from './IrradianceAtlasMapper';
import { Workbench } from './IrradianceSceneManager';

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

export async function withLightScene(
  workbench: Workbench,
  taskCallback: () => Promise<void>
) {
  // prepare the scene for baking
  const { aoMode, emissiveMultiplier, lightScene, irradiance } = workbench;

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

    // for items with regular materials, temporarily replace the material with our
    // special "staging" material to be able to sub-in intermediate lightmap
    // texture during bounce passes
    // (checking against accidentally overriding some unrelated lightmap)
    // @todo allow developer to also flag certain custom materials as allowed
    const material = mesh.material;
    if (material && !Array.isArray(material) && materialIsSupported(material)) {
      // basic safety check
      // @todo just hide these items, maybe with a warning
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

      // stash original material so that we can restore it later
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

  // perform main task and then clean up regardless of error state
  try {
    await taskCallback();
  } finally {
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
  }
}
