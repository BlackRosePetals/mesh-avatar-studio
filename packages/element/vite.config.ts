import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const fromHere = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// `vite build` makes dist/index.js, which imports the mesh-avatar package.
// `vite build --mode standalone` makes dist/standalone.js with the runtime inside, for a
// single <script type="module"> from a CDN. The runtime build already carries fflate's
// license notice, and legal comments are kept.
export default defineConfig(({ mode }) => {
  const standalone = mode === 'standalone';
  return {
    publicDir: false,
    esbuild: { legalComments: 'inline' },
    build: {
      target: 'es2022',
      emptyOutDir: !standalone,
      lib: { entry: fromHere('./src/index.ts'), formats: ['es'], fileName: () => standalone ? 'standalone.js' : 'index.js' },
      rollupOptions: standalone ? {} : { external: ['mesh-avatar'] },
    },
  };
});
