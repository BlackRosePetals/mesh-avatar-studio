import { describe, expect, test } from 'vitest';
import { checkEnvironment, formatReport, language, nodeVersionOk } from '../tools/doctor.mjs';

const ready = { node: async () => '22.17.1', packages: async () => true, uv: async () => '0.9.21', python: async () => '3.12.4', chromium: async () => true };
const statuses = (results: { id: string; status: string }[]) => Object.fromEntries(results.map(r => [r.id, r.status]));

describe('environment check', () => {
  test('requires Node.js 22.17 or later', () => {
    expect([nodeVersionOk('v22.17.0'), nodeVersionOk('22.16.9'), nodeVersionOk('23.0.0'), nodeVersionOk('20.19.0')]).toEqual([true, false, true, false]);
  });

  test('passes with every tool and tells the person how to start the editor', async () => {
    const results = await checkEnvironment('en', ready);
    expect(statuses(results)).toEqual({ node: 'ok', packages: 'ok', uv: 'ok', python: 'ok', chromium: 'ok' });
    expect(formatReport(results, 'en')).toContain('Everything is ready. Start the editor with: npm run dev');
  });

  test('an old Node.js or missing packages are errors', async () => {
    const results = await checkEnvironment('en', { ...ready, node: async () => '20.19.0', packages: async () => false });
    expect(statuses(results)).toMatchObject({ node: 'error', packages: 'error' });
    expect(formatReport(results, 'en')).toMatch(/✗ Node\.js 22\.17 or later is required \(found 20\.19\.0\)[\s\S]*✗ Packages are not installed\. Run: npm install[\s\S]*Fix the errors above/);
  });

  test('missing uv, Python or Chromium are warnings that keep the editor usable', async () => {
    const noUv = await checkEnvironment('en', { ...ready, uv: async () => null, chromium: async () => false });
    expect(statuses(noUv)).toEqual({ node: 'ok', packages: 'ok', uv: 'warn', python: 'warn', chromium: 'warn' });
    const report = formatReport(noUv, 'en');
    expect(report).toContain('Python was not checked because uv is missing.');
    expect(report).toContain('Creating avatars with an agent, or importing drawn eyes and mouths, needs it');
    expect(report).toContain('npx playwright install chromium');
    expect(report).toContain('You can start the editor with: npm run dev');
    const noPython = await checkEnvironment('en', { ...ready, python: async () => null });
    expect(formatReport(noPython, 'en')).toContain('uv python install 3.12');
  });

  test('a free-threaded Python is a warning because OpenCV has no package for it', async () => {
    const results = await checkEnvironment('en', { ...ready, python: async () => '3.14.0t' });
    expect(statuses(results).python).toBe('warn');
    expect(formatReport(results, 'en')).toContain('free-threaded Python 3.14.0');
  });

  test('reports in Japanese, chosen by flag or locale', async () => {
    expect([language(['--lang', 'ja'], {}), language(['--lang=en'], { LANG: 'ja_JP.UTF-8' }), language([], { LANG: 'ja_JP.UTF-8' }), language([], { LANG: 'en_US.UTF-8' })]).toEqual(['ja', 'en', 'ja', 'en']);
    const report = formatReport(await checkEnvironment('ja', { ...ready, chromium: async () => false }), 'ja');
    expect(report).toContain('⚠ Playwright の Chromium が見つかりません。エディタと配信画面はこのまま使えます。');
    expect(report).toContain('エディタは次のコマンドで起動できます: npm run dev');
  });
});
