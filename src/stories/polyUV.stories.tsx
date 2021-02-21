import React from 'react';
import { Story, Meta } from '@storybook/react';
import { Canvas } from 'react-three-fiber';
import * as THREE from 'three';

import Lightmap from '../core/Lightmap';
import Spinner from './Spinner';
import DebugControls from './DebugControls';
import { DebugOverlayRenderer, DebugOverlayWidgets } from './DebugOverlayScene';

import './viewport.css';

export default {
  title: 'Cylinder scene (polygon UV)'
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
        <Lightmap autoUV2 texelsPerUnit={4}>
          <mesh position={[0, 0, -2]} receiveShadow>
            <planeBufferGeometry attach="geometry" args={[20, 20]} />
            <meshLambertMaterial attach="material" color="#ffffff" />
          </mesh>

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

    <DebugControls />
  </Canvas>
);
