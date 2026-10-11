import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { packProjectAvatar } from '../packages/runtime/src/format/project-archive';
import { readAvatarFolder } from '../tools/avatar-files.mjs';

const fromHere = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const base = '/mesh-avatar-studio/';
const avatarFile = 'miko.mavatar';

function sampleAvatar(): Plugin {
  const pack = () => packProjectAvatar(
    paths => readAvatarFolder(fromHere('../samples/miko-qipao'), paths),
    { name: 'Miko', includeSource: false },
  );

  return {
    name: 'site-sample-avatar',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== `${base}${avatarFile}`) return next();
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.writeHead(405, { Allow: 'GET, HEAD' });
          response.end();
          return;
        }
        void pack().then(bytes => {
          response.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': bytes.byteLength,
            'Cache-Control': 'no-store',
          });
          response.end(request.method === 'HEAD' ? undefined : bytes);
        }).catch(next);
      });
    },
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: avatarFile, source: await pack() });
    },
  };
}

// Retain the license of the archive library bundled into the browser script.
const require = createRequire(import.meta.url);
const fflateLicense = readFileSync(join(dirname(require.resolve('fflate/package.json')), 'LICENSE'), 'utf8');

export default defineConfig({
  root: fromHere('./'),
  base,
  publicDir: false,
  plugins: [sampleAvatar()],
  resolve: { alias: { 'mesh-avatar': fromHere('../packages/runtime/src/index.ts') } },
  server: {
    host: '127.0.0.1',
    fs: {
      // Only the packed avatar is served; raw sample and private project files stay local.
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/samples/**', '**/projects/**', '**/work/**', '**/_plan/**', '**/reference/**'],
    },
  },
  preview: { host: '127.0.0.1' },
  esbuild: { legalComments: 'inline' },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        en: fromHere('./index.html'),
        ...(existsSync(fromHere('./ja/index.html')) ? { ja: fromHere('./ja/index.html') } : {}),
      },
      output: { banner: `/*! fflate\n${fflateLicense}\n*/` },
    },
  },
});
