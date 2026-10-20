import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

let failuresRemaining = 0;
let failureCode: 'EPERM' | 'EBUSY' | 'ENOENT' = 'EPERM';
let renameCalls = 0;

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      renameCalls++;
      if (failuresRemaining > 0) {
        failuresRemaining--;
        const error = new Error('locked') as NodeJS.ErrnoException;
        error.code = failureCode;
        throw error;
      }
      return actual.rename(from, to);
    },
  };
});

const { renameResilient } = await import('../src/server/project-jobs');

let root: string;
beforeEach(async () => {
  await mkdir(resolve('projects'), { recursive: true });
  root = await mkdtemp(join(resolve('projects'), '.rename-test-'));
  failuresRemaining = 0; failureCode = 'EPERM'; renameCalls = 0;
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function makeTree(path: string) {
  await mkdir(join(path, 'nested'), { recursive: true });
  await writeFile(join(path, 'base.png'), 'layer data');
  await writeFile(join(path, 'nested', 'extra.png'), 'nested data');
}
async function readTree(path: string) {
  return { base: await readFile(join(path, 'base.png'), 'utf8'), nested: await readFile(join(path, 'nested', 'extra.png'), 'utf8') };
}

test('retries past a transient EPERM and completes a plain rename', async () => {
  const from = join(root, 'stage'), to = join(root, 'built');
  await makeTree(from);
  failuresRemaining = 2; failureCode = 'EPERM';
  await renameResilient(from, to);
  expect(renameCalls).toBe(3);
  await expect(readTree(to)).resolves.toEqual({ base: 'layer data', nested: 'nested data' });
  await expect(readFile(join(from, 'base.png'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
});

test('falls back to copy and remove once a watcher-locked EPERM outlasts the retries', async () => {
  const from = join(root, 'stage'), to = join(root, 'built');
  await makeTree(from);
  failuresRemaining = 999; failureCode = 'EBUSY';
  await renameResilient(from, to);
  expect(renameCalls).toBe(5);
  await expect(readTree(to)).resolves.toEqual({ base: 'layer data', nested: 'nested data' });
  await expect(readFile(join(from, 'base.png'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
});

test('an unrelated error is not retried or papered over', async () => {
  const from = join(root, 'stage'), to = join(root, 'built');
  await makeTree(from);
  failuresRemaining = 1; failureCode = 'ENOENT';
  await expect(renameResilient(from, to)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(renameCalls).toBe(1);
});
