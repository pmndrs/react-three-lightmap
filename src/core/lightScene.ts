import * as THREE from 'three';
import { Workbench, traverseSceneItems } from './workbench';

export type SupportedMaterial =
  | THREE.MeshLambertMaterial
  | THREE.MeshPhongMaterial
  | THREE.MeshStandardMaterial
  | THREE.MeshPhysicalMaterial;

export function materialIsSupported(
  material: THREE.Material
): material is SupportedMaterial {
  return (
    material instanceof THREE.MeshLambertMaterial ||
    material instanceof THREE.MeshPhongMaterial ||
    material instanceof THREE.MeshStandardMaterial ||
    material instanceof THREE.MeshPhysicalMaterial
  );
}

function buildStagingMaterial(
  workbench: Workbench,
  material: THREE.Material,
  isReadOnly: boolean
): THREE.Material {
  const { aoMode, emissiveMultiplier, bounceMultiplier, irradiance } =
    workbench;

  if (!materialIsSupported(material)) {
    return material;
  }

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

  // clone sensible presentation properties
  const stagingMaterial = new THREE.MeshPhongMaterial();
  stagingMaterial.name = 'Staging material';
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
  // (see below for AO/lightmap itself)
  if (!aoMode) {
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

  // deal with AO/lightmap
  if (isReadOnly) {
    // for read-only objects copy over pre-existing AO map
    stagingMaterial.aoMap = material.aoMap;
    stagingMaterial.aoMapIntensity = material.aoMapIntensity;

    // read-only objects might have their own lightmap, so we transfer that too
    // still also applying bounce multiplier for more light transmission
    // (but in AO mode ignore any lightmaps anyway)
    if (!aoMode) {
      stagingMaterial.lightMap = material.lightMap;
      stagingMaterial.lightMapIntensity =
        material.lightMapIntensity * bounceMultiplier;
    }
  } else {
    // set up our writable AO or lightmap as needed
    if (aoMode) {
      // @todo also respect bounce multiplier here (apply as inverse to AO intensity?)
      stagingMaterial.aoMap = irradiance; // use the AO texture
    } else {
      // use the lightmap texture
      stagingMaterial.lightMap = irradiance;

      // simply increase lightmap intensity for more bounce
      stagingMaterial.lightMapIntensity = bounceMultiplier;

      // also copy over any existing AO map
      stagingMaterial.aoMap = material.aoMap;
      stagingMaterial.aoMapIntensity = material.aoMapIntensity;
    }
  }

  return stagingMaterial;
}

export async function stageLightSceneMaterials(
  workbench: Workbench,
  mergedMesh: THREE.Mesh,
  materials: THREE.Material[],
  taskCallback: () => Promise<void>
) {
  const { aoMode, lightScene } = workbench;

  mergedMesh.material = materials.map((material) =>
    buildStagingMaterial(workbench, material, false)
  );

  const suppressedList: THREE.Object3D[] = [];

  const onIgnored = (ignoredObject: THREE.Object3D) => {
    if (!ignoredObject.visible) {
      return;
    }

    // also prevent ignored items from rendering
    ignoredObject.visible = false;
    suppressedList.push(ignoredObject);
  };

  for (const object of traverseSceneItems(lightScene, false, onIgnored)) {
    // hide any visible lights to prevent interfering with AO
    if (aoMode && object instanceof THREE.Light && object.visible) {
      object.visible = false;
      suppressedList.push(object);
      continue;
    }

    if (!(object instanceof THREE.Mesh) || object === mergedMesh) {
      continue;
    }

    const mesh = object;
    const materialList = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];

    const stagingMaterialList = materialList.map(
      (material) => material && buildStagingMaterial(workbench, material, true)
    );

    mesh.material = Array.isArray(mesh.material)
      ? stagingMaterialList
      : stagingMaterialList[0];
  }

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

    // re-enable suppressed items and lights
    suppressedList.forEach((object) => {
      object.visible = true;
    });
  }
}
