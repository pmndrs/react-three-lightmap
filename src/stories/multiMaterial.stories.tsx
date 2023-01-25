import React from 'react';
import { Story, Meta } from '@storybook/react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

import Lightmap from '../core/Lightmap';
import Spinner from './Spinner';
import { DebugOverlayRenderer } from './DebugOverlayScene';

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
            <meshLambertMaterial color="#f0f0f0" />
          </mesh>

          <mesh
            position={[2, 0, 0]}
            rotation={[0, -Math.PI / 2, 0]}
            receiveShadow
          >
            <planeBufferGeometry attach="geometry" args={[4, 4]} />
            <meshLambertMaterial color="#f0f0f0" />
          </mesh>

          <mesh position={[0, 0, 0]} castShadow receiveShadow>
            <boxBufferGeometry attach="geometry" args={[1, 1, 1]} />

            <meshLambertMaterial
              attach="material-0"
              color="#f0f0f0"
              emissiveIntensity={2}
              emissive={new THREE.Color('#ffffff')}
            />
            <meshLambertMaterial attach="material-1" color="#ff0000" />
            <meshLambertMaterial attach="material-2" color="#00ff00" />
            <meshLambertMaterial attach="material-3" color="#0000ff" />
            <meshLambertMaterial attach="material-4" color="#ff00ff" />
            <meshLambertMaterial attach="material-5" color="#ffff00" />
          </mesh>
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
