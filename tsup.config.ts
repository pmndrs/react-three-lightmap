import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/entry.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: true,
  target: 'es2017'
});
