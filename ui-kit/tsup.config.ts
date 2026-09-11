import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', styles: 'src/styles.css' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: false,
});
