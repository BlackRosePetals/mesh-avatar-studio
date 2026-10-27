#!/usr/bin/env node
// One command from an illustration to an open editor: creates projects/<name>, has Codex
// follow docs/agent-guide.md without questions, then starts the editor on that project.
import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkEnvironment, formatReport, language } from './doctor.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

const text = {
  en: {
    usage: 'Usage: npm run create -- <image.png> [--name <name>] [--variants] [--no-open]\n\n'
      + '  --name      project name under projects/ (default: from the file name)\n'
      + '  --variants  let Codex send source.png and masks to its image generator for drawn\n'
      + '              closed eyes and mouth shapes (Step 6 of the agent guide)\n'
      + '  --no-open   do not start the editor when the avatar is ready',
    missingImage: 'Give the path of a PNG illustration.',
    noImage: path => `Image not found: ${path}`,
    badName: name => `Invalid project name: ${name}. Use letters, digits, hyphens or underscores.`,
    exists: name => `projects/${name} already exists. Choose another --name.`,
    environment: 'Fix the tools marked above, then run this command again.',
    noCodex: 'Codex CLI was not found. Install it and sign in: https://github.com/openai/codex',
    creating: name => `Creating projects/${name} …`,
    agent: 'Codex is building the avatar. This usually takes tens of minutes.',
    agentFailed: status => `Codex stopped with exit code ${status}. Its notes, if any, are in the project folder.`,
    incomplete: name => `Codex finished but projects/${name} has no built avatar. Read projects/${name}/HANDOVER.md for the reason.`,
    ready: name => `The avatar is ready: projects/${name}. Hand-over notes: projects/${name}/HANDOVER.md`,
    opening: 'Starting the editor. Press Ctrl+C to stop it.',
  },
  ja: {
    usage: '使い方: npm run create -- <image.png> [--name <name>] [--variants] [--no-open]\n\n'
      + '  --name      projects/ に作るプロジェクト名(既定: ファイル名から作成)\n'
      + '  --variants  閉じ目と口の形の描き分けのため、source.png とマスクを Codex の画像生成に\n'
      + '              送ることを許可する(エージェントガイドの Step 6)\n'
      + '  --no-open   アバターができてもエディタを起動しない',
    missingImage: 'PNG のイラストのパスを指定してください。',
    noImage: path => `画像が見つかりません: ${path}`,
    badName: name => `プロジェクト名が使えません: ${name}。英数字、ハイフン、アンダースコアを使ってください。`,
    exists: name => `projects/${name} は既にあります。別の --name を指定してください。`,
    environment: '上の警告やエラーのツールを用意してから、もう一度実行してください。',
    noCodex: 'Codex CLI が見つかりません。インストールしてサインインしてください: https://github.com/openai/codex',
    creating: name => `projects/${name} を作成しています…`,
    agent: 'Codex がアバターを作っています。通常は数十分かかります。',
    agentFailed: status => `Codex が終了コード ${status} で止まりました。メモがあればプロジェクトフォルダにあります。`,
    incomplete: name => `Codex は終了しましたが、projects/${name} にアバターができていません。理由は projects/${name}/HANDOVER.md を確認してください。`,
    ready: name => `アバターができました: projects/${name}。引き継ぎメモ: projects/${name}/HANDOVER.md`,
    opening: 'エディタを起動します。止めるときは Ctrl+C を押してください。',
  },
};

export function parseArgs(argv) {
  const options = { image: undefined, name: undefined, variants: false, open: true, help: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--variants') options.variants = true;
    else if (arg === '--no-open') options.open = false;
    else if (arg === '--name') options.name = argv[++index];
    else if (arg.startsWith('--name=')) options.name = arg.slice(7);
    else if (arg === '--lang') index++;
    else if (!arg.startsWith('--')) options.image ??= arg;
  }
  return options;
}

export const validName = name => /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name ?? '');

/** A project name from the file name, with a number added while that name is taken. */
export function projectName(image, taken = name => existsSync(join(root, 'projects', name))) {
  const stem = basename(image, extname(image)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '') || 'avatar';
  let name = stem;
  for (let index = 2; taken(name); index++) name = `${stem}-${index}`;
  return name;
}

