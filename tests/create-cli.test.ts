import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { create, parseArgs, REPOSITORY } from '../packages/create-mesh-avatar-studio/index.mjs';

function harness(statuses: Record<string, number | null> = {}) {
  const calls: { command: string; args: string[]; cwd: string }[] = [], logs: string[] = [], errors: string[] = [];
  const cwd = mkdtempSync(join(tmpdir(), 'create-studio-'));
  const run = (command: string, args: string[], dir: string) => {
    calls.push({ command, args, cwd: dir });
    const key = command === process.execPath ? 'doctor' : `${command} ${args[0]}`;
    if (key === 'git clone') mkdirSync(args[2], { recursive: true });
    return key in statuses ? statuses[key] : 0;
  };
  return { calls, logs, errors, cwd, options: { run, log: (m: string) => logs.push(m), error: (m: string) => errors.push(m), cwd, env: { LANG: 'en_US.UTF-8' }, version: 'v22.17.1' } };
}

describe('create-mesh-avatar-studio', () => {
  test('parses the folder, language and help', () => {
    expect(parseArgs([], { LANG: 'en_US' })).toEqual({ directory: 'mesh-avatar-studio', lang: 'en', help: false });
    expect(parseArgs(['mine', '--lang', 'ja'], {})).toEqual({ directory: 'mine', lang: 'ja', help: false });
    expect(parseArgs(['--lang=xx', '-h'], { LANG: 'ja_JP.UTF-8' })).toEqual({ directory: 'mesh-avatar-studio', lang: 'ja', help: true });
  });

  test('clones, creates projects/, installs, checks and prints the next steps', () => {
    const h = harness();
    expect(create(['mine'], h.options)).toBe(0);
    const target = join(h.cwd, 'mine');
    expect(h.calls.map(c => [c.command === process.execPath ? 'node' : c.command, ...c.args])).toEqual([
      ['git', '--version'], ['git', 'clone', REPOSITORY, target], ['npm', 'ci'], ['node', 'tools/doctor.mjs', '--lang', 'en'],
    ]);
    expect(h.calls.slice(2).every(c => c.cwd === target)).toBe(true);
    expect(existsSync(join(target, 'projects'))).toBe(true);
    expect(h.logs.at(-1)).toContain('cd mine\n  npm run dev');
  });

  test('suggests rerunning the check when doctor reports an error', () => {
    const h = harness({ doctor: 1 });
    expect(create([], h.options)).toBe(0);
    expect(h.logs.at(-1)).toContain('npm run doctor');
  });

  test('stops with a reason for an old Node.js, missing Git, a used folder or failed steps', () => {
    const old = harness();
    expect(create([], { ...old.options, version: 'v20.19.0' })).toBe(1);
    expect(old.errors[0]).toContain('Node.js 22.17 or later is required (found 20.19.0)');
    expect(old.calls).toEqual([]);

    const noGit = harness({ 'git --version': null });
    expect(create([], noGit.options)).toBe(1);
    expect(noGit.errors[0]).toContain('https://git-scm.com/downloads');

    const used = harness();
    mkdirSync(join(used.cwd, 'mesh-avatar-studio')); writeFileSync(join(used.cwd, 'mesh-avatar-studio', 'notes.txt'), 'x');
    expect(create([], used.options)).toBe(1);
    expect(used.errors[0]).toContain('already exists and is not empty');
    expect(used.calls.map(c => c.args[0])).toEqual(['--version']);

    const offline = harness({ 'git clone': 128 });
    expect(create([], offline.options)).toBe(1);
    expect(offline.errors[0]).toContain('Could not download the repository');

    const install = harness({ 'npm ci': 1 });
    expect(create(['mine'], install.options)).toBe(1);
    expect(install.errors[0]).toContain('run "npm ci" in mine');
  });

  test('accepts an existing empty folder and speaks Japanese', () => {
    const h = harness();
    mkdirSync(join(h.cwd, 'mesh-avatar-studio'));
    expect(create(['--lang', 'ja'], h.options)).toBe(0);
    expect(h.logs[0]).toContain('ダウンロードしています');
    expect(h.logs.at(-1)).toContain('README.ja.md');
  });
});
