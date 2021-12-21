# react-three-lightmap

**In-browser lightmap and ambient occlusion (AO map) baker for react-three-fiber and ThreeJS.**

![example screenshot of lightmap baker output](./react-three-lightmap-example.png)

[See example live editable sandbox](https://codesandbox.io/s/github/pmndrs/react-three-lightmap/tree/main/demo-sandbox).

NOTE: add `mode="legacy"` to your `<Canvas>` tag to enable legacy React suspense mode in r3f, this is a current limitation of the library.

## Local Development

```sh
git clone git@github.com:pmndrs/react-three-lightmap.git
cd react-three-lightmap
yarn
yarn storybook
```

## Notes

Based on [original experimental implementation](https://github.com/unframework/threejs-lightmap-baker) by [@unframework](https://github.com/unframework).
