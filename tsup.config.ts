import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs', 'iife'],
  globalName: 'TraceKit',
  dts: true,
  clean: true,
  minify: true,
  sourcemap: true,
  target: 'es2020',
  platform: 'browser',
});
