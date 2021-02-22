import React, { useMemo } from 'react';
import { Story, Meta } from '@storybook/react';
import { useLoader, Canvas } from 'react-three-fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

import Lightmap, { AutoUV2Ignore } from '../core/Lightmap';
import Spinner from './Spinner';
import { DebugOverlayRenderer, DebugOverlayWidgets } from './DebugOverlayScene';

import sceneUrl from './tile-game-room6.glb';

export default {
  title: 'glTF scene',
  parameters: {
    layout: 'fullscreen'
  }
} as Meta;

const MainSceneContents: React.FC = () => {
  // data loading
  const loadedData = useLoader(GLTFLoader, sceneUrl);

  const { loadedMeshList, loadedLightList } = useMemo(() => {
    const meshes: THREE.Mesh[] = [];
    const lights: THREE.DirectionalLight[] = [];

    if (loadedData) {
      loadedData.scene.traverse((object) => {
        // glTF import is still not great with lights, so we improvise
        if (object.name.includes('Light')) {
          const light = new THREE.DirectionalLight();
          light.intensity = object.scale.z;

          light.castShadow = true;
          light.shadow.camera.left = -object.scale.x;
          light.shadow.camera.right = object.scale.x;
          light.shadow.camera.top = object.scale.y;
          light.shadow.camera.bottom = -object.scale.y;

          light.position.copy(object.position);

          const target = new THREE.Object3D();
          target.position.set(0, 0, -1);
          target.position.applyEuler(object.rotation);
          target.position.add(light.position);

          light.target = target;

          lights.push(light);
          return;
        }

        if (!(object instanceof THREE.Mesh)) {
          return;
        }

        // convert glTF's standard material into Lambert
        if (object.material) {
          const stdMat = object.material as THREE.MeshStandardMaterial;

          if (stdMat.map) {
            stdMat.map.magFilter = THREE.NearestFilter;
          }

          if (stdMat.emissiveMap) {
            stdMat.emissiveMap.magFilter = THREE.NearestFilter;
          }

          object.material = new THREE.MeshPhongMaterial({
            color: stdMat.color,
            map: stdMat.map,
            emissive: stdMat.emissive,
            emissiveMap: stdMat.emissiveMap,
            emissiveIntensity: stdMat.emissiveIntensity
          });

          // always cast shadow, but only albedo materials receive it
          object.castShadow = true;

          if (stdMat.map) {
            object.receiveShadow = true;
          }

          // special case for outer sunlight cover
          if (object.name === 'Cover') {
            object.material.depthWrite = false;
            object.material.colorWrite = false;
          }
        }

        meshes.push(object);
      });
    }

    return {
      loadedMeshList: meshes,
      loadedLightList: lights
    };
  }, [loadedData]);

  const baseMesh = loadedMeshList.find((item) => item.name === 'Base');
  const coverMesh = loadedMeshList.find((item) => item.name === 'Cover');

  return (
    <AutoUV2Ignore>
      <mesh position={[0, 0, -5]}>
        <planeBufferGeometry attach="geometry" args={[200, 200]} />
        <meshBasicMaterial attach="material" color="#171717" />
      </mesh>

      {loadedLightList.map((light) => (
        <React.Fragment key={light.uuid}>
          <primitive object={light} dispose={null} />
          <primitive object={light.target} dispose={null} />
        </React.Fragment>
      ))}

      {baseMesh && <primitive object={baseMesh} dispose={null} />}

      {coverMesh && <primitive object={coverMesh} dispose={null} />}

      <spotLight
        position={[0, 0, 2]}
        color="#f00"
        castShadow
        penumbra={0.25}
        intensity={0.5}
      />
    </AutoUV2Ignore>
  );
};

export const Main: Story = () => (
  <Canvas
    colorManagement={false} // @todo reconsider
    camera={{ position: [-4, -4, 8], up: [0, 0, 1] }}
    shadowMap
    onCreated={({ gl }) => {
      gl.toneMapping = THREE.ACESFilmicToneMapping;
      gl.toneMappingExposure = 0.9;

      gl.outputEncoding = THREE.sRGBEncoding;
    }}
  >
    <DebugOverlayRenderer>
      <React.Suspense fallback={<Spinner />}>
        <Lightmap textureFilter={THREE.NearestFilter}>
          <MainSceneContents />

          <DebugOverlayWidgets />
        </Lightmap>
      </React.Suspense>
    </DebugOverlayRenderer>

    <OrbitControls
      enableDamping
      dampingFactor={0.1}
      rotateSpeed={0.5}
      target={new THREE.Vector3(0, 0, 1)}
    />
  </Canvas>
);
