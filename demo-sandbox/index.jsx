/**
 *
 * Hi! This file can run inside CodeSandbox or a similar live-editing environment.
 * For local development, try the storybook files under src/stories.
 *
 */

import React, { useRef } from 'react';
import ReactDOM from 'react-dom';
import { Canvas, useLoader, useFrame } from 'react-three-fiber';
import { OrbitControls, Html } from '@react-three/drei';
import { Lightmap } from '@react-three/lightmap';
import * as THREE from 'three';

import './index.css';

/**
 * Try changing this!
 */
const DISPLAY_TEXT = 'Light!';

const Scene = () => {
  const font = useLoader(
    THREE.FontLoader,
    'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/fonts/helvetiker_regular.typeface.json'
  );

  const lightTurntableRef = useRef();
  useFrame(({ clock }) => {
    if (lightTurntableRef.current) {
      lightTurntableRef.current.rotation.y = -clock.elapsedTime * 0.1;
    }
  });

  return (
    <group>
      <mesh position={[0, 0, -0.1]} receiveShadow>
        <planeBufferGeometry attach="geometry" args={[9, 5]} />
        <meshLambertMaterial attach="material" color="#60a0ff" />
      </mesh>

      <mesh position={[-3.2, -0.8, 0]} castShadow>
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
        <meshLambertMaterial attach="material" color="#ff6080" />
      </mesh>

      <group ref={lightTurntableRef} position={[0, 0, 4]}>
        <directionalLight intensity={1.5} position={[-3, 2, 0]} castShadow />
      </group>
      <ambientLight color="#406040" />
    </group>
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
    <React.Suspense fallback={<Html>Loading font...</Html>}>
      <React.Suspense fallback={<Scene />}>
        <Lightmap ao>
          <Scene />
        </Lightmap>
      </React.Suspense>
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
