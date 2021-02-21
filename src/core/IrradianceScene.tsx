import React, { useRef, useMemo, useCallback, useEffect } from 'react';
import * as THREE from 'three';

const FallbackListener: React.FC<{
  onStarted: () => void;
  onFinished: () => void;
}> = ({ onStarted, onFinished }) => {
  const onStartedRef = useRef(onStarted);
  onStartedRef.current = onStarted;
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    onStartedRef.current();

    return () => {
      onFinishedRef.current();
    };
  }, []);

  // re-throw our own suspense promise
  // (no need to ever resolve it because this gets unmounted anyway)
  // NOTE: throwing directly from inside this component prevents useEffect from working,
  // hence the nested suspender stub
  const LocalSuspender = useMemo<React.FC>(() => {
    const promise = new Promise(() => undefined);

    return () => {
      throw promise;
    };
  }, []);
  return <LocalSuspender />;
};

const IrradianceScene = React.forwardRef<
  THREE.Scene | null,
  React.PropsWithChildren<{ onReady: (scene: THREE.Scene) => void }>
>(({ onReady, children }, sceneRef) => {
  // local ref merge
  const localSceneRef = useRef<THREE.Scene>();
  const mergedRefHandler = useCallback((instance: THREE.Scene | null) => {
    localSceneRef.current = instance || undefined;

    if (typeof sceneRef === 'function') {
      sceneRef(instance);
    } else if (sceneRef) {
      sceneRef.current = instance;
    }
  }, []);

  // by default, set up kick-off for next tick
  // (but this is prevented if suspense is thrown from children)
  const initialTimeoutId = useMemo(
    () =>
      setTimeout(() => {
        if (localSceneRef.current) {
          onReady(localSceneRef.current);
        }
      }, 0),
    []
  );

  // wrap scene in an extra group object
  // so that when this is hidden during suspension only the wrapper has visible=false
  return (
    <React.Suspense
      fallback={
        <FallbackListener
          onStarted={() => {
            // prevent default starter logic
            clearTimeout(initialTimeoutId);
          }}
          onFinished={() => {
            // issue kick-off once suspense is resolved
            if (localSceneRef.current) {
              onReady(localSceneRef.current);
            }
          }}
        />
      }
    >
      <group name="Lightmap Scene Suspense Wrapper">
        <scene name="Lightmap Scene" ref={mergedRefHandler}>
          {children}
        </scene>
      </group>
    </React.Suspense>
  );
});

export default IrradianceScene;
