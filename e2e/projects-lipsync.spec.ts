import { expect, test, type Page } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve, basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import fixture from '../samples/miko-qipao/rig.json' with { type: 'json' };
import { dismissGuide, samplePresent, sampleSkipReason } from './sample';

let directory: string, name: string;
test.beforeEach(async () => {
  test.skip(!samplePresent, sampleSkipReason);
  await mkdir(resolve('projects'), { recursive: true });
  directory = await mkdtemp(join(resolve('projects'), 'lip-check-')); name = basename(directory);
  await cp(resolve('samples/miko-qipao'), directory, { recursive: true,
    filter: path => !path.includes(join(resolve('samples/miko-qipao'), 'review')) && !path.includes(join(resolve('samples/miko-qipao'), 'built', 'sprites')) });
});
test.afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
async function open(page: Page, project: string) {
  await page.goto('/'); await dismissGuide(page);
  await page.locator('.open-menu > summary').click();
  await page.getByTestId(`project-${project}`).click();
  await expect(page.getByTestId('project-location')).toBeVisible();
  await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
}
async function hashMouth(page: Page) {
  const bytes = await page.getByTestId('preview').evaluate((element, rig) => {
    const canvas = element as HTMLCanvasElement;
    const { width, height } = canvas;
    const scale = Math.min(width / (rig.image.width * (1 + 2 * rig.view.padSide)), height / (rig.image.height * (1 + rig.view.padTop)));
    const ox = (width - rig.image.width * scale) / 2, oy = height - rig.image.height * scale;
    const mouth = rig.mouth.area;
    const crop = document.createElement('canvas'); crop.width = Math.ceil((mouth.rx * 2 + 32) * scale); crop.height = Math.ceil((mouth.ry * 2 + 32) * scale);
    const ctx = crop.getContext('2d')!;
    ctx.drawImage(canvas, Math.floor(ox + (mouth.cx - mouth.rx - 16) * scale), Math.floor(oy + (mouth.cy - mouth.ry - 16) * scale), crop.width, crop.height, 0, 0, crop.width, crop.height);
    return Array.from(ctx.getImageData(0, 0, crop.width, crop.height).data);
  }, fixture);
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

test('listed project saves in place with one backup, supports keyboard save, path copy and stubbed reveal', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page, name);
  const location = page.getByTestId('project-location'); await expect(location).toContainText(name);
  await expect(location.locator('strong')).toHaveText(name);
  await expect(location.locator('.project-path')).toHaveCount(0);
  await expect(location).not.toContainText('projects/');
  await expect(location.getByRole('button', { name: 'Copy path', exact: true })).toHaveAttribute('title', 'Copy path');
  await page.getByRole('button', { name: 'Copy path' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(directory);
  await expect(page.getByTestId('project-location').getByRole('button', { name: '✓ Copied', exact: true })).toHaveAttribute('aria-live', 'polite');
  await expect(page.getByTestId('project-location').getByRole('button', { name: 'Copy path', exact: true })).toBeVisible({ timeout: 5000 });
  let revealed = false;
  await page.route(`**/__studio/projects/${name}/reveal`, route => { revealed = true; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ path: directory }) }); });
  await location.locator('button').last().click(); await expect.poll(() => revealed).toBe(true);
  await page.getByTestId('part-head').click();
  const x = page.getByRole('spinbutton', { name: 'head.cx', exact: true }); await x.fill('635');
  await page.getByRole('button', { name: 'Save rig', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: `Saved to projects/${name}/rig.json` })).toBeVisible();
  expect(JSON.parse(await readFile(join(directory, 'rig.json.bak'), 'utf8')).head.cx).toBe(fixture.head.cx);
  expect(JSON.parse(await readFile(join(directory, 'rig.json'), 'utf8')).head.cx).toBe(635);
  await x.fill('645'); await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(async () => JSON.parse(await readFile(join(directory, 'rig.json'), 'utf8')).head.cx).toBe(645);
  expect(JSON.parse(await readFile(join(directory, 'rig.json.bak'), 'utf8')).head.cx).toBe(635);
});

