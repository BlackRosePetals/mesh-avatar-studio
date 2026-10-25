import { writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { seededRandom } from '../../tools/motion-scenarios.mjs';
import { capture } from './capture-renderer.mjs';

const actions = [
  [0, 'setAutoIdle', true], [0, 'setAutoMotion', true], [60, 'play', 'nod'], [120, 'setSpeaking', true],
  [180, 'setEmotion', 'happy'], [240, 'setExpression', 'sad'],
  [300, 'speakKana', 'こんにちは。きゃっほー！', { loop: true }],
  [360, 'setParameters', { angleX: -12, eyeLOpen: 0.5, mouthOpen: 0.8, mouthForm: -1 }, 0.6],
  [420, 'setLipSync', { granularity: 0.2, openness: 0.8, closeSpeed: 0.1 }],
  [480, 'holdMouth', 'o'], [540, 'stopLipSync'], [600, 'setExpression', 'neutral'],
  [660, 'setAutoIdle', false], [720, 'setParameters', {}], [780, 'setSpeaking', false],
  [840, 'play', 'doze'], [900, 'setSwayGain', 0.8], [960, 'setEmotion', 'relaxed', { playMotion: false }],
  [1020, 'setExpression', 'wink'], [1080, 'setSpeaking', true], [1140, 'setExpression', 'neutral'],
];

export async function dumpAvatar({ rig, metadata, sprites, images, destination }) {
  const runtime = new URL('../../packages/runtime/src/engine/createMeshAvatar.js', import.meta.url).href;
  const replacement = new URL('./capture-renderer.mjs', import.meta.url).href;
  const hooks = registerHooks({ load(url, context, next) {
    const result = next(url, context);
    if (url === runtime) return { ...result, source: String(result.source).replace(
      "import { createRenderer } from './renderer.js';", `import { createRenderer } from ${JSON.stringify(replacement)};`) };
    return result;
  } });
  const { createMeshAvatarImpl } = await import(runtime);
  hooks.deregister();
  const original = { random: Math.random, fetch: globalThis.fetch, Image: globalThis.Image,
    document: globalThis.document, cancelAnimationFrame: globalThis.cancelAnimationFrame };
  try {
    globalThis.Image = class {
      set src(name) {
        const image = images[name];
        if (!image) { queueMicrotask(() => this.onerror(new Error(`Missing image: ${name}`))); return; }
        this.width = image.width; this.height = image.height; this.data = image.data;
        queueMicrotask(() => this.onload());
      }
    };
    globalThis.document = { createElement() {
      let image;
      return { getContext() { return { drawImage(value) { image = value; }, getImageData() { return { data: image.data }; } }; } };
    } };
    globalThis.cancelAnimationFrame = () => {};
    const variants = [];
    for (const [name, hasSprites, preserveMouthForm] of [['drawn', true, false], ['painted', false, true]]) {
      Math.random = seededRandom(173);
      globalThis.fetch = async name => {
        const value = name === 'layers.json' ? metadata : name === 'sprites/sprites.json' && hasSprites ? sprites : undefined;
        return { ok: value !== undefined, status: value === undefined ? 404 : 200, json: async () => value };
      };
      // Use a distinct JSON asset URL so the real runtime's shared cache cannot carry a sprite
      // sheet into the variant without one. PNGs remain shared and are decoded once.
      const assets = Object.fromEntries(Object.keys(images).map(name => [name, name]));
      assets['layers.json'] = 'layers.json'; assets['sprites/sprites.json'] = hasSprites ? 'sprites/sprites.json' : 'absent-sprites.json';
      const avatar = await createMeshAvatarImpl({}, { rig, assets, manual: true, preserveMouthForm });
      const events = []; avatar.onMotion(id => events.push(id));
      const samples = [], frames = 1200;
      for (let frame = 0; frame < frames; frame++) {
        for (const [at, method, ...args] of actions) if (frame === at) avatar[method](...args);
        const voice = 0.5 + Math.sin(frame * 0.73) * 0.45; avatar.setVoiceLevel(voice);
        const dt = frame === 600 ? 0 : frame === 900 ? 0.08 : 1 / 60, step = Math.min(0.05, dt);
        avatar.advance(step, step === 0 ? 60 : 1 / step);
        if (frame % 60 <= 4 || frame === frames - 1) {
          const snapshot = capture.renderer.snapshot();
          // Static UV/index data is already covered by grids.json; keep it only once per
          // layer in this sequence to avoid writing it on every sampled frame.
          for (const layer of snapshot.layers) { delete layer.uvs; delete layer.indices; }
          samples.push({ frame, dt, voice, parameters: avatar.getParameters(), ...snapshot,
            expression: avatar.getExpression(), lipSync: avatar.getLipSyncState(), events: events.splice(0) });
        }
      }
      const file = `avatar-${name}.json`;
      await writeFile(new URL(file, destination), JSON.stringify({ version: 1, hasSprites, preserveMouthForm, actions, samples }) + '\n');
      variants.push(file); avatar.destroy();
    }
    await writeFile(new URL('avatar.json', destination), JSON.stringify({ version: 1, seed: 173, seconds: 20, files: variants }) + '\n');
    console.log(`Wrote ${variants.length} full Avatar tick sequences from the JS runtime`);
  } finally {
    Math.random = original.random;
    for (const key of ['fetch', 'Image', 'document', 'cancelAnimationFrame']) {
      if (original[key] === undefined) delete globalThis[key]; else globalThis[key] = original[key];
    }
  }
}
