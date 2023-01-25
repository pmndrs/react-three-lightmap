import React, { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { useLightmapDebug, DebugInfo } from '../core/Lightmap';

// set up a special render loop with a debug overlay for various widgets (see below)
export const DebugOverlayRenderer: React.FC<{ children: React.ReactNode }> = ({
  children
}) => {
  const mainSceneRef = useRef<THREE.Scene>(null);
  const debugSceneRef = useRef<THREE.Scene>(null);

  const [debugInfo, DebugWrapper] = useLightmapDebug();

  const { size } = useThree();
  const debugCamera = useMemo(() => {
    // top-left corner is (0, 100), top-right is (100, 100)
    const aspect = size.height / size.width;
    return new THREE.OrthographicCamera(0, 100, 100, 100 * (1 - aspect), -1, 1);
  }, [size]);

  useFrame(({ gl, camera }) => {
    gl.render(mainSceneRef.current!, camera);
  }, 20);

  useFrame(({ gl }) => {
    gl.autoClear = false;
    gl.clearDepth();
    gl.render(debugSceneRef.current!, debugCamera);
    gl.autoClear = true;
  }, 30);

  return (
    <>
      <DebugWrapper>
        <scene name="Main Debug Stage" ref={mainSceneRef}>
          {children}
        </scene>
      </DebugWrapper>

      {/* portal container for debug widgets */}
      <scene name="Debug Overlay" ref={debugSceneRef}>
        {debugInfo ? (
          <DebugOverlayInternalWidgets debugInfo={debugInfo} />
        ) : null}
      </scene>
    </>
  );
};

// show provided textures as widgets on debug overlay
const DebugOverlayInternalWidgets: React.FC<{ debugInfo: DebugInfo }> =
  React.memo(({ debugInfo }) => {
    const { atlasTexture, outputTexture } = debugInfo;

    return (
      <>
        {outputTexture && (
          <mesh position={[85, 85, 0]}>
            <planeBufferGeometry attach="geometry" args={[20, 20]} />
            <meshBasicMaterial
              attach="material"
              map={outputTexture}
              toneMapped={false}
            />
          </mesh>
        )}

        {atlasTexture && (
          <mesh position={[85, 64, 0]}>
            <planeBufferGeometry attach="geometry" args={[20, 20]} />
            <meshBasicMaterial
              attach="material"
              map={atlasTexture}
              toneMapped={false}
            />
          </mesh>
        )}
      </>
    );
  });
