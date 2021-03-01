import React from 'react';
import { Story, Meta } from '@storybook/react';
import { useLoader, Canvas } from 'react-three-fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

import Lightmap, { AutoUV2Ignore } from '../core/Lightmap';
import Spinner from './Spinner';
import { DebugOverlayRenderer, DebugOverlayWidgets } from './DebugOverlayScene';

import sceneUrl from './cylinder-smooth.glb';

export default {
  title: 'Smooth normals scene',
  parameters: {
    layout: 'fullscreen'
  },
  decorators: [(story) => <div style={{ height: '100vh' }}>{story()}</div>]
} as Meta;

const MainSceneContents: React.FC = () => {
  const { nodes } = useLoader(GLTFLoader, sceneUrl);

  // apply visual tweaks to our mesh
  const mesh = nodes.Cylinder;

  if (
    mesh instanceof THREE.Mesh &&
    mesh.material instanceof THREE.MeshStandardMaterial
  ) {
    mesh.material.metalness = 0; // override default full metalness (to have diffuse component)
  }

  mesh.castShadow = true;
  mesh.receiveShadow = true;

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

      <primitive key={mesh.uuid} object={mesh} dispose={null} />
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
