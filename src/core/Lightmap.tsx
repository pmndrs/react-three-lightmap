/*
 * Copyright (c) 2021-now Nick Matantsev
 * Licensed under the MIT license
 */

import React, { useState, useMemo } from 'react';
import * as THREE from 'three';

import IrradianceSceneManager from './IrradianceSceneManager';
import WorkManager from './WorkManager';
import IrradianceRenderer from './IrradianceRenderer';
import IrradianceCompositor from './IrradianceCompositor';
import IrradianceScene from './IrradianceScene';

export interface LightmapProps {
  lightMapWidth: number;
  lightMapHeight: number;
  textureFilter?: THREE.TextureFilter;
}

const LocalSuspender: React.FC = () => {
  // always suspend
  const completionPromise = useMemo(() => new Promise(() => undefined), []);
  throw completionPromise;
};

const Lightmap = React.forwardRef<
  THREE.Scene,
  React.PropsWithChildren<LightmapProps>
>(({ lightMapWidth, lightMapHeight, textureFilter, children }, sceneRef) => {
  const [isComplete, setIsComplete] = useState(false);

  return (
    <IrradianceCompositor
      lightMapWidth={lightMapWidth}
      lightMapHeight={lightMapHeight}
      textureFilter={textureFilter}
    >
      <IrradianceSceneManager>
        {(workbench, startWorkbench) => (
          <>
            <WorkManager>
              {workbench && !isComplete && (
                <IrradianceRenderer
                  workbench={workbench}
                  onComplete={() => {
                    setIsComplete(true);
                  }}
                />
              )}
            </WorkManager>

            <IrradianceScene ref={sceneRef} onReady={startWorkbench}>
              {children}
            </IrradianceScene>
          </>
        )}
      </IrradianceSceneManager>

      {!isComplete && <LocalSuspender />}
    </IrradianceCompositor>
  );
});

export default Lightmap;
