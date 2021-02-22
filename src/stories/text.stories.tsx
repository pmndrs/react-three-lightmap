import React from 'react';
import { Story, Meta } from '@storybook/react';
import { Canvas } from 'react-three-fiber';
import * as THREE from 'three';

import Lightmap, { AutoUV2Ignore } from '../core/Lightmap';
import Spinner from './Spinner';
import DebugControls from './DebugControls';
import { DebugOverlayRenderer, DebugOverlayWidgets } from './DebugOverlayScene';

import './viewport.css';

import helvetikerFontData from './helvetiker.json';
const helvetikerFont = new THREE.Font(helvetikerFontData);

export default {
  title: 'Text mesh scene'
} as Meta;

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
                  font: helvetikerFont,
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
      </React.Suspense>
    </DebugOverlayRenderer>

    <DebugControls />
  </Canvas>
);
