import React, { useState, useMemo, useEffect, useContext, useRef } from 'react';
import { useFrame } from 'react-three-fiber';
import * as THREE from 'three';

const IrradianceRendererContext = React.createContext<{
  width: number;
  height: number;

  baseTexture: THREE.Texture;
  baseArray: Float32Array;
} | null>(null);

export function useIrradianceMapSize(): [number, number] {
  const ctx = useContext(IrradianceRendererContext);
  if (!ctx) {
    throw new Error('must be placed under irradiance texture compositor');
  }

  return [ctx.width, ctx.height];
}

export function useIrradianceRendererData(): [THREE.Texture, Float32Array] {
  const ctx = useContext(IrradianceRendererContext);
  if (!ctx) {
    throw new Error('must be placed under irradiance texture compositor');
  }

  const result = useMemo<[THREE.Texture, Float32Array]>(() => {
    return [ctx.baseTexture, ctx.baseArray];
  }, [ctx]);

  return result;
}

const IrradianceTextureContext = React.createContext<THREE.Texture | null>(
  null
);

export function useIrradianceTexture(): THREE.Texture {
  const texture = useContext(IrradianceTextureContext);

  if (!texture) {
    throw new Error('must be placed under irradiance texture compositor');
  }

  return texture;
}

const LIGHTMAP_BG_COLOR = new THREE.Color('#000000'); // blank must be all zeroes (as one would expect)

const tmpPrevClearColor = new THREE.Color();

function createRendererTexture(
  atlasWidth: number,
  atlasHeight: number,
  textureFilter: THREE.TextureFilter
): [THREE.Texture, Float32Array] {
  const atlasSize = atlasWidth * atlasHeight;
  const data = new Float32Array(4 * atlasSize);

  // not filling texture with test pattern because this goes right into light probe computation
  const texture = new THREE.DataTexture(
    data,
    atlasWidth,
    atlasHeight,
    THREE.RGBAFormat,
    THREE.FloatType
  );

  // set desired texture filter (no mipmaps supported due to the nature of lightmaps)
  texture.magFilter = textureFilter;
  texture.minFilter = textureFilter;
  texture.generateMipmaps = false;

  return [texture, data];
}

const CompositorLayerMaterial: React.FC<{
  map: THREE.Texture;
  materialRef: React.MutableRefObject<THREE.ShaderMaterial | null>;
}> = ({ map, materialRef }) => {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          map: { value: null },
          multiplier: { value: 0 }
        },

        vertexShader: `
          varying vec2 vUV;

          void main() {
            vUV = uv;

            vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
          }
        `,
        fragmentShader: `
          uniform sampler2D map;
          uniform float multiplier;
          varying vec2 vUV;

          void main() {
            gl_FragColor = vec4(texture2D(map, vUV).rgb * multiplier, 1.0);
          }
        `,

        blending: THREE.AdditiveBlending
      }),
    []
  );

  // disposable managed object
  return (
    <primitive
      object={material}
      attach="material"
      uniforms-map-value={map}
      ref={materialRef}
    />
  );
};

export type LightMapConsumerChild = (
  outputLightMap: THREE.Texture
) => React.ReactNode;

// this is called a "compositor" but for now it is a simple "provider"
// (there used to be support for mixing several several lightmaps together dynamically,
// taken out temporarily as an esoteric feature)
export default function IrradianceCompositor({
  lightMapWidth,
  lightMapHeight,
  textureFilter,
  children
}: React.PropsWithChildren<{
  lightMapWidth: number;
  lightMapHeight: number;
  textureFilter?: THREE.TextureFilter;
  children: LightMapConsumerChild | React.ReactNode;
}>): React.ReactElement {
  // read value only on first render
  const widthRef = useRef(lightMapWidth);
  const heightRef = useRef(lightMapHeight);
  const textureFilterRef = useRef(textureFilter);

  const orthoSceneRef = useRef<THREE.Scene>();

  // incoming base rendered texture (filled elsewhere)
  const [baseTexture, baseArray] = useMemo(
    () =>
      createRendererTexture(
        widthRef.current,
        heightRef.current,
        textureFilterRef.current || THREE.LinearFilter
      ),
    []
  );
  useEffect(
    () => () => {
      baseTexture.dispose();
    },
    [baseTexture]
  );

  // info for renderer instances
  const rendererDataCtx = useMemo(
    () => ({
      width: widthRef.current,
      height: heightRef.current,
      baseTexture,
      baseArray
    }),
    [baseTexture, baseArray]
  );

  return (
    <IrradianceRendererContext.Provider value={rendererDataCtx}>
      <IrradianceTextureContext.Provider value={baseTexture}>
        {typeof children === 'function'
          ? (children as LightMapConsumerChild)(baseTexture) // @todo this is unused
          : children}
      </IrradianceTextureContext.Provider>
    </IrradianceRendererContext.Provider>
  );
}
