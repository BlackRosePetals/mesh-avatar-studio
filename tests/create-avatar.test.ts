import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { agentPrompt, create, parseArgs, projectName } from '../tools/create.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const ready = async () => ['node', 'packages', 'uv', 'python', 'chromium'].map(id => ({ id, status: 'ok', message: id }));

function harness({ files = [] as string[], statuses = {} as Record<string, number | null>, environment = ready, answer = true as boolean | null, interactive = true } = {}) {
  const calls: { command: string; args: string[]; options?: { stdio?: unknown } }[] = [], logs: string[] = [], errors: string[] = [], questions: string[] = [];
  const existing = new Set(files);
  const run = async (command: string, args: string[], options?: { stdio?: unknown }) => {
    calls.push({ command, args, options });
    const key = command === process.execPath ? 'vite' : `${command} ${args[0]}`;
    if (key === 'codex exec' && !(key in statuses)) {
      const name = args.at(-1)!.match(/in projects\/([^ ]+) by/)![1];
      existing.add(join(root, 'projects', name, 'rig.json')).add(join(root, 'projects', name, 'built', 'base.png'));
    }
    return key in statuses ? statuses[key] : 0;
  };
  const read = async (command: string) => command === 'codex' ? 'codex-cli 0.164.0' : '/cache/uv';
  const ask = async (question: string) => { questions.push(question); return answer; };
  const deps = { run, read, ask, interactive, exists: (path: string) => existing.has(path), environment, log: (m: string) => logs.push(m), error: (m: string) => errors.push(m), cwd: '/work' };
  return { calls, logs, errors, questions, deps };
}

describe('npm run create', () => {
  test('parses the image, name and flags', () => {
    expect(parseArgs(['a.png', '--name', 'mio', '--yes', '--no-open', '--lang', 'ja'])).toMatchObject({ image: 'a.png', name: 'mio', variants: true, yes: true, open: false });
    expect(parseArgs(['--name=mio', 'b.png', '--no-variants'])).toMatchObject({ image: 'b.png', name: 'mio', variants: false, yes: false, open: true });
    expect(parseArgs(['c.png', '-y'])).toMatchObject({ variants: true, yes: true });
  });

  test('derives a project name from the file name and skips taken names', () => {
    expect(projectName('/x/My New Avatar (v2).png', () => false)).toBe('my-new-avatar-v2');
    expect(projectName('/x/少女.png', () => false)).toBe('avatar');
    expect(projectName('mio.png', name => name === 'mio' || name === 'mio-2')).toBe('mio-3');
  });

  test('answers every question of the guide and draws every variant only with consent', () => {
    const plain = agentPrompt('mio', { variants: false });
    expect(plain).toContain('docs/agent-guide.md');
    expect(plain).toContain('projects/mio/HANDOVER.md');
    expect(plain).toContain('Step 6: skip it');
    expect(plain).toContain('do not stage or commit');
    expect(plain).toContain('run the same command again with escalated permissions');
    expect(plain).toContain('Do not post-process built/');
    expect(plain).toContain('keeps its own copy of each result outside the repository');
    const variants = agentPrompt('mio', { variants: true });
    expect(variants).toContain('the person agreed to send source.png and the masks');
    expect(variants).toContain('eyes_sad, eyes_surprise, mouth_angry and mouth_sad');
  });

  test('asks about OpenAI image generation first, then creates the project, runs Codex and opens the editor', async () => {
    const { calls, questions, deps } = harness({ files: ['/work/mio.png'] });
    expect(await create(['mio.png', '--lang', 'en'], deps)).toBe(0);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toContain('This sends the image and masks to OpenAI.');
    expect(calls.map(call => `${call.command === process.execPath ? 'vite' : call.command} ${call.args[0]}`)).toEqual(['uv run', 'codex exec', 'vite ' + join(root, 'node_modules/vite/bin/vite.js')]);
    expect(calls[0].args).toEqual(['run', 'tools/new-project.py', '/work/mio.png', 'mio']);
    expect(calls[1].args.slice(0, 6)).toEqual(['exec', '--approve-for-me', '-C', root, '--add-dir', '/cache/uv']);
    expect(calls[1].args.at(-1)).toContain('the person agreed to send');
    expect(calls[1].options?.stdio).toEqual(['ignore', 'inherit', 'inherit']);
    expect(calls[2].args).toContain('/?project=mio');
  });

  test('a declined, skipped or pre-approved image generation is not asked again', async () => {
    const declined = harness({ files: ['/work/mio.png'], answer: false });
    expect(await create(['mio.png', '--lang', 'en'], declined.deps)).toBe(0);
    expect(declined.logs).toContain('Not sending the image. The avatar is made without drawn variants.');
    expect(declined.calls[1].args.at(-1)).toContain('Step 6: skip it');
    for (const [flag, step] of [['--yes', 'the person agreed to send'], ['--no-variants', 'Step 6: skip it']]) {
      const { calls, questions, deps } = harness({ files: ['/work/mio.png'], interactive: false });
      expect(await create(['mio.png', flag, '--lang', 'en'], deps)).toBe(0);
      expect(questions).toEqual([]);
      expect(calls[1].args.at(-1)).toContain(step);
    }
  });

  test('cancelling the question stops before anything runs', async () => {
    const { calls, deps } = harness({ files: ['/work/mio.png'], answer: null });
    expect(await create(['mio.png', '--lang', 'en'], deps)).toBe(130);
    expect(calls).toEqual([]);
  });

  test('without a terminal it needs --yes or --no-variants before doing anything', async () => {
    const { calls, errors, deps } = harness({ files: ['/work/mio.png'], interactive: false });
    expect(await create(['mio.png', '--lang', 'en'], deps)).toBe(1);
    expect(errors[0]).toContain('add --yes to agree or --no-variants');
    expect(calls).toEqual([]);
  });

  test('stops before creating anything when a tool is missing', async () => {
    const environment = async () => [{ id: 'chromium', status: 'warn', message: 'Playwright Chromium was not found.' }];
    const { calls, errors, deps } = harness({ files: ['/work/mio.png'], environment });
    expect(await create(['mio.png', '--lang', 'en'], deps)).toBe(1);
    expect(calls).toEqual([]);
    expect(errors.join('\n')).toContain('Playwright Chromium was not found.');
  });

  test('refuses an existing project and does not open the editor when Codex fails', async () => {
    const taken = harness({ files: ['/work/mio.png', join(root, 'projects', 'mio')] });
    expect(await create(['mio.png', '--name', 'mio', '--lang', 'en'], taken.deps)).toBe(1);
    expect(taken.errors[0]).toContain('projects/mio already exists');
    const failed = harness({ files: ['/work/mio.png'], statuses: { 'codex exec': 2 } });
    expect(await create(['mio.png', '--lang', 'en'], failed.deps)).toBe(2);
    expect(failed.calls.some(call => call.command === process.execPath)).toBe(false);
  });

  test('does not open the editor when Codex leaves no built avatar', async () => {
    const { calls, errors, deps } = harness({ files: ['/work/mio.png'], statuses: { 'codex exec': 0 } });
    expect(await create(['mio.png', '--lang', 'en'], deps)).toBe(1);
    expect(errors[0]).toContain('HANDOVER.md');
    expect(calls.some(call => call.command === process.execPath)).toBe(false);
  });
});
