import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve, relative, dirname } from 'node:path';

export const VARIANTS = ['eyes_closed', 'eyes_half', 'eyes_smile', 'eyes_sad', 'eyes_surprise', 'mouth_a', 'mouth_a_half', 'mouth_i', 'mouth_o', 'mouth_angry', 'mouth_sad'] as const;
export type Tool = 'build-layers' | 'variant-requests' | 'build-sprites';
export class JobError extends Error {
  constructor(public code: 'dependencies' | 'toolFailed' | 'unsafeFiles', public log: string) { super(code); }
}
export type Runner = (root: string, project: string, tool: Tool) => Promise<string>;
export const runTool: Runner = (root, project, tool) => new Promise((done, reject) => {
  const args = ['run', '--no-project', '--no-python-downloads', '--python', '>=3.10', '--with', 'numpy', '--with', 'pillow', '--with', 'opencv-python-headless', resolve(root, `tools/${tool}.py`), project];
  execFile('uv', args, { cwd: root, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
    const log = `${stdout}\n${stderr}`.replaceAll(root, '<repo>').replaceAll(homedir(), '~').trim().slice(-12000);
    if (!error) { done(log); return; }
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT' || /No interpreter found|No Python installation|Python interpreter not found/i.test(log);
    reject(new JobError(missing ? 'dependencies' : 'toolFailed', log || (missing ? 'uv is not installed.' : 'The local tool did not finish.')));
  });
});

// Python tools read and write several nested paths. Reject redirected entries before
// copying their inputs, then run in an isolated directory under projects/.
async function copyTree(source: string, target: string) {
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new JobError('unsafeFiles', 'Project files must not be symbolic links.');
  if (info.isDirectory()) {
    await mkdir(target, { recursive: true });
    for (const entry of await readdir(source)) await copyTree(join(source, entry), join(target, entry));
  } else if (info.isFile()) await copyFile(source, target);
  else throw new JobError('unsafeFiles', 'Unsupported project file.');
}
async function exists(path: string) { try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }
async function safeTree(path: string) {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new JobError('unsafeFiles', 'Project files must not be symbolic links.');
  if (info.isDirectory()) for (const entry of await readdir(path)) await safeTree(join(path, entry));
}
function wait(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }
// The dev server's file watcher holds directory handles under projects/. On Windows
// that denies rename() on a directory it has open (EPERM/EBUSY), even though the same
// rename succeeds once the watcher lets go moments later. Retry a few times first,
// then fall back to copy+remove - the same workaround other file-watching tools use
// for AV/watcher-locked paths on Windows - instead of failing the whole publish.
export async function renameResilient(from: string, to: string) {
  for (let attempt = 1; ; attempt++) {
    try { await rename(from, to); return; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EBUSY') throw error;
      if (attempt >= 5) { await copyTree(from, to); await rm(from, { recursive: true, force: true }); return; }
      await wait(attempt * 20);
    }
  }
}
async function publish(project: string, stage: string, names: string[]) {
  // Validate all targets before moving anything. Keep old directories until all
  // replacements succeed, and roll back on an I/O error.
  for (const name of names) if (await exists(join(project, name))) await safeTree(join(project, name));
  const moved: { name: string; hadPrevious: boolean; installed: boolean }[] = [];
  try {
    for (const name of names) {
      const target = join(project, name), previous = join(stage, `previous-${name}`);
      const item = { name, hadPrevious: await exists(target), installed: false }; moved.push(item);
      if (item.hadPrevious) await renameResilient(target, previous);
      await renameResilient(join(stage, name), target); item.installed = true;
    }
  } catch (error) {
    for (const item of moved.reverse()) {
      if (item.installed) await rm(join(project, item.name), { recursive: true, force: true });
      if (item.hadPrevious && await exists(join(stage, `previous-${item.name}`))) await renameResilient(join(stage, `previous-${item.name}`), join(project, item.name));
    }
    throw error;
  }
}
export interface VariantInput { name: string; data: string }
export function decodeVariants(value: unknown): { name: string; bytes: Buffer }[] {
  const files = (value as { files?: VariantInput[] })?.files;
  if (!Array.isArray(files) || !files.length || files.length > VARIANTS.length) throw new Error(`Choose one to ${VARIANTS.length} named PNG files.`);
  const names = new Set<string>();
  return files.map(file => {
    if (!file || !VARIANTS.some(name => file.name === `${name}.png`) || names.has(file.name) || typeof file.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.data)) throw new Error('Use the variant filenames and PNG images.');
    names.add(file.name);
    const bytes = Buffer.from(file.data, 'base64');
    if (bytes.length > 24 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Use PNG images smaller than 24 MB each.');
    return { name: file.name, bytes };
  });
}
export async function variantState(project: string) {
  let layers: Record<string, unknown> = {};
  try { layers = JSON.parse(await readFile(join(project, 'built/sprites/sprites.json'), 'utf8')).layers ?? {}; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return VARIANTS.map(name => ({ name, present: name.startsWith('eyes_') ? `${name}_0` in layers && `${name}_1` in layers : name in layers }));
}
export async function projectJob(root: string, project: string, tool: Tool, files: ReturnType<typeof decodeVariants> = [], runner = runTool) {
  const checkFolder = async () => {
    const base = resolve(root, 'projects');
    if (dirname(project) !== base || await realpath(base) !== base || await realpath(project) !== project) throw new JobError('unsafeFiles', 'The project must be a regular folder inside projects/.');
  };
  await checkFolder();
  const stage = await mkdtemp(join(resolve(root, 'projects'), '.studio-job-'));
  try {
    for (const name of ['source.png', 'rig.json', 'built', 'variants', 'variant-requests', 'variant-masks']) {
      const source = join(project, name);
      if (await exists(source)) await copyTree(source, join(stage, name));
    }
    if (files.length) {
      await mkdir(join(stage, 'variants'), { recursive: true });
      for (const file of files) await writeFile(join(stage, 'variants', file.name), file.bytes);
    }
    const log = await runner(root, stage, tool);
    await checkFolder();
    if (tool === 'build-layers') await publish(project, stage, ['built', 'rig.json']);
    if (tool === 'variant-requests') await publish(project, stage, ['variant-requests']);
    if (tool === 'build-sprites') await publish(project, stage, ['variants', 'built']);
    return { log, path: relative(root, project).split('\\').join('/') };
  } finally { await rm(stage, { recursive: true, force: true }); }
}