/** The request Codex runs non-interactively: every question in the guide is answered here. */
export function agentPrompt(name, { variants }) {
  const project = `projects/${name}`;
  return [
    `Create a mesh avatar in ${project} by following docs/agent-guide.md from "Before you start" through Step 7.`,
    `Step 1 is already done: ${project}/source.png and ${project}/rig.draft.json exist. Do not run new-project.py again.`,
    '',
    'This run is non-interactive. Nobody can answer questions, so decide as follows:',
    '- Model: state which model you are running as in the hand-over notes and continue.',
    `- Vision check: run it with ${project}/work/vision-check as the folder. If the score fails, stop and explain it in the hand-over notes.`,
    '- Image warnings (pose, covered face, missing transparency): record them in the hand-over notes and continue.',
    variants
      ? '- Step 6: the person agreed to send source.png and the masks to your built-in image generator. Generate the required variants (closed, half and smiling eyes; mouths あ, half あ, い, お), not the optional expression ones, then run build-sprites and review the poses again.'
      : '- Step 6: skip it. The person did not agree to send the image to an image generator.',
    `- Step 7: write the hand-over notes to ${project}/HANDOVER.md instead of telling the person. The editor is opened for them, so leave out how to open it.`,
    '',
    `Only create or change files inside ${project}/. Do not change other files in the repository, and do not stage or commit anything.`,
    'End with a short summary of the result and the parts to check first.',
  ].join('\n');
}

const execute = (command, args, options = {}) => new Promise(done => {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options });
  child.on('error', () => done(null));
  child.on('exit', status => done(status));
});

const capture = (command, args) => new Promise(done => {
  const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.on('error', () => done(null));
  child.on('exit', status => done(status === 0 ? output.trim() : null));
});

export async function create(argv, deps = {}) {
  const { run = execute, read = capture, exists = existsSync, environment = checkEnvironment, log = console.log, error = console.error,
    cwd = process.env.INIT_CWD || process.cwd() } = deps;
  const lang = language(argv), t = text[lang], options = parseArgs(argv);
  if (options.help) { log(t.usage); return 0; }
  if (!options.image) { error(`${t.missingImage}\n\n${t.usage}`); return 1; }
  // npm run starts in the repository root; INIT_CWD is where the person typed the command.
  const image = resolve(cwd, options.image);
  if (!exists(image)) { error(t.noImage(options.image)); return 1; }
  const name = options.name ?? projectName(options.image, value => exists(join(root, 'projects', value)));
  if (!validName(name)) { error(t.badName(name)); return 1; }
  if (exists(join(root, 'projects', name))) { error(t.exists(name)); return 1; }

  // Every step of the guide needs uv, Python and Chromium, so a warning blocks here.
  const results = await environment(lang);
  if (results.some(result => result.status !== 'ok')) { error(formatReport(results, lang)); error(t.environment); return 1; }
  if (!await read('codex', ['--version'])) { error(t.noCodex); return 1; }

  log(t.creating(name));
  const created = await run('uv', ['run', 'tools/new-project.py', image, name]);
  if (created !== 0) return created ?? 1;

  log(t.agent);
  // Codex works in its sandbox and asks for more only to run Chromium and similar tools;
  // --approve-for-me has those requests reviewed automatically instead of by a person.
  // Its stdin stays closed: codex exec would otherwise wait to append piped input to the prompt.
  const cache = await read('uv', ['cache', 'dir']);
  const agent = await run('codex', ['exec', '--approve-for-me', '-C', root, ...(cache ? ['--add-dir', cache] : []), agentPrompt(name, options)], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (agent !== 0) { error(t.agentFailed(agent)); return agent ?? 1; }
  const project = join(root, 'projects', name);
  if (!exists(join(project, 'rig.json')) || !exists(join(project, 'built', 'base.png'))) { error(t.incomplete(name)); return 1; }
  log(t.ready(name));
  if (!options.open) return 0;

  log(t.opening);
  const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  return await run(process.execPath, [vite, '--host', '127.0.0.1', '--open', `/?project=${encodeURIComponent(name)}`]) ?? 1;
}

// npm run starts this file through a link, so compare real paths.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await create(process.argv.slice(2));
}
