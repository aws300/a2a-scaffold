import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import path from 'path';

/**
 * Vite config for the A2A Scaffold standalone SPA.
 *
 * Build:  npx vite build --config vite.config.scaffold.ts
 * Dev:    npx vite --config vite.config.scaffold.ts --port 5173
 */
export default defineConfig({
  plugins: [solid()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Dev server: proxy A2A requests to Python backend
  server: {
    proxy: {
      '/lf.a2a.v1.': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/.well-known': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
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
