import React from 'react';
import { Story, Meta } from '@storybook/react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

import Lightmap from '../core/Lightmap';
import Spinner from './Spinner';
import { DebugOverlayRenderer, DebugOverlayWidgets } from './DebugOverlayScene';

export default {
  title: 'Multi-material mesh',
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
        <Lightmap texelsPerUnit={3} workPerFrame={4}>
          <mesh position={[0, 0, -2]} receiveShadow>
            <planeBufferGeometry attach="geometry" args={[4, 4]} />
            <meshLambertMaterial attach="material" color="#f0f0f0" />
          </mesh>

          <mesh
            position={[2, 0, 0]}
            rotation={[0, -Math.PI / 2, 0]}
            receiveShadow
          >
            <planeBufferGeometry attach="geometry" args={[4, 4]} />
            <meshLambertMaterial attach="material" color="#f0f0f0" />
          </mesh>

          <mesh position={[0, 0, 0]} castShadow receiveShadow>
            <boxBufferGeometry attach="geometry" args={[1, 1, 1]} />

            <meshLambertMaterial
              attachArray="material"
              color="#f0f0f0"
              emissiveIntensity={2}
              emissive={new THREE.Color('#ffffff')}
            />
            <meshLambertMaterial attachArray="material" color="#ff0000" />
            <meshLambertMaterial attachArray="material" color="#00ff00" />
            <meshLambertMaterial attachArray="material" color="#0000ff" />
            <meshLambertMaterial attachArray="material" color="#ff00ff" />
            <meshLambertMaterial attachArray="material" color="#ffff00" />
          </mesh>

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
