/*
 * Copyright (c) 2021-now Nick Matantsev
 * Licensed under the MIT license
 */

import React, { useState, useMemo, useContext } from 'react';
import * as THREE from 'three';

import { AUTO_UV2_OPT_OUT_FLAG } from './AutoUV2';
import { ATLAS_OPT_OUT_FLAG } from './IrradianceAtlasMapper';
import IrradianceSceneManager from './IrradianceSceneManager';
import WorkManager from './WorkManager';
import IrradianceRenderer from './IrradianceRenderer';
import IrradianceScene from './IrradianceScene';
import { LightProbeSettings, DEFAULT_LIGHT_PROBE_SETTINGS } from './lightProbe';

// prevent automatic generation of UV2 coordinates for content
// (but still allow contribution to lightmap, for e.g. emissive objects, large occluders, etc)
export const AutoUV2Ignore: React.FC = ({ children }) => {
  return (
    <group
      name="Auto-UV2 opt out wrapper"
      userData={{
        [AUTO_UV2_OPT_OUT_FLAG]: true
      }}
    >
      {children}
    </group>
  );
};

// if there is no context provider, default to "not in progress"
const LightmapProgressContext = React.createContext(false);

// prevent wrapped content from affecting the lightmap
export const LightmapIgnore: React.FC = ({ children }) => {
  const inProgress = useContext(LightmapProgressContext);

  return (
    <group
      name="Lightmap opt out wrapper"
      visible={!inProgress} // hide during baking so that this content does not contribute to irradiance
      userData={{
        [AUTO_UV2_OPT_OUT_FLAG]: true, // no need for auto-UV2 if ignored during baking
        [ATLAS_OPT_OUT_FLAG]: true // no point in including this in atlas
      }}
    >
      {children}
    </group>
  );
};

// avoid using "light probe" name externally, to avoid confusion with light probe grid tech
export type SamplerSettings = Partial<LightProbeSettings>;

export interface LightmapProps {
  ao?: boolean;
  aoDistance?: number;
  emissiveMultiplier?: number;
  lightMapSize?: number | [number, number];
  textureFilter?: THREE.TextureFilter;
  texelsPerUnit?: number;
  samplerSettings?: SamplerSettings;
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
    {
      ao: aoMode,
      aoDistance,
      emissiveMultiplier,
      lightMapSize,
      textureFilter,
      texelsPerUnit,
      samplerSettings,
      children
    },
    sceneRef
  ) => {
    // parse the convenience setting
    const [[initialWidth, initialHeight]] = useState(() =>
      lightMapSize
        ? [
            typeof lightMapSize === 'number' ? lightMapSize : lightMapSize[0],
            typeof lightMapSize === 'number' ? lightMapSize : lightMapSize[1]
          ]
        : [undefined, undefined]
    );

    const [isComplete, setIsComplete] = useState(false);

    return (
      <>
        <IrradianceSceneManager
          aoMode={!!aoMode}
          aoDistance={aoDistance}
          emissiveMultiplier={emissiveMultiplier}
          initialWidth={initialWidth}
          initialHeight={initialHeight}
          textureFilter={textureFilter}
          texelsPerUnit={texelsPerUnit}
          settings={{
            ...DEFAULT_LIGHT_PROBE_SETTINGS,
            ...samplerSettings
          }}
        >
          {(workbench, startWorkbench) => (
            <LightmapProgressContext.Provider value={!isComplete}>
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
            </LightmapProgressContext.Provider>
          )}
        </IrradianceSceneManager>

        {!isComplete && <LocalSuspender />}
      </>
    );
  }
);

export default Lightmap;
