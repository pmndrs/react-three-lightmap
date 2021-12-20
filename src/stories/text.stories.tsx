import React from 'react';
import { Story, Meta } from '@storybook/react';
import { Canvas, useLoader } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

import Lightmap, { AutoUV2Ignore } from '../core/Lightmap';
import Spinner from './Spinner';
import { DebugOverlayRenderer, DebugOverlayWidgets } from './DebugOverlayScene';

export default {
  title: 'Text mesh scene',
  parameters: {
    layout: 'fullscreen'
  },
  decorators: [(story) => <div style={{ height: '100vh' }}>{story()}</div>]
} as Meta;

const Scene: React.FC = () => {
  const font = useLoader(
    THREE.FontLoader,
    'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/fonts/helvetiker_regular.typeface.json'
  );

  return (
    <Lightmap ao texelsPerUnit={4}>
      <AutoUV2Ignore>
        <mesh position={[0, 0, -1]} receiveShadow>
          <planeBufferGeometry attach="geometry" args={[20, 20]} />
          <meshPhongMaterial
            attach="material"
            color="#ffffff"
            //shininess={0}
          />
        </mesh>
      </AutoUV2Ignore>

      <mesh position={[-2.5, 1, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <textBufferGeometry
          attach="geometry"
          args={[
            'Hi',
            {
              font,
              size: 4,
              height: 1.5,
              curveSegments: 1
            }
          ]}
        />
        <meshPhongMaterial
          attach="material"
          color="#e0e0e0"
          aoMapIntensity={1.5}
          shininess={1}
        />
      </mesh>

      <spotLight
        angle={0.75}
        distance={25}
        penumbra={0.5}
        position={[0, 2.5, 12]}
        color="#60656a"
        intensity={2}
        castShadow
      />
      <ambientLight color="#60656a" />

      <DebugOverlayWidgets />
    </Lightmap>
  );
};

export const Main: Story = () => (
  <Canvas
    colorManagement={false} // @todo reconsider
    camera={{ position: [2, -8, 1], up: [0, 0, 1] }}
    shadowMap
    onCreated={({ gl }) => {
      gl.toneMapping = THREE.ACESFilmicToneMapping;
      gl.toneMappingExposure = 0.9;

      gl.outputEncoding = THREE.sRGBEncoding;
    }}
  >
    <DebugOverlayRenderer>
      <React.Suspense fallback={<Spinner />}>
        <Scene />
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
