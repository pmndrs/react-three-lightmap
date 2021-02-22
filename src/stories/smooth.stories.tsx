import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Story, Meta } from '@storybook/react';
import { useLoader, Canvas } from 'react-three-fiber';
import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader';

import Lightmap, { AutoUV2Ignore } from '../core/Lightmap';
import Spinner from './Spinner';
import DebugControls from './DebugControls';
import { DebugOverlayRenderer, DebugOverlayWidgets } from './DebugOverlayScene';

import './viewport.css';
import sceneUrl from './cylinder-smooth.glb';

export default {
  title: 'Smooth normals scene'
} as Meta;

const MainSceneContents: React.FC = () => {
  const loadedData = useLoader(GLTFLoader, sceneUrl);

  const loadedMeshList = useMemo(() => {
    const meshes: THREE.Mesh[] = [];

    loadedData.scene.traverse((object) => {
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

        object.material = new THREE.MeshLambertMaterial({
          color: stdMat.color,
          map: stdMat.map,
          emissive: stdMat.emissive,
          emissiveMap: stdMat.emissiveMap,
          emissiveIntensity: stdMat.emissiveIntensity
        });

        // always cast shadow, but only albedo materials receive it
        object.castShadow = true;
        object.receiveShadow = true;
      }

      meshes.push(object);
    });

    return meshes;
  }, [loadedData]);

  return (
    <AutoUV2Ignore>
      <mesh position={[0, 0, -2]} receiveShadow>
        <planeBufferGeometry attach="geometry" args={[20, 20]} />
        <meshLambertMaterial
          attach="material"
          color="#808080"
          emissive="#ffffff"
        />
      </mesh>

      {loadedMeshList.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} dispose={null} />
      ))}
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

    <DebugControls />
  </Canvas>
);
