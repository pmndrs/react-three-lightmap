import React, {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef
} from 'react';
import * as THREE from 'three';

import {
  useIrradianceTexture,
  useIrradianceMapSize
} from './IrradianceCompositor';
import IrradianceAtlasMapper, {
  Workbench,
  AtlasMap
} from './IrradianceAtlasMapper';
import { computeAutoUV2Layout } from './AutoUV2';

export const IrradianceDebugContext = React.createContext<{
  atlasTexture: THREE.Texture;
} | null>(null);

const IrradianceSceneManager: React.FC<{
  texelsPerUnit?: number;
  children: (
    workbench: Workbench | null,
    startWorkbench: (scene: THREE.Scene) => void
  ) => React.ReactNode;
}> = ({ texelsPerUnit, children }) => {
  const texelsPerUnitRef = useRef(texelsPerUnit); // read only once

  const lightMap = useIrradianceTexture();
  const [lightMapWidth, lightMapHeight] = useIrradianceMapSize();

  // read once
  const lightMapWidthRef = useRef(lightMapWidth);
  const lightMapHeightRef = useRef(lightMapHeight);

  // basic snapshot triggered by start handler
  const [workbenchBasics, setWorkbenchBasics] = useState<{
    id: number; // for refresh
    scene: THREE.Scene;
  } | null>(null);

  const startHandler = useCallback((scene: THREE.Scene) => {
    // save a snapshot copy of staging data
    setWorkbenchBasics((prev) => ({
      id: prev ? prev.id + 1 : 1,
      scene
    }));
  }, []);

  // auto-UV step
  const [autoUV2Complete, setAutoUV2Complete] = useState(false);
  useEffect(() => {
    if (!workbenchBasics) {
      return;
    }

    const { scene } = workbenchBasics;

    // always clear on any change to workbench
    setAutoUV2Complete(false);

    // perform UV auto-layout in next tick
    const timeoutId = setTimeout(() => {
      if (texelsPerUnitRef.current) {
        computeAutoUV2Layout(
          lightMapWidthRef.current,
          lightMapHeightRef.current,
          scene,
          {
            texelsPerUnit: texelsPerUnitRef.current
          }
        );
      }

      // mark as done
      setAutoUV2Complete(true);
    }, 0);

    // always clean up timeout
    return () => clearTimeout(timeoutId);
  }, [workbenchBasics]);

  // full workbench with atlas map
  const [workbench, setWorkbench] = useState<Workbench | null>(null);

  const atlasMapHandler = useCallback(
    (atlasMap: AtlasMap) => {
      if (!workbenchBasics) {
        throw new Error('unexpected early call');
      }

      // save final copy of workbench
      setWorkbench({
        id: workbenchBasics.id,
        lightScene: workbenchBasics.scene,
        atlasMap
      });
    },
    [workbenchBasics]
  );

  const debugInfo = useMemo(
    () => (workbench ? { atlasTexture: workbench.atlasMap.texture } : null),
    [workbench]
  );

  return (
    <IrradianceDebugContext.Provider value={debugInfo}>
      {children(workbench, startHandler)}

      {workbenchBasics && autoUV2Complete && (
        <IrradianceAtlasMapper
          key={workbenchBasics.id} // re-create for new workbench
          width={lightMapWidthRef.current} // read from initial snapshot
          height={lightMapHeightRef.current} // read from initial snapshot
          lightMap={lightMap}
          lightScene={workbenchBasics.scene}
          onComplete={atlasMapHandler}
        />
      )}
    </IrradianceDebugContext.Provider>
  );
};

export default IrradianceSceneManager;
