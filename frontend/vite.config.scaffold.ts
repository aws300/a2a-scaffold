import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import path from 'path';

/**
 * Vite config for building the A2A Scaffold standalone SPA.
 * Usage: npx vite build --config vite.config.scaffold.ts
 */
export default defineConfig({
  plugins: [solid()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    outDir: 'dist/scaffold',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'a2a-scaffold.html'),
      },
    },
  },
});
