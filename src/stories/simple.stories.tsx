import React from 'react';
import { Story, Meta } from '@storybook/react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

import Lightmap from '../core/Lightmap';
import Spinner from './Spinner';
import { DebugOverlayRenderer, DebugOverlayWidgets } from './DebugOverlayScene';

export default {
  title: 'Simple scene',
  parameters: {
    layout: 'fullscreen'
  },
  decorators: [(story) => <div style={{ height: '100vh' }}>{story()}</div>]
} as Meta;

export const Main: Story = () => (
  <Canvas
    camera={{ position: [-6, -4, 2], up: [0, 0, 1] }}
    shadows
    onCreated={({ gl }) => {
      gl.toneMapping = THREE.ACESFilmicToneMapping;
      gl.toneMappingExposure = 0.9;

      gl.outputEncoding = THREE.sRGBEncoding;
    }}
  >
    <DebugOverlayRenderer>
      <React.Suspense fallback={<Spinner />}>
        <Lightmap texelsPerUnit={1.2}>
          <mesh position={[0, 0, -3]} receiveShadow>
            <planeBufferGeometry attach="geometry" args={[20, 20]} />
            <meshLambertMaterial attach="material" color="#808080" />
          </mesh>

          <mesh position={[0, 1.5, 0]} castShadow receiveShadow>
            <boxBufferGeometry attach="geometry" args={[2, 2, 5]} />
            <meshLambertMaterial attach="material" color="#c0c0c0" />
          </mesh>

          <mesh position={[0, -1.5, -1.5]} castShadow receiveShadow>
            <boxBufferGeometry attach="geometry" args={[2, 2, 2]} />
            <meshLambertMaterial
              attach="material"
              color="#0000ff"
              emissive="#0000ff"
              emissiveIntensity={0.25}
            />
          </mesh>

          <mesh position={[0, -1.5, 1.5]} castShadow receiveShadow>
            <boxBufferGeometry attach="geometry" args={[2, 2, 2]} />
            <meshLambertMaterial attach="material" color="#ff0000" />
          </mesh>

          <directionalLight
            intensity={1}
            position={[-2.5, 2.5, 4]}
            castShadow
          />

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