for (const sprites of [true, false]) test(`vowels and text change mouth pixels ${sprites ? 'with sprites' : 'without sprites'}`, async ({ page }) => {
  await open(page, sprites ? 'sample-miko-qipao' : name);
  await page.getByTestId('idle-toggle').click();
  await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
  await page.getByRole('tab', { name: 'Lip sync', exact: true }).click();
  const hashes: string[] = [];
  for (const vowel of ['あ', 'い', 'お']) {
    await page.getByRole('button', { name: vowel, exact: true }).click();
    await expect(page.getByRole('button', { name: vowel, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('slider', { name: 'Mouth open', exact: true })).toBeDisabled();
    await page.waitForTimeout(350); hashes.push(await hashMouth(page));
  }
  expect(new Set(hashes).size).toBe(3);
  await page.getByRole('button', { name: 'ん', exact: true }).click();
  await expect.poll(async () => Number(await page.getByRole('slider', { name: 'Mouth open', exact: true }).inputValue())).toBeLessThan(0.02);
  await page.getByRole('button', { name: 'Release', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Mouth open', exact: true })).toBeEnabled();
  await page.getByLabel('Kana text', { exact: true }).fill('アイオ 漢字A');
  await expect(page.locator('.lip-skipped')).toContainText('漢 字 A');
  await page.getByLabel('Loop', { exact: true }).check();
  const speed = page.getByRole('slider', { name: 'Morae per second', exact: true }); await speed.fill('4');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const frames = [];
  for (let i = 0; i < 6; i++) { await page.waitForTimeout(120); frames.push(await hashMouth(page)); }
  expect(new Set(frames).size).toBeGreaterThan(2);
  await page.waitForTimeout(700); await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Mouth open', exact: true })).toBeEnabled();
});

test('unavailable local server keeps the project picker and rig download without page errors', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__studio/projects', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
  await page.goto('/'); await dismissGuide(page);
  await page.locator('.open-menu > summary').click();
  await expect(page.getByLabel('Local projects', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Browse for a project folder…', exact: true })).toBeVisible();
  await page.getByLabel('Open project folder files', { exact: true }).setInputFiles(directory);
  await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('project-location')).toContainText(name);
  await expect(page.getByTestId('project-location').getByRole('button')).toHaveCount(0);
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save rig', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('rig.json'); expect(errors).toEqual([]);
});

test('dev endpoint rejects traversal even when the raw HTTP path preserves dot segments', async ({ baseURL }) => {
  const url = new URL(baseURL!);
  for (const path of ['../rig', '%2e%2e/rig', '%2Fprivate/rig', `${name}%2F..%2Fother/rig`, `${name}/built/../../rig`]) {
    const status = await new Promise<number>((done, reject) => {
      const req = httpRequest({ hostname: url.hostname, port: url.port, path: `/__studio/projects/${path}`, method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => { res.resume(); done(res.statusCode!); });
      req.on('error', reject); req.end(JSON.stringify(fixture));
    });
    expect(status, path).toBe(400);
  }
});

test('recent projects persist in order, auto-reopen, remove missing entries, and can be removed or cleared', async ({ page }) => {
  await open(page, name);
  await page.getByTestId('part-head').click();
  await page.getByRole('spinbutton', { name: 'head.cx', exact: true }).fill('555');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await page.locator('.open-menu > summary').click(); await page.getByTestId('project-sample-miko-qipao').click();
  await expect(page.getByTestId('project-location')).toContainText('Sample project');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByTestId('project-location')).toContainText('Sample project');
  await page.locator('.open-menu > summary').click();
  const menu = page.locator('.project-menu');
  const ids = await menu.locator('.recent-row > button:first-child').evaluateAll(buttons => buttons.map(button => button.getAttribute('data-testid')));
  expect(ids.slice(0, 2)).toEqual(['recent-server:sample-miko-qipao', `recent-server:${name}`]);
  await menu.getByTestId(`recent-server:${name}`).click();
  await expect(page.getByTestId('project-location')).toContainText(name);
  await page.reload(); await expect(page.getByTestId('project-location')).toContainText(name);
  await page.evaluate(() => {
    const key = 'mesh-avatar-recent-projects', entries = JSON.parse(localStorage.getItem(key)!);
    entries.unshift({ id: 'server:missing-ui-test', kind: 'server', name: 'missing-ui-test', serverName: 'missing-ui-test', relativePath: 'projects/missing-ui-test', lastOpened: new Date().toISOString() });
    localStorage.setItem(key, JSON.stringify(entries));
  });
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: 'Project no longer exists; removed from history: missing-ui-test' })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mesh-avatar-recent-projects')!).some((entry: { name: string }) => entry.name === 'missing-ui-test'))).toBe(false);
  await page.locator('.open-menu > summary').click();
  await menu.getByRole('checkbox', { name: 'Reopen last project on start' }).uncheck();
  await page.reload(); await dismissGuide(page);
  await expect(page.getByTestId('project-location')).toHaveCount(0);
  await page.locator('.open-menu > summary').click();
  await menu.getByRole('button', { name: `Remove from history ${name}`, exact: true }).click();
  await expect(menu.getByTestId(`recent-server:${name}`)).toHaveCount(0);
  await menu.getByRole('button', { name: 'Clear history', exact: true }).click();
  await expect(menu.getByText('No recent projects.', { exact: true })).toBeVisible();
});

test('picker projects without a persistent handle show Browse again in recent history', async ({ page }) => {
  await page.goto('/'); await dismissGuide(page);
  await page.getByLabel('Open project folder files', { exact: true }).setInputFiles(directory);
  await page.locator('.open-menu > summary').click();
  await expect(page.locator('.project-menu').getByTestId(`recent-folder:${name}`)).toContainText('Browse again');
  await page.reload(); await dismissGuide(page);
  await page.locator('.open-menu > summary').click();
  await expect(page.locator('.project-menu').getByTestId(`recent-folder:${name}`)).toContainText('Browse again');
});
