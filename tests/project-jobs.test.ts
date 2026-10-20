import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { execFile } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import fixture from '../samples/miko-qipao/rig.json';
import { JobError, projectJob, decodeVariants, runTool, type Runner } from '../src/server/project-jobs';
import { localProjectMiddleware } from '../src/server/local-projects';
vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

let root: string, project: string;
beforeEach(async () => {
  await mkdir(resolve('projects'), { recursive: true });
  root = await mkdtemp(join(resolve('projects'), '.jobs-test-')); project = join(root, 'projects/nova');
  await mkdir(join(project, 'built'), { recursive: true });
  await writeFile(join(project, 'rig.json'), JSON.stringify(fixture));
  await writeFile(join(project, 'source.png'), 'synthetic source');
  await writeFile(join(project, 'built/base.png'), 'old layers');
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
function api(runner: Runner) {
  const handler = localProjectMiddleware(root, vi.fn(async () => undefined), runner);
  return async (url: string, body: unknown = { rig: fixture }, method = 'POST') => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]) as IncomingMessage;
    req.url = url; req.method = method; req.headers = { host: '127.0.0.1:5173', 'content-type': 'application/json' };
    const result = { status: 0, body: '' };
    const res = { writeHead(status: number) { result.status = status; }, end(value: string | Buffer) { result.body = String(value); } } as unknown as ServerResponse;
    await handler(req, res, () => { result.status = 404; }); return result;
  };
}
test('tool jobs run on an isolated project copy and publish only completed layers', async () => {
  const runner: Runner = vi.fn(async (receivedRoot, stage, tool) => {
    expect(receivedRoot).toBe(root); expect(stage.startsWith(join(root, 'projects/.studio-job-'))).toBe(true);
    expect(tool).toBe('build-layers');
    expect(await readFile(join(project, 'built/base.png'), 'utf8')).toBe('old layers');
    await writeFile(join(stage, 'built/base.png'), 'rebuilt layers'); return 'built';
  });
  const call = api(runner), rig = structuredClone(fixture); rig.head.cx += 5;
  expect((await call('/__studio/projects/nova/rebuild', { rig })).status).toBe(200);
  expect(await readFile(join(project, 'built/base.png'), 'utf8')).toBe('rebuilt layers');
  expect(JSON.parse(await readFile(join(project, 'rig.json.bak'), 'utf8'))).toEqual(fixture);
  expect((await readdir(join(root, 'projects'))).filter(name => name.startsWith('.studio-job-'))).toEqual([]);
});
test('failure rolls back inputs and output layers, reports dependency errors and frees the project lock', async () => {
  const runner: Runner = vi.fn(async (_root, stage) => { await writeFile(join(stage, 'built/base.png'), 'partial'); throw new JobError('dependencies', 'uv missing'); });
  const call = api(runner);
  const result = await call('/__studio/projects/nova/rebuild'); expect(result.status).toBe(422); expect(JSON.parse(result.body).code).toBe('dependencies');
  expect(await readFile(join(project, 'built/base.png'), 'utf8')).toBe('old layers');
  expect((await call('/__studio/projects/nova/rig', fixture)).status).toBe(200);
  expect((await readdir(join(root, 'projects'))).filter(name => name.startsWith('.studio-job-'))).toEqual([]);
});
test('only one job or save runs per project and redirected paths cannot reach the runner', async () => {
  let release!: () => void;
  const runner: Runner = vi.fn(async () => { await new Promise<void>(done => { release = done; }); return 'built'; });
  const call = api(runner), first = call('/__studio/projects/nova/rebuild');
  await vi.waitFor(() => expect(runner).toHaveBeenCalledOnce());
  expect((await call('/__studio/projects/nova/rig', fixture)).status).toBe(409);
  expect((await call('/__studio/projects/nova/variant-requests')).status).toBe(409);
  release(); await first;
  await mkdir(join(root, 'outside')); await symlink(join(root, 'outside'), join(project, 'variants'));
  const rejected = await call('/__studio/projects/nova/rebuild'); expect(rejected.status).toBe(422); expect(JSON.parse(rejected.body).code).toBe('unsafeFiles');
  expect(runner).toHaveBeenCalledOnce();
  for (const name of ['%2Fother', '..', 'nova%2F..%2Fother']) expect((await call(`/__studio/projects/${name}/rebuild`)).status).toBe(400);
  expect((await readdir(join(root, 'outside'))).length).toBe(0);
});
test('variant import rejects filenames and failed validation preserves previous variants and sprites', async () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  for (const name of ['../mouth_a.png', '/mouth_a.png', 'mouth_a.jpg', 'other.png']) expect(() => decodeVariants({ files: [{ name, data: png.toString('base64') }] })).toThrow();
  expect(() => decodeVariants({ files: [{ name: 'mouth_a.png', data: 'invalid' }] })).toThrow();
  await mkdir(join(project, 'variants')); await writeFile(join(project, 'variants/mouth_a.png'), 'old variant');
  const files = decodeVariants({ files: [{ name: 'mouth_a.png', data: png.toString('base64') }] });
  await expect(projectJob(root, project, 'build-sprites', files, async (_root, stage) => {
    expect(await readFile(join(stage, 'variants/mouth_a.png'))).toEqual(png);
    throw new JobError('toolFailed', 'mouth_a: outside-mask max 255.000/255, mean 1.000000/255, 25 pixels over tolerance 8');
  })).rejects.toBeInstanceOf(JobError);
  expect(await readFile(join(project, 'variants/mouth_a.png'), 'utf8')).toBe('old variant');
  expect(await readFile(join(project, 'built/base.png'), 'utf8')).toBe('old layers');
});
test('repository context/reveal are fixed to the root and request files expose only validated masks', async () => {
  const reveal = vi.fn(async () => undefined);
  const handler = localProjectMiddleware(root, reveal, async (_root, stage) => {
    await mkdir(join(stage, 'variant-requests/mouth_a'), { recursive: true });
    await writeFile(join(stage, 'variant-requests/mouth_a/prompt.md'), 'a prompt');
    await writeFile(join(stage, 'variant-requests/mouth_a/mask.png'), 'a mask'); return 'prepared';
  });
  const request = async (url: string, method: string, body = {}) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]) as IncomingMessage;
    req.url = url; req.method = method; req.headers = { host: 'localhost:5173', 'content-type': 'application/json' };
    const result = { status: 0, body: '' }; const res = { writeHead(status: number) { result.status = status; }, end(value: string | Buffer) { result.body = String(value); } } as unknown as ServerResponse;
    await handler(req, res, () => undefined); return result;
  };
  expect(JSON.parse((await request('/__studio/context', 'GET')).body).rootPath).toBe(root);
  expect((await request('/__studio/reveal', 'POST', { path: '/other' })).status).toBe(200); expect(reveal).toHaveBeenCalledExactlyOnceWith(root);
  const result = await request('/__studio/projects/nova/variant-requests', 'POST', { rig: fixture });
  expect(result.status).toBe(200); expect(JSON.parse(result.body).requests[0].prompt).toBe('a prompt');
  expect((await request('/__studio/projects/nova/variant-requests/mouth_a/mask.png', 'GET')).body).toBe('a mask');
  expect((await request('/__studio/projects/nova/variant-requests/mouth_a/prompt.md', 'GET')).status).toBe(404);
});
test('tools use execFile with a fixed argument array, and missing dependencies return an actionable error', async () => {
  const execute = vi.mocked(execFile);
  execute.mockImplementation((...args: unknown[]) => {
    (args[3] as (error: Error | null, stdout: string, stderr: string) => void)(null, 'complete', ''); return {} as ReturnType<typeof execFile>;
  });
  expect(await runTool(root, project, 'build-layers')).toBe('complete');
  expect(execute).toHaveBeenCalledWith('uv', ['run', '--no-project', '--no-python-downloads', '--python', '>=3.10,<3.14', '--with', 'numpy', '--with', 'pillow', '--with', 'opencv-python-headless', resolve(root, 'tools/build-layers.py'), project], expect.objectContaining({ cwd: root, timeout: 120000 }), expect.any(Function));
  execute.mockImplementation((...args: unknown[]) => {
    (args[3] as (error: Error, stdout: string, stderr: string) => void)(Object.assign(new Error('not installed'), { code: 'ENOENT' }), '', ''); return {} as ReturnType<typeof execFile>;
  });
  await expect(runTool(root, project, 'build-sprites')).rejects.toMatchObject({ code: 'dependencies' });
});
