import React, { useMemo } from 'react';
import { Story, Meta } from '@storybook/react';
import { useLoader, Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

import Lightmap, { LightmapReadOnly } from '../core/Lightmap';
import Spinner from './Spinner';
import { DebugOverlayRenderer, DebugOverlayWidgets } from './DebugOverlayScene';

import sceneUrl from './tile-game-room6.glb';

export default {
  title: 'glTF scene',
  parameters: {
    layout: 'fullscreen'
  },
  decorators: [(story) => <div style={{ height: '100vh' }}>{story()}</div>]
} as Meta;

const MainSceneContents: React.FC = () => {
  // data loading
  const { nodes } = useLoader(GLTFLoader, sceneUrl);

  const lightStub = nodes.Light;

  const light = new THREE.DirectionalLight();
  light.castShadow = true;

  // glTF import is still not great with lights, so we improvise
  light.intensity = lightStub.scale.z;
  light.shadow.camera.left = -lightStub.scale.x;
  light.shadow.camera.right = lightStub.scale.x;
  light.shadow.camera.top = lightStub.scale.y;
  light.shadow.camera.bottom = -lightStub.scale.y;

  light.position.copy(lightStub.position);

  const target = new THREE.Object3D();
  target.position.set(0, 0, -1);
  target.position.applyEuler(lightStub.rotation);
  target.position.add(lightStub.position);

  light.target = target;

  const baseMesh = nodes.Base;
  if (
    baseMesh instanceof THREE.Mesh &&
    baseMesh.material instanceof THREE.MeshStandardMaterial
  ) {
    baseMesh.material.metalness = 0; // override default full metalness (to have diffuse component)
    baseMesh.material.side = THREE.FrontSide;

    if (baseMesh.material.map) {
      baseMesh.material.map.magFilter = THREE.NearestFilter;
    }

    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
  }

  const coverMesh = nodes.Cover;
  if (
    coverMesh instanceof THREE.Mesh &&
    coverMesh.material instanceof THREE.MeshStandardMaterial
  ) {
    coverMesh.castShadow = true; // only cast shadow

    coverMesh.material.depthWrite = false;
    coverMesh.material.colorWrite = false;
  }

  return (
    <>
      <LightmapReadOnly>
        <mesh position={[0, 0, -5]}>
          <planeBufferGeometry attach="geometry" args={[200, 200]} />
          <meshBasicMaterial attach="material" color="#171717" />
        </mesh>

        <primitive object={coverMesh} dispose={null} />
      </LightmapReadOnly>

      <primitive object={light} dispose={null} />
      <primitive object={light.target} dispose={null} />

      <primitive object={baseMesh} dispose={null} />

      <spotLight
        position={[0, 0, 2]}
        color="#f00"
        castShadow
        penumbra={0.25}
        intensity={0.5}
      />
    </>
  );
};

export const Main: Story = () => (
  <Canvas
    camera={{ position: [-4, -4, 8], up: [0, 0, 1] }}
    shadows
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
