#!/usr/bin/env node
// Downloads Mesh Avatar Studio, installs its packages and runs its environment check.
// Avatars are made inside the downloaded folder, so it is a full Git clone of the repository.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REPOSITORY = 'https://github.com/shinshin86/mesh-avatar-studio.git';
export const DEFAULT_DIRECTORY = 'mesh-avatar-studio';
const MIN_NODE = [22, 17];

const text = {
  en: {
    usage: `Usage: npx create-mesh-avatar-studio [directory] [--lang en|ja]

Downloads Mesh Avatar Studio into the directory (default: ${DEFAULT_DIRECTORY}),
installs its packages and checks the tools it needs.`,
    nodeOld: version => `Node.js ${MIN_NODE.join('.')} or later is required (found ${version}). Install it from https://nodejs.org/`,
    gitMissing: 'Git was not found. Install it from https://git-scm.com/downloads and run this command again.',
    notEmpty: directory => `${directory} already exists and is not empty. Choose another directory name.`,
    cloning: directory => `Downloading Mesh Avatar Studio into ${directory}…`,
    cloneFailed: 'Could not download the repository. Check your network connection and try again.',
    installing: 'Installing packages (npm ci)…',
    installFailed: directory => `Could not install the packages. Fix the error above, then run "npm ci" in ${directory}.`,
    next: (directory, ready) => `
Next steps:
  cd ${directory}
  ${ready ? 'npm run dev' : 'npm run doctor   # after installing the tools above'}

Open the URL that npm run dev prints, for example http://127.0.0.1:5173/.
To create an avatar from your illustration, open Claude Code or Codex in ${directory}
and follow README.md.`,
  },
  ja: {
    usage: `使い方: npx create-mesh-avatar-studio [フォルダ名] [--lang en|ja]

Mesh Avatar Studio をフォルダ(既定: ${DEFAULT_DIRECTORY})にダウンロードし、
パッケージのインストールと必要なツールの確認を行います。`,
    nodeOld: version => `Node.js ${MIN_NODE.join('.')} 以降が必要です(現在 ${version})。https://nodejs.org/ からインストールしてください。`,
    gitMissing: 'Git が見つかりません。https://git-scm.com/downloads からインストールして、もう一度実行してください。',
    notEmpty: directory => `${directory} はすでにあり、空ではありません。別のフォルダ名を指定してください。`,
    cloning: directory => `Mesh Avatar Studio を ${directory} にダウンロードしています…`,
    cloneFailed: 'リポジトリをダウンロードできませんでした。ネットワーク接続を確認して、もう一度実行してください。',
    installing: 'パッケージをインストールしています(npm ci)…',
    installFailed: directory => `パッケージをインストールできませんでした。上のエラーを解決してから、${directory} で「npm ci」を実行してください。`,
    next: (directory, ready) => `
次の手順:
  cd ${directory}
  ${ready ? 'npm run dev' : 'npm run doctor   # 上のツールをインストールしたあとで確認'}

npm run dev が表示する URL(例: http://127.0.0.1:5173/)をブラウザで開きます。
自分のイラストからアバターを作るときは、${directory} で Claude Code か Codex を開き、
README.ja.md の手順に沿って進めてください。`,
  },
};

export function parseArgs(argv, env = process.env) {
  let directory, lang, help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--lang') lang = argv[++i];
    else if (arg.startsWith('--lang=')) lang = arg.slice(7);
    else if (!arg.startsWith('-') && directory === undefined) directory = arg;
  }
  if (lang !== 'en' && lang !== 'ja') {
    const locale = env.LC_ALL || env.LC_MESSAGES || env.LANG || Intl.DateTimeFormat().resolvedOptions().locale;
    lang = /^ja/i.test(locale ?? '') ? 'ja' : 'en';
  }
  return { directory: directory ?? DEFAULT_DIRECTORY, lang, help };
}

export function nodeVersionOk(version) {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  return major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
}

/** Runs a command, showing its output unless quiet. Returns the exit status, or null when the command is missing. */
export function runCommand(command, args, cwd, quiet = false) {
  // npm is a batch file on Windows, which Node starts only through a shell.
  const result = spawnSync(command, args, { cwd, stdio: quiet ? 'ignore' : 'inherit', shell: process.platform === 'win32' && command === 'npm' });
  return result.error ? null : result.status;
}

export function create(argv, { run = runCommand, log = console.log, error = console.error, cwd = process.cwd(), env = process.env, version = process.version } = {}) {
  const options = parseArgs(argv, env), t = text[options.lang];
  if (options.help) { log(t.usage); return 0; }
  if (!nodeVersionOk(version)) { error(t.nodeOld(version.replace(/^v/, ''))); return 1; }
  if (run('git', ['--version'], cwd, true) !== 0) { error(t.gitMissing); return 1; }
  const target = resolve(cwd, options.directory);
  if (existsSync(target) && readdirSync(target).length) { error(t.notEmpty(options.directory)); return 1; }
  log(t.cloning(options.directory));
  if (run('git', ['clone', REPOSITORY, target], cwd) !== 0) { error(t.cloneFailed); return 1; }
  // Create the ignored project folder as this user. On Windows, a folder made later by an
  // agent in a sandbox can have permissions the editor cannot read.
  mkdirSync(resolve(target, 'projects'), { recursive: true });
  log(t.installing);
  if (run('npm', ['ci'], target) !== 0) { error(t.installFailed(options.directory)); return 1; }
  const ready = run(process.execPath, ['tools/doctor.mjs', '--lang', options.lang], target) === 0;
  log(t.next(options.directory, ready));
  return 0;
}

// npx and npm run start this file through a link, so compare real paths.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = create(process.argv.slice(2));
}
