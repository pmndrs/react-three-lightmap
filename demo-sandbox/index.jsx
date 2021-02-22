/**
 *
 * Hi! This file can run inside CodeSandbox or a similar live-editing environment.
 * For local development, try the storybook files under src/stories.
 *
 */

import React from 'react';
import ReactDOM from 'react-dom';
import { Canvas, useLoader, useResource, useFrame } from 'react-three-fiber';
import { OrbitControls } from '@react-three/drei';
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

const Spinner = () => {
  const meshRef = useResource();

  useFrame(({ clock }) => {
    // @todo meshRef.current can be undefined on unmount, fix upstream
    if (meshRef.current && meshRef.current.rotation.isEuler) {
      meshRef.current.rotation.x = Math.sin(clock.elapsedTime * 0.2);
      meshRef.current.rotation.y = Math.sin(clock.elapsedTime * 0.5);
      meshRef.current.rotation.z = Math.sin(clock.elapsedTime);

      const initialZoom = Math.sin(Math.min(clock.elapsedTime, Math.PI / 2));
      meshRef.current.scale.x = meshRef.current.scale.y = meshRef.current.scale.z =
        (1 + 0.2 * Math.sin(clock.elapsedTime * 1.5)) * initialZoom;
    }
  });

  return (
    <group>
      <pointLight position={[-4, 4, 8]} />

      <mesh ref={meshRef}>
        <dodecahedronGeometry args={[2]} />
        <meshLambertMaterial color="#808080" />
      </mesh>
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
