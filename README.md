# @react-three/lightmap

**In-browser lightmap and ambient occlusion (AO map) baker for react-three-fiber and ThreeJS.**

![example screenshot of lightmap baker output](./react-three-lightmap-example.png)

Example:

```jsx
<Lightmap>
  <mesh position={[0, 0, 0]} castShadow receiveShadow>
    <boxBufferGeometry attach="geometry" args={[3, 3, 1]} />
    <meshStandardMaterial attach="material" color="#ff6080" />
  </mesh>

  <mesh position={[0, 0, 1.8]} castShadow receiveShadow>
    <boxBufferGeometry attach="geometry" args={[2, 2, 2]} />
    <meshStandardMaterial attach="material" color="#4080ff" />
  </mesh>
</Lightmap>
```

**[Try it in this editable sandbox](https://codesandbox.io/s/github/pmndrs/react-three-lightmap/tree/v0.0.8/demo-sandbox)**.

NOTE: if you are using `mode="legacy"` on your `<Canvas>` tag please add `legacySuspense` flag to the lightmap, otherwise it will not wait until your scene content is fully loaded. This is not an issue in most situations, unless you have explicitly set the mode prop on `<Canvas>`.

## Local Development

```sh
git clone git@github.com:pmndrs/react-three-lightmap.git
cd react-three-lightmap
yarn
yarn storybook
```

## Wishlist

- onComplete callback
- proper denoising, calibrate the light sampler
- much more optimization
- composited multi-layer lightmap based on several distinct groups of light sources
  - e.g. for individual flickering lights, neon signs, etc
- rudimentary light probe support for dynamic meshes/sprites
  - can start with just omnidirectional total amounts collected in 2D grid textures
  - might want the light probe pattern to be customizable
- bake-only lights (turned off after bake)
  - useful for game levels - e.g. could have hundreds of lights baked in and then discarded
  - currently the lightmap is indirect-only, so this needs an extra step to sample direct light contribution
- saving/loading the generated lightmap texture (useful for game levels)

## Notes

Based on [original experimental implementation](https://github.com/unframework/threejs-lightmap-baker) by [@unframework](https://github.com/unframework).
