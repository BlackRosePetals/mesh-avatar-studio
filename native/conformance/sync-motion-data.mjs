// Authored keyframes and expression targets shared with the JS runtime.
import { writeFile } from 'node:fs/promises';
import { MOTIONS, IDLE_MOTIONS, ADDITIVE } from '../../packages/runtime/src/engine/motions.js';
import { EXPRESSIONS } from '../../packages/runtime/src/engine/motion.js';
const motions = Object.entries({ ...MOTIONS, ...IDLE_MOTIONS }).map(([id, motion]) => ({
  id, ...motion, idle: motion.idle ?? false, tracks: Object.entries(motion.tracks),
}));
await writeFile(new URL('../crates/mesh-avatar-core/src/engine/motions.json', import.meta.url),
  JSON.stringify({ motions, additive: [...ADDITIVE], expressions: EXPRESSIONS }, null, 2) + '\n');
