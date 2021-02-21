import React, { useState, useMemo, useCallback, useRef } from 'react';
import * as THREE from 'three';

import {
  useIrradianceTexture,
  useIrradianceMapSize
} from './IrradianceCompositor';
import IrradianceAtlasMapper, {
  Workbench,
  AtlasMap
} from './IrradianceAtlasMapper';

export const IrradianceDebugContext = React.createContext<{
  atlasTexture: THREE.Texture;
} | null>(null);

const IrradianceSceneManager: React.FC<{
  children: (
    workbench: Workbench | null,
    startWorkbench: (scene: THREE.Scene) => void
  ) => React.ReactNode;
}> = ({ children }) => {
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

      {workbenchBasics && (
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
