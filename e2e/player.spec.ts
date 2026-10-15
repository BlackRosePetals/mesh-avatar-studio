import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { readFile } from 'node:fs/promises';
import { samplePresent, sampleSkipReason } from './sample';

test.beforeEach(() => { test.skip(!samplePresent, sampleSkipReason); });

const site = `http://127.0.0.1:${process.env.PLAYWRIGHT_SITE_PORT ?? 5174}/mesh-avatar-studio/`;

async function guardNetwork(context: BrowserContext) {
  const outside: string[] = [];
  await context.route('**/*', route => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') { outside.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  return outside;
}
// A moving synthetic camera and a tracker stub that reports a head turned 24 degrees.
async function fakeTracking(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { value: async () => [] });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      const ctx = canvas.getContext('2d')!;
      const draw = () => { ctx.fillStyle = '#999'; ctx.fillRect(0, 0, 640, 480); ctx.fillStyle = '#fff'; ctx.fillRect(Date.now() % 500, 100, 40, 40); };
      draw(); const timer = window.setInterval(draw, 33);
      const stream = canvas.captureStream(30), track = stream.getTracks()[0], stop = track.stop.bind(track);
      track.stop = () => { clearInterval(timer); stop(); };
      return stream;
    } });
  });
  await page.context().route('**/mediapipe/vision_bundle.js', route => route.fulfill({ contentType: 'application/javascript', body: `
    self.exports.FilesetResolver = { forVisionTasks: async () => ({}) };
    self.exports.FaceLandmarker = { createFromOptions: async () => ({ close() {}, detectForVideo() {
      const a = 24 * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      return { faceLandmarks: [[]], facialTransformationMatrixes: [{ data: [c,0,-s,0,0,1,0,0,s,0,c,0,0,0,0,1] }], faceBlendshapes: [{ categories: [] }] };
    } }) };` }));
}
const ready = (page: Page, name: string) => expect(page.getByTestId('player-status')).toHaveText(new RegExp(`· ${name.replace(/[().]/g, '\\$&')}$`));

test('player runs the sample with face tracking in the browser and makes no outside requests', async ({ context, page }) => {
  const outside = await guardNetwork(context);
  await fakeTracking(page);
  await page.goto(`${site}play/`);
  await ready(page, 'Miko (sample)');
  await expect(page.getByTestId('player-status')).toContainText('Avatar ready');
  const canvas = page.getByTestId('player-avatar');
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.getByTestId('tracking-status')).toHaveAttribute('data-state', 'tracking');
  // While tracking, idle motion is off: the head follows the stubbed 24 degree turn, and
  // calibrating makes that turn the neutral pose.
  await page.waitForTimeout(1000);
  const turned = await canvas.screenshot();
  await page.getByRole('button', { name: 'Calibrate' }).click();
  await expect(page.getByText('Neutral pose saved')).toBeVisible();
  await page.waitForTimeout(1000);
  expect((await canvas.screenshot()).equals(turned)).toBe(false);
  await page.getByRole('button', { name: 'Stop camera' }).click();
  await expect(page.getByTestId('tracking-status')).toHaveAttribute('data-state', 'stopped');
  expect(outside).toEqual([]);
});

test('player opens a dropped or chosen .mavatar and recovers from a broken file', async ({ page }) => {
  await page.goto(`${site}play/`);
  await ready(page, 'Miko (sample)');
  const archive = await (await page.request.get(`${site}miko.mavatar`)).body();
  await page.getByTestId('player-file').setInputFiles({ name: 'mine.mavatar', mimeType: 'application/octet-stream', buffer: archive });
  await ready(page, 'mine.mavatar');
  await expect(page.getByText('Miko © Yuki Shindo')).toHaveCount(0);
  await page.getByTestId('player-file').setInputFiles({ name: 'broken.mavatar', mimeType: 'application/octet-stream', buffer: Buffer.from('not an avatar') });
  await expect(page.getByTestId('player-notice')).toContainText('Could not open this file');
  await ready(page, 'mine.mavatar');
  // Drop onto the page.
  const transfer = await page.evaluateHandle(bytes => {
    const data = new DataTransfer(); data.items.add(new File([new Uint8Array(bytes)], 'dropped.mavatar')); return data;
  }, [...archive]);
  await page.locator('main').dispatchEvent('drop', { dataTransfer: transfer });
  await ready(page, 'dropped.mavatar');
  await page.getByRole('button', { name: 'Use the sample' }).click();
  await ready(page, 'Miko (sample)');
});

test('player shows only the avatar on an exact key colour for a window capture', async ({ page }) => {
  await page.goto(`${site}play/`);
  await ready(page, 'Miko (sample)');
  await page.getByLabel('Background').selectOption('#00ff00');
  // Keys are ignored while a form control has focus.
  await page.getByTestId('player-status').click();
  await page.keyboard.press('2');
  await expect(page.locator('.expression-on')).toHaveText('Smile');
  await page.getByRole('button', { name: 'Avatar only in this window' }).click();
  await expect(page.locator('.live-controls')).toBeHidden();
  await expect(page.getByTestId('player-exit-hint')).toBeHidden({ timeout: 5000 });
  const image = PNG.sync.read(await page.screenshot());
  expect([...image.data.subarray(0, 4)]).toEqual([0, 255, 0, 255]);
  await page.keyboard.press('Escape');
  await expect(page.locator('.live-controls')).toBeVisible();
});

test('player moves the avatar to its own window and back', async ({ page, context }) => {
  await page.goto(`${site}play/`);
  await ready(page, 'Miko (sample)');
  test.skip(!await page.evaluate(() => 'documentPictureInPicture' in window), 'Document Picture-in-Picture is unavailable');
  const opened = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Open avatar window' }).click();
  const avatarWindow = await opened;
  await expect(avatarWindow.locator('canvas')).toHaveCount(1);
  await expect(page.getByText('The avatar is shown in its own window.')).toBeVisible();
  const first = await avatarWindow.screenshot();
  await page.keyboard.press('4');
  await expect.poll(async () => (await avatarWindow.screenshot()).equals(first)).toBe(false);
  await avatarWindow.close();
  await expect(page.locator('.player-stage canvas')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Open avatar window' })).toBeVisible();
});

test('Japanese player page uses Japanese text and links back to the English page', async ({ page }) => {
  await page.goto(`${site}ja/play/`);
  await expect(page.getByTestId('player-status')).toContainText('アバターの準備ができました');
  await expect(page.getByRole('link', { name: 'English' })).toHaveAttribute('href', '../../play/');
  expect(await readFile(new URL('../site/ja/play/index.html', import.meta.url), 'utf8')).toContain('lang="ja"');
});
