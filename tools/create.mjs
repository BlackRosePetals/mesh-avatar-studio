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
    usage: 'Usage: npm run create -- <image.png> [--name <name>] [--yes | --no-variants] [--no-open]\n\n'
      + 'Codex also draws closed eyes, mouth shapes and expressions with OpenAI image generation.\n'
      + 'The command asks first, because this sends the image and masks to OpenAI.\n\n'
      + '  --name         project name under projects/ (default: from the file name)\n'
      + '  --yes, -y      agree to the image generation without asking\n'
      + '  --no-variants  keep everything on this machine and skip the drawn variants\n'
      + '  --no-open      do not start the editor when the avatar is ready',
    missingImage: 'Give the path of a PNG illustration.',
    noImage: path => `Image not found: ${path}`,
    badName: name => `Invalid project name: ${name}. Use letters, digits, hyphens or underscores.`,
    exists: name => `projects/${name} already exists. Choose another --name.`,
    consent: 'Codex will draw closed eyes, mouth shapes and expressions with OpenAI image generation.\nThis sends the image and masks to OpenAI. Continue? [Y/n] ',
    noConsent: 'Not sending the image. The avatar is made without drawn variants.',
    needConsent: 'Drawn variants send the image to OpenAI image generation. Without a terminal to ask, add --yes to agree or --no-variants to skip them.',
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
    usage: '使い方: npm run create -- <image.png> [--name <name>] [--yes | --no-variants] [--no-open]\n\n'
      + 'Codex は OpenAI の画像生成で、閉じ目・口の形・表情の描き分けも作ります。\n'
      + '画像とマスクが OpenAI に送られるため、始める前に確認します。\n\n'
      + '  --name         projects/ に作るプロジェクト名(既定: ファイル名から作成)\n'
      + '  --yes, -y      確認せずに画像生成に同意する\n'
      + '  --no-variants  すべてこのマシンの中で行い、描き分けは作らない\n'
      + '  --no-open      アバターができてもエディタを起動しない',
    missingImage: 'PNG のイラストのパスを指定してください。',
    noImage: path => `画像が見つかりません: ${path}`,
    badName: name => `プロジェクト名が使えません: ${name}。英数字、ハイフン、アンダースコアを使ってください。`,
    exists: name => `projects/${name} は既にあります。別の --name を指定してください。`,
    consent: 'Codex が OpenAI の画像生成で、閉じ目・口の形・表情の描き分けを作ります。\n画像とマスクが OpenAI に送られます。続けますか? [Y/n] ',
    noConsent: '画像は送りません。描き分けなしでアバターを作ります。',
    needConsent: '描き分けを作ると画像が OpenAI の画像生成に送られます。確認できる端末がないため、同意するなら --yes、作らないなら --no-variants を付けてください。',
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
  const options = { image: undefined, name: undefined, variants: true, yes: false, open: true, help: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--yes' || arg === '-y') options.yes = true;
    else if (arg === '--no-variants') options.variants = false;
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
      ? '- Step 6: the person agreed to send source.png and the masks to your built-in image generator. Generate every variant: closed, half and smiling eyes; mouths あ, half あ, い, お; and the expression variants eyes_sad, eyes_surprise, mouth_angry and mouth_sad. Then run build-sprites and review the poses again. Generate a variant again when build-sprites rejects it or its pose frames look wrong.'
      : '- Step 6: skip it. The person did not agree to send the image to an image generator.',
    `- Step 7: write the hand-over notes to ${project}/HANDOVER.md instead of telling the person. The editor is opened for them, so leave out how to open it.`,
    '',
    '- When a guide command fails only because of your sandbox (Chromium for render-poses cannot start there), run the same command again with escalated permissions. Do not copy or rewrite repository tools to work around it.',
    '- Build the avatar only with the tools the guide names. Do not post-process built/ with your own scripts: the editor rebuilds the avatar with the same tools, which would undo such changes. Report what the tools cannot fix instead.',
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

const confirm = async question => {
  const { createInterface } = await import('node:readline/promises');
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  // Ctrl+C rejects the question; that cancels the whole command (null) rather than declining.
  try { return !/^n/i.test((await prompt.question(question)).trim()); } catch { return null; } finally { prompt.close(); }
};

const capture = (command, args) => new Promise(done => {
  const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.on('error', () => done(null));
  child.on('exit', status => done(status === 0 ? output.trim() : null));
});

export async function create(argv, deps = {}) {
  const { run = execute, read = capture, exists = existsSync, environment = checkEnvironment, log = console.log, error = console.error,
    ask = confirm, interactive = Boolean(process.stdin.isTTY), cwd = process.env.INIT_CWD || process.cwd() } = deps;
  const lang = language(argv), t = text[lang], options = parseArgs(argv);
  if (options.help) { log(t.usage); return 0; }
  if (!options.image) { error(`${t.missingImage}\n\n${t.usage}`); return 1; }
  // npm run starts in the repository root; INIT_CWD is where the person typed the command.
  const image = resolve(cwd, options.image);
  if (!exists(image)) { error(t.noImage(options.image)); return 1; }
  const name = options.name ?? projectName(options.image, value => exists(join(root, 'projects', value)));
  if (!validName(name)) { error(t.badName(name)); return 1; }
  if (exists(join(root, 'projects', name))) { error(t.exists(name)); return 1; }
  // Ask before anything slow: the answer decides whether the image may leave this machine.
  if (options.variants && !options.yes) {
    if (!interactive) { error(t.needConsent); return 1; }
    const answer = await ask(t.consent);
    if (answer === null) return 130;
    if (!answer) { options.variants = false; log(t.noConsent); }
  }

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
