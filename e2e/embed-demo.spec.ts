import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { readFile } from 'node:fs/promises';
import { samplePresent, sampleSkipReason } from './sample';

const site = `http://127.0.0.1:${process.env.PLAYWRIGHT_SITE_PORT ?? 5174}/mesh-avatar-studio/`;
const outside = new WeakMap<Page, string[]>();

test.beforeEach(async ({ context, page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  const requests: string[] = [];
  outside.set(page, requests);
  await context.route('**/*', route => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') {
      requests.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
});
test.afterEach(({ page }) => { expect(outside.get(page) ?? []).toEqual([]); });

for (const language of ['en', 'ja']) {
  test(`embed demo works in ${language} without outside requests`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${site}${language === 'ja' ? 'ja/' : ''}embed/`);
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    const image = PNG.sync.read(await page.locator('mesh-avatar canvas').screenshot({ omitBackground: true }));
    expect(image.data.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
    await page.locator('[data-expression="smile"]').click();
    expect(await page.evaluate(() => document.querySelector('mesh-avatar')!.avatar!.getExpression().name)).toBe('smile');
    await page.locator('#emotion').selectOption('happy');
    await page.locator('#emotion').selectOption('');
    await page.locator('#paused').check();
    expect(await page.evaluate(() => document.querySelector('mesh-avatar')!.paused)).toBe(true);
    await page.locator('#paused').uncheck();
    await page.locator('#no-idle').check();
    await expect(page.locator('mesh-avatar')).toHaveAttribute('no-idle', '');
    await page.locator('#speech-text').fill('こんにちは、よろしくお願いします。');
    await page.locator('#speech-form button').click();
    expect(await page.evaluate(() => document.querySelector('mesh-avatar')!.avatar!.getLipSyncState().active)).toBe(true);

    await page.evaluate(() => Reflect.set(window, 'previousAvatar', document.querySelector('mesh-avatar')!.avatar));
    const archive = await (await page.request.get(`${site}miko.mavatar`)).body();
    await page.locator('#avatar-file').setInputFiles({
      name: 'chosen.mavatar', mimeType: 'application/octet-stream', buffer: archive,
    });
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('#source-name')).toHaveText('chosen.mavatar');
    expect(await page.evaluate(() => document.querySelector('mesh-avatar')!.avatar !== Reflect.get(window, 'previousAvatar'))).toBe(true);
    await page.locator('#restore-miko').click();
    await expect(page.locator('#source-name')).toHaveText('Miko');
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');

    await page.locator('#avatar-file').setInputFiles({
      name: 'broken.mavatar', mimeType: 'application/octet-stream', buffer: Buffer.from('broken'),
    });
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'error');
    await page.locator('#restore-miko').click();
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('.language-switch')).toHaveAttribute('href', language === 'ja' ? '../../embed/' : '../ja/embed/');
    expect(errors).toEqual([]);
  });
}

test('microphone input drives the mouth and stopping releases the stream', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      const ctx = new AudioContext();
      await ctx.resume();
      const oscillator = ctx.createOscillator();
      const destination = ctx.createMediaStreamDestination();
      oscillator.connect(destination);
      oscillator.start();
      const stream = destination.stream;
      const track = stream.getAudioTracks()[0], stop = track.stop.bind(track);
      track.stop = () => {
        Reflect.set(window, 'microphoneStopped', true);
        oscillator.stop();
        void ctx.close();
        stop();
      };
      return stream;
    } });
  });
  await page.goto(`${site}embed/`);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.evaluate(() => {
    const el = document.querySelector('mesh-avatar')!;
    const set = el.setVoiceLevel.bind(el);
    el.setVoiceLevel = value => {
      Reflect.set(window, 'voiceLevel', value);
      set(value);
    };
  });
  await page.locator('#microphone').click();
  await expect(page.locator('#microphone')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => Number(Reflect.get(window, 'voiceLevel')))).toBeGreaterThan(0.1);
  await page.locator('#microphone').click();
  await expect(page.locator('#microphone')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => Reflect.get(window, 'microphoneStopped'))).toBe(true);
  expect(await page.evaluate(() => Reflect.get(window, 'voiceLevel'))).toBe(0);
});

test('microphone denial leaves controls usable and shows a localized message', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => { throw new DOMException('Denied', 'NotAllowedError'); },
    });
  });
  await page.goto(`${site}ja/embed/`);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.locator('#microphone').click();
  await expect(page.locator('#notice')).toContainText('マイクを開始できませんでした');
  await expect(page.locator('#microphone')).toBeEnabled();
  await expect(page.locator('#microphone')).toHaveAttribute('aria-pressed', 'false');
});

test('local audio drives mouth volume and resets it when playback stops', async ({ page }) => {
  const sampleRate = 16000, samples = sampleRate * 2;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * 440 * 2 * Math.PI / sampleRate) * 10000), 44 + i * 2);
  await page.goto(`${site}embed/`);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.evaluate(() => {
    const el = document.querySelector('mesh-avatar')!;
    const set = el.setVoiceLevel.bind(el);
    el.setVoiceLevel = value => {
      Reflect.set(window, 'voiceLevel', value);
      set(value);
    };
  });
  await page.locator('#audio-file').setInputFiles({ name: 'voice.wav', mimeType: 'audio/wav', buffer: wav });
  // Give the Web Audio context a user gesture before programmatic playback.
  await page.locator('#speech-form button').click();
  await page.locator('audio').evaluate(async audio => { await (audio as HTMLAudioElement).play(); });
  await expect.poll(() => page.evaluate(() => Number(Reflect.get(window, 'voiceLevel')))).toBeGreaterThan(0.1);
  await page.locator('audio').evaluate(audio => (audio as HTMLAudioElement).pause());
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'voiceLevel'))).toBe(0);
  await expect(page.locator('#notice')).toHaveText('');
});

for (const example of ['basic', 'playground']) {
  test(`standalone ${example} example opens directly from disk`, async ({ page }) => {
    // Use the unpublished build at the real CDN URL, without sending any requests outside.
    const bundle = await readFile(new URL('../packages/element/dist/standalone.js', import.meta.url));
    const archive = await (await page.request.get(`${site}miko.mavatar`)).body();
    await page.route('https://cdn.jsdelivr.net/npm/mesh-avatar-element@0/dist/standalone.js', route => route.fulfill({
      contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: bundle,
    }));
    await page.route('https://shinshin86.github.io/mesh-avatar-studio/miko.mavatar', route => route.fulfill({
      contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: archive,
    }));
    // Local file navigation is the feature under test, so it bypasses the HTTP-only guard.
    await page.route('file://**', route => route.continue());
    await page.goto(new URL(`../packages/element/examples/${example}.html`, import.meta.url).href);
    await expect.poll(() => page.evaluate(() => !!document.querySelector('mesh-avatar')?.avatar)).toBe(true);
    if (example === 'playground') {
      await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
      await page.locator('[data-expression="wink"]').click();
      expect(await page.evaluate(() => document.querySelector('mesh-avatar')!.avatar!.getExpression().name)).toBe('wink');
      await page.locator('#avatar-file').setInputFiles({ name: 'chosen.mavatar', mimeType: 'application/octet-stream', buffer: archive });
      await expect(page.locator('#source-name')).toHaveText('chosen.mavatar');
      await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
      await page.locator('#restore-miko').click();
      await expect(page.locator('#source-name')).toHaveText('Miko');
      await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
    }
  });
}
