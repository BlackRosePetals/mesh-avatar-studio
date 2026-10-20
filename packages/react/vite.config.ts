import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  plugins: [{
    name: 'client-directive',
    enforce: 'pre',
    transform(code, id) {
      // Rollup discards module directives with a noisy warning; output.banner restores it in the bundle.
      // Spaces keep the original column positions.
      if (id === fileURLToPath(new URL('./src/index.tsx', import.meta.url))) {
        return { code: code.replace(/^'use client';/, '             '), map: null };
      }
    },
  }],
  build: {
    target: 'es2022',
    lib: { entry: fileURLToPath(new URL('./src/index.tsx', import.meta.url)), formats: ['es'], fileName: () => 'index.js' },
    rollupOptions: {
      external: ['react', 'react/jsx-runtime', 'mesh-avatar-element', 'mesh-avatar'],
      output: { banner: "'use client';" },
    },
  },
});
