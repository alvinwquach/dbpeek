import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli/index.ts', 'src/server/index.ts'],
  format: ['esm'],
  target: 'node18',
  dts: true,
  clean: true,
});
