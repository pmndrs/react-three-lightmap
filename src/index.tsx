/**
 *
 * Hi! This file can run inside CodeSandbox or a similar live-editing environment.
 * For local development, try the storybook files under src/stories.
 *
 */

import React from 'react';
import ReactDOM from 'react-dom';
import { Canvas, useLoader } from 'react-three-fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

import Lightmap from './core/Lightmap';
import Spinner from './stories/Spinner';

import './stories/viewport.css';

/**
 * Try changing this!
 */
const DISPLAY_TEXT = 'Light!';

const Scene: React.FC = () => {
  const font = useLoader(
    THREE.FontLoader,
    'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/fonts/helvetiker_regular.typeface.json'
  );

  return (
    <Lightmap>
      <mesh position={[0, 0, -0.1]} receiveShadow>
        <planeBufferGeometry attach="geometry" args={[9, 5]} />
        <meshLambertMaterial attach="material" color="#ffffff" />
      </mesh>

      <mesh position={[-3.2, -0.8, 0]} castShadow receiveShadow>
        <textBufferGeometry
          attach="geometry"
          args={[
            DISPLAY_TEXT,
            {
              font,
              size: 2,
              height: 1.5,
              curveSegments: 1
            }
          ]}
        />
        <meshLambertMaterial attach="material" color="#ffe020" />
      </mesh>

      <directionalLight intensity={1.5} position={[-2, 2, 4]} castShadow />
    </Lightmap>
  );
};

ReactDOM.render(
  <Canvas
    colorManagement={false} // @todo reconsider
    camera={{ position: [-2, -4, 6], up: [0, 0, 1] }}
    shadowMap
    onCreated={({ gl }) => {
      gl.toneMapping = THREE.ACESFilmicToneMapping;
      gl.toneMappingExposure = 0.9;

      gl.outputEncoding = THREE.sRGBEncoding;
    }}
  >
    <React.Suspense fallback={<Spinner />}>
      <Scene />
    </React.Suspense>

    <OrbitControls
      enableDamping
      dampingFactor={0.1}
      rotateSpeed={0.5}
      target={new THREE.Vector3(0, 0, 1)}
    />
  </Canvas>,
  document.getElementById('root')
);
