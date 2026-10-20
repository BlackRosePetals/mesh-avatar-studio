import { dismissGuide, samplePresent, sampleSkipReason } from './sample';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import fixture from '../samples/miko-qipao/rig.json' with { type: 'json' };

const hash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
async function drag(page: Page, point: [number, number], delta: [number, number]) {
  const canvas = page.getByTestId('editor');
  const box = (await canvas.boundingBox())!;
  const scale = Number(await canvas.getAttribute('data-scale'));
  const origin = [box.x + Number(await canvas.getAttribute('data-offset-x')), box.y + Number(await canvas.getAttribute('data-offset-y'))];
  const x = origin[0] + point[0] * scale, y = origin[1] + point[1] * scale;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + delta[0] * scale, y + delta[1] * scale, { steps: 8 });
  await page.mouse.up();
}

test('strand and head drags change inspector, saved JSON and frozen preview pixels', async ({ page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await dismissGuide(page);
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  await page.getByRole('slider', { name: 'Turn left/right', exact: true }).focus();
  await page.getByRole('slider', { name: 'Turn left/right', exact: true }).press('End');
  const preview = page.getByTestId('preview');
  let revision = Number(await preview.getAttribute('data-revision'));
  await page.getByRole('button', { name: 'Pause idle motion', exact: true }).click();
  await expect.poll(async () => Number(await preview.getAttribute('data-revision'))).toBeGreaterThan(revision);
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  const before = await preview.screenshot({ path: 'docs/screenshots/strand-before.png' });
  // Confirm that no idle animation can cause a false-positive pixel change.
  expect(hash(await preview.screenshot())).toBe(hash(before));
  revision = Number(await preview.getAttribute('data-revision'));
  await drag(page, [445, 340], [40, -10]);
  await page.getByText(`Nodes (${fixture.strands[0].nodes.length})`, { exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'strands.0.nodes.2.0', exact: true })).toHaveValue('485');
  await expect(page.getByRole('spinbutton', { name: 'strands.0.nodes.2.1', exact: true })).toHaveValue('330');
  await expect.poll(async () => Number(await preview.getAttribute('data-revision'))).toBeGreaterThan(revision);
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  const after = await preview.screenshot({ path: 'docs/screenshots/strand-after.png' });
  expect(hash(after)).not.toBe(hash(before));
  expect(hash(await preview.screenshot())).toBe(hash(after));
  const first = PNG.sync.read(before), second = PNG.sync.read(after);
  const difference = new PNG({ width: first.width, height: first.height });
  let changed = 0, hairChanged = 0;
  for (let y = 0; y < first.height; y++) for (let x = 0; x < first.width; x++) {
    const i = (y * first.width + x) * 4;
    const delta = Math.max(...[0, 1, 2, 3].map(channel => Math.abs(first.data[i + channel] - second.data[i + channel])));
    if (delta > 0) {
      changed++;
      if (x > first.width * 0.25 && x < first.width * 0.55 && y < first.height * 0.4) hairChanged++;
    }
    difference.data[i] = delta ? 255 : Math.round(first.data[i] * 0.3);
    difference.data[i + 1] = delta ? 30 : Math.round(first.data[i + 1] * 0.3);
    difference.data[i + 2] = delta ? 30 : Math.round(first.data[i + 2] * 0.3);
    difference.data[i + 3] = 255;
  }
  // Use image area so the same visible deformation is required at every preview size.
  expect(hairChanged / (first.width * first.height)).toBeGreaterThan(0.001);
  await writeFile('docs/screenshots/strand-diff.png', PNG.sync.write(difference));
  await page.screenshot({ path: 'docs/screenshots/strand-editor.png' });
  revision = Number(await preview.getAttribute('data-revision'));
  await page.getByTestId('part-head').click();
  await drag(page, [615, 400], [20, 15]);
  await expect(page.getByRole('spinbutton', { name: 'head.cx', exact: true })).toHaveValue('635');
  await expect(page.getByRole('spinbutton', { name: 'head.cy', exact: true })).toHaveValue('415');
  await expect.poll(async () => Number(await preview.getAttribute('data-revision'))).toBeGreaterThan(revision);
  const headAfter = await preview.screenshot({ path: 'docs/screenshots/head-preview.png' });
  expect(hash(headAfter)).not.toBe(hash(after));
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save rig', exact: true }).click();
  const download = await downloadPromise;
  const saved = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(saved.strands[0].nodes[2]).toEqual([485, 330]);
  expect(saved.head.cx).toBe(635);
  expect(saved.head.cy).toBe(415);
  expect(saved.eyes).toEqual(fixture.eyes);
  expect(errors).toEqual([]);
  console.log(`Preview changes: ${changed} pixels, ${hairChanged} in the hair region`);
});

test('angle sliders retain the rendered pose after rebuilding and stopping a sweep', async ({ page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  await page.goto('/');
  await dismissGuide(page);
  const preview = page.getByTestId('preview');
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  let revision = Number(await preview.getAttribute('data-revision'));
  await page.getByRole('button', { name: 'Pause idle motion', exact: true }).click();
  await expect.poll(async () => Number(await preview.getAttribute('data-revision'))).toBeGreaterThan(revision);
  const front = hash(await preview.screenshot());
  await page.getByRole('slider', { name: 'Turn left/right', exact: true }).press('End');
  await page.getByTestId('part-eyes').click();
  await page.getByText(`1 · Opening (${fixture.eyes[0].opening.length})`, { exact: true }).click();
  revision = Number(await preview.getAttribute('data-revision'));
  await page.getByRole('spinbutton', { name: 'eyes.0.opening.0.0', exact: true }).fill('451');
  await expect.poll(async () => Number(await preview.getAttribute('data-revision'))).toBeGreaterThan(revision);
  const turned = hash(await preview.screenshot());
  expect(turned).not.toBe(front);
  await expect(page.getByRole('slider', { name: 'Turn left/right', exact: true })).toHaveValue('30');
  const point = page.locator('.point-field').first();
  await expect(point.getByRole('spinbutton')).toHaveCount(2);
  await page.screenshot({ path: 'docs/screenshots/inspector-points-angle.png' });
  await page.getByTestId('part-head').click();
  await page.screenshot({ path: 'docs/screenshots/selected-band-lines.png' });
  await page.getByRole('button', { name: 'Sweep angles', exact: true }).click();
  await page.waitForTimeout(700);
  expect(hash(await preview.screenshot())).not.toBe(turned);
  revision = Number(await preview.getAttribute('data-revision'));
  await page.getByRole('button', { name: 'Stop sweep', exact: true }).click();
  await expect.poll(async () => Number(await preview.getAttribute('data-revision')), { timeout: 15000 }).toBeGreaterThan(revision);
  expect(hash(await preview.screenshot())).toBe(turned);
  await page.screenshot({ path: 'docs/screenshots/pose-after-sweep.png' });
  // Automatic completion restores the same slider-driven pose as a manual stop.
  // Starting and ending a sweep each recreate the preview (about 2 s when idle), and the
  // sweep runs for 6 s after the first one, so allow for a busy machine.
  await page.getByRole('button', { name: 'Sweep angles', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sweep angles', exact: true })).toBeVisible({ timeout: 20000 });
  await expect.poll(async () => hash(await preview.screenshot()), { timeout: 15000 }).toBe(turned);
});
