import React from 'react';
import { Story, Meta } from '@storybook/react';
import { Canvas, useLoader } from 'react-three-fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

import Lightmap, { AutoUV2Ignore } from '../core/Lightmap';
import Spinner from './Spinner';
import { DebugOverlayRenderer, DebugOverlayWidgets } from './DebugOverlayScene';

import './viewport.css';

export default {
  title: 'Text mesh scene'
} as Meta;

const Scene: React.FC = () => {
  const font = useLoader(
    THREE.FontLoader,
    'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/fonts/helvetiker_regular.typeface.json'
  );

  return (
    <Lightmap texelsPerUnit={4}>
      <AutoUV2Ignore>
        <mesh position={[0, 0, -2]} receiveShadow>
          <planeBufferGeometry attach="geometry" args={[20, 20]} />
          <meshPhongMaterial
            attach="material"
            color="#808080"
            //shininess={0}
          />
        </mesh>
      </AutoUV2Ignore>

      <mesh position={[-2, -1, 0]} castShadow receiveShadow>
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
        <meshPhongMaterial attach="material" color="#c0c0c0" />
      </mesh>

      <spotLight
        angle={0.75}
        distance={25}
        intensity={2}
        penumbra={0.5}
        position={[-8, 8, 8]}
        castShadow
      />

      <DebugOverlayWidgets />
    </Lightmap>
  );
};

export const Main: Story = () => (
  <Canvas
    colorManagement={false} // @todo reconsider
    camera={{ position: [-6, -4, 4], up: [0, 0, 1] }}
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
