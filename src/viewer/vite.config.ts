import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// Viewer is a standalone Vite project that bundles into dist/public,
// which is what the MCP preview server (src/server/preview/preview-server.ts) serves
// at runtime. Run `npm run build:viewer` to produce the bundle.
export default defineConfig(({ mode }) => ({
  root: here,
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(here, 'src'),
    },
  },
  build: {
    outDir: resolve(here, '../../dist/public'),
    emptyOutDir: true,
    target: 'es2022',
    // Source maps double the published tarball; only emit them in
    // dev/staging builds where you actually open the browser devtools
    // pointing at this build. Production publishes ship without them.
    sourcemap: mode !== 'production',
    rollupOptions: {
      output: {
        // VIE-4: split the bundle so the browser can cache each
        // dependency tree independently of the application code.
        // Without this, a one-line change to viewer.ts re-downloads
        // the entire 870KB blob; with it, only the small `app` chunk
        // changes while the (much larger) vendor chunks reuse their
        // existing immutable cache entries served by VIE-4 in
        // preview-server.
        manualChunks(id: string): string | undefined {
          if (!id.includes('node_modules')) {
            return undefined;
          }
          // three.js extras (OrbitControls, exporters, BVH helpers...)
          // weigh ~150KB and almost never change between releases —
          // pin them in their own chunk.
          if (id.includes('three/examples') || id.includes('three-mesh-bvh')) {
            return 'three-extras';
          }
          if (id.includes('node_modules/three/')) {
            return 'three';
          }
          if (id.includes('react-dom') || id.includes('react/jsx-runtime')) {
            return 'react';
          }
          if (id.includes('node_modules/react/')) {
            return 'react';
          }
          if (id.includes('@radix-ui')) {
            return 'radix';
          }
          // Leave everything else (lucide, fflate, jscadui, tailwind
          // runtime helpers...) to share Vite's default vendor chunk.
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    // In dev, run the MCP preview server in another terminal (default
    // port 3737) and Vite proxies the WebSocket feed to it. This gives
    // you HMR while still receiving live mesh pushes.
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:3737', ws: true },
    },
  },
}));
