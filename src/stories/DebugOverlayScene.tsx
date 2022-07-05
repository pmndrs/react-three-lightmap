import React, { useMemo, useContext, useRef } from 'react';
import { useFrame, useThree, createPortal } from '@react-three/fiber';
import * as THREE from 'three';

import { DebugContext } from '../core/Lightmap';

const DebugOverlayContext = React.createContext<THREE.Scene | null>(null);

// set up a special render loop with a debug overlay for various widgets (see below)
export const DebugOverlayRenderer: React.FC<{ children: React.ReactNode }> = ({
  children
}) => {
  const mainSceneRef = useRef<THREE.Scene>();
  const debugSceneRef = useRef<THREE.Scene>();

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
      <DebugOverlayContext.Provider value={debugSceneRef.current || null}>
        <scene name="Main Debug Stage" ref={mainSceneRef}>
          {children}
        </scene>
      </DebugOverlayContext.Provider>

      {/* portal container for debug widgets */}
      <scene name="Debug Overlay" ref={debugSceneRef} />
    </>
  );
};

// show provided textures as widgets on debug overlay (via createPortal)
export const DebugOverlayWidgets: React.FC = React.memo(() => {
  const debugScene = useContext(DebugOverlayContext);
  const debugInfo = useContext(DebugContext);

  if (!debugScene || !debugInfo) {
    return null;
  }

  const { atlasTexture, outputTexture } = debugInfo;

  return (
    <>
      {createPortal(
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
        </>,
        debugScene
      )}
    </>
  );
});
