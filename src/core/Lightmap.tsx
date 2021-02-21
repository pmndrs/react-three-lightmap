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

const DEFAULT_LIGHTMAP_SIZE = 64;

export interface LightmapProps {
  lightMapSize?: number | [number, number];
  textureFilter?: THREE.TextureFilter;
  autoUV2?: boolean;
  texelsPerUnit?: number;
}

const LocalSuspender: React.FC = () => {
  // always suspend
  const completionPromise = useMemo(() => new Promise(() => undefined), []);
  throw completionPromise;
};

const Lightmap = React.forwardRef<
  THREE.Scene,
  React.PropsWithChildren<LightmapProps>
>(
  (
    { lightMapSize, textureFilter, autoUV2, texelsPerUnit, children },
    sceneRef
  ) => {
    // parse the convenience setting
    const [[lightMapWidth, lightMapHeight]] = useState(() =>
      lightMapSize
        ? [
            typeof lightMapSize === 'number' ? lightMapSize : lightMapSize[0],
            typeof lightMapSize === 'number' ? lightMapSize : lightMapSize[1]
          ]
        : [DEFAULT_LIGHTMAP_SIZE, DEFAULT_LIGHTMAP_SIZE]
    );

    const [isComplete, setIsComplete] = useState(false);

    return (
      <IrradianceCompositor
        lightMapWidth={lightMapWidth}
        lightMapHeight={lightMapHeight}
        textureFilter={textureFilter}
      >
        <IrradianceSceneManager
          texelsPerUnit={autoUV2 ? texelsPerUnit || 2 : undefined}
        >
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
  }
);

export default Lightmap;
