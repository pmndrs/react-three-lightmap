import React from 'react';
import { Story, Meta } from '@storybook/react';
import { Canvas } from 'react-three-fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

import Lightmap, { LightmapIgnore } from '../core/Lightmap';
import Spinner from './Spinner';
import { DebugOverlayRenderer, DebugOverlayWidgets } from './DebugOverlayScene';

export default {
  title: 'Ambient occlusion',
  parameters: {
    layout: 'fullscreen'
  },
  decorators: [(story) => <div style={{ height: '100vh' }}>{story()}</div>]
} as Meta;

export const Main: Story = () => (
  <Canvas
    colorManagement={false} // @todo reconsider
    camera={{ position: [-6, -4, 2], up: [0, 0, 1] }}
    shadowMap
    onCreated={({ gl }) => {
      gl.toneMapping = THREE.ACESFilmicToneMapping;
      gl.toneMappingExposure = 0.9;

      gl.outputEncoding = THREE.sRGBEncoding;
    }}
  >
    <DebugOverlayRenderer>
      <React.Suspense fallback={<Spinner />}>
        <Lightmap texelsPerUnit={3}>
          <mesh position={[0, 0, 0]} castShadow receiveShadow>
            <boxBufferGeometry attach="geometry" args={[3, 3, 1]} />
            <meshLambertMaterial attach="material" color="#ff6080" />
          </mesh>

          <mesh position={[0, 0, 1.8]} castShadow receiveShadow>
            <boxBufferGeometry attach="geometry" args={[2, 2, 2]} />
            <meshLambertMaterial attach="material" color="#4080ff" />
          </mesh>

          <ambientLight color="#ffffff" />

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
