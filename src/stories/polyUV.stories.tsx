import React from 'react';
import { Story, Meta } from '@storybook/react';
import { Canvas } from 'react-three-fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

import Lightmap, { AutoUV2Ignore } from '../core/Lightmap';
import Spinner from './Spinner';
import { DebugOverlayRenderer, DebugOverlayWidgets } from './DebugOverlayScene';

export default {
  title: 'Cylinder scene (polygon UV)',
  parameters: {
    layout: 'fullscreen'
  }
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
        <Lightmap texelsPerUnit={4}>
          <AutoUV2Ignore>
            <mesh position={[0, 0, -2]} receiveShadow>
              <planeBufferGeometry attach="geometry" args={[20, 20]} />
              <meshLambertMaterial attach="material" color="#ffffff" />
            </mesh>
          </AutoUV2Ignore>

          <mesh position={[0, 0, 0]} castShadow receiveShadow>
            <circleBufferGeometry attach="geometry" args={[2, 4]} />
            <meshLambertMaterial attach="material" color="#c0c0c0" />
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
