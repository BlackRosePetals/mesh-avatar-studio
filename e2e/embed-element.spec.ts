import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import type { MeshAvatarElement } from '../packages/element/src/index';
import { samplePresent, sampleSkipReason } from './sample';

const sample = `http://127.0.0.1:${process.env.PLAYWRIGHT_SITE_PORT ?? 5174}/mesh-avatar-studio/miko.mavatar`;
const defaultSrc = 'https://shinshin86.github.io/mesh-avatar-studio/miko.mavatar';
const outside = new WeakMap<Page, string[]>();

test.beforeEach(async ({ context, page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  const requests: string[] = [];
  outside.set(page, requests);
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url === defaultSrc) return route.fetch({ url: sample }).then(response => route.fulfill({ response }));
    if (new URL(url).hostname !== '127.0.0.1') {
      requests.push(url);
      return route.abort();
    }
    return route.continue();
  });
});
test.afterEach(({ page }) => { expect(outside.get(page) ?? []).toEqual([]); });

async function open(page: Page) {
  await page.goto('/e2e/fixtures/embed.html');
  await expect.poll(() => page.evaluate(() => document.querySelector('mesh-avatar')?.avatar !== null &&
    !!document.querySelector('mesh-avatar')?.avatar)).toBe(true);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'loads'))).toBe(1);
}
async function drawn(page: Page) {
  const png = PNG.sync.read(await page.locator('mesh-avatar canvas').screenshot({ omitBackground: true }));
  expect(png.data.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
}

test('default sample renders, emits load and follows expression attributes', async ({ page }) => {
  await open(page);
  expect(await page.evaluate(async () => {
    const el = document.querySelector('mesh-avatar')!;
    return await el.ready === el.avatar && el.avatar === Reflect.get(window, 'loadedAvatar');
  })).toBe(true);
  await drawn(page);
  expect(await page.evaluate(() => document.querySelector('mesh-avatar')!.avatar!.getExpression().name)).toBe('smile');
  await page.locator('mesh-avatar').evaluate(el => el.setAttribute('expression', 'wink'));
  expect(await page.evaluate(() => document.querySelector('mesh-avatar')!.avatar!.getExpression().name)).toBe('wink');
  await page.screenshot({ path: 'test-results/embed-element.png' });
});

test('switching src replaces ready and destroys the old avatar; failed loads emit errors and recover', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await open(page);
  expect(await page.evaluate(async src => {
    const el = document.querySelector('mesh-avatar')!;
    const old = el.avatar!, ready = el.ready;
    let destroyed = 0;
    const destroy = old.destroy.bind(old);
    old.destroy = () => { destroyed++; destroy(); };
    el.src = src;
    const current = el.ready;
    const avatar = await current;
    return ready !== current && avatar !== old && el.avatar === avatar && destroyed === 1;
  }, sample + '?replacement')).toBe(true);
  for (const src of ['/missing-avatar.mavatar', '/broken-avatar.mavatar']) {
    await page.route('**' + src, route => route.fulfill({ status: src.includes('missing') ? 404 : 200, body: 'broken' }));
    const previous = await page.evaluate(() => Reflect.get(window, 'errors'));
    await page.locator('mesh-avatar').evaluate((el, src) => { (el as MeshAvatarElement).src = src; }, src);
    await expect.poll(() => page.evaluate(() => Reflect.get(window, 'errors'))).toBe(previous + 1);
    expect(await page.evaluate(async () => {
      try { await document.querySelector('mesh-avatar')!.ready; return false; } catch { return true; }
    })).toBe(true);
  }
  await page.locator('mesh-avatar').evaluate((el, src) => { (el as MeshAvatarElement).src = src; }, sample);
  await expect.poll(() => page.evaluate(() => !!document.querySelector('mesh-avatar')!.avatar)).toBe(true);
  expect(errors).toEqual([]);
});

test('offscreen and paused elements stop advancing and resume on return', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const avatar = document.querySelector('mesh-avatar')!.avatar!;
    const advance = avatar.advance.bind(avatar);
    Reflect.set(window, 'embedFrames', 0);
    avatar.advance = (...args) => { Reflect.set(window, 'embedFrames', Reflect.get(window, 'embedFrames') + 1); advance(...args); };
  });
  const frames = () => page.evaluate(() => Reflect.get(window, 'embedFrames') as number);
  const resumes = async () => { const count = await frames(); await expect.poll(frames).toBeGreaterThan(count); };
  const stops = async () => {
    // Allow the IntersectionObserver or pending animation frame to settle.
    await page.waitForTimeout(200);
    const count = await frames();
    await page.waitForTimeout(250);
    expect(await frames()).toBe(count);
  };
  await resumes();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await stops();
  await page.evaluate(() => window.scrollTo(0, 0));
  await resumes();
  await page.locator('mesh-avatar').evaluate(el => el.setAttribute('paused', ''));
  await stops();
  await page.locator('mesh-avatar').evaluate(el => el.removeAttribute('paused'));
  await resumes();
});

test('moving preserves the avatar; removal destroys it and reconnecting reloads it', async ({ page }) => {
  await open(page);
  expect(await page.evaluate(async () => {
    const el = document.querySelector('mesh-avatar')!, avatar = el.avatar;
    document.querySelector('#second')!.appendChild(el);
    await Promise.resolve();
    return el.avatar === avatar;
  })).toBe(true);
  expect(await page.evaluate(() => Reflect.get(window, 'loads'))).toBe(1);
  expect(await page.evaluate(async () => {
    const el = document.querySelector('mesh-avatar')!, old = el.avatar!;
    let destroyed = 0;
    const destroy = old.destroy.bind(old);
    old.destroy = () => { destroyed++; destroy(); };
    el.remove();
    await Promise.resolve();
    const unloaded = el.avatar === null && destroyed === 1;
    document.querySelector('#first')!.appendChild(el);
    return unloaded && await el.ready !== old;
  })).toBe(true);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'loads'))).toBe(2);
});

test('standalone bundle renders with one module script and no dev-server transformation', async ({ page }) => {
  const bundle = await readFile(new URL('../packages/element/dist/standalone.js', import.meta.url)).catch(error => {
    if (error.code === 'ENOENT') {
      throw new Error('Standalone bundle is missing. Run `npm run build:element` before running this test.', { cause: error });
    }
    throw error;
  });
  await page.route('**/element-standalone.js', route => route.fulfill({ contentType: 'text/javascript', body: bundle }));
  await page.route('**/e2e/fixtures/embed.html', async route => {
    const fixture = await readFile(new URL('./fixtures/embed.html', import.meta.url), 'utf8');
    await route.fulfill({ contentType: 'text/html', body: fixture.replace('/packages/element/src/index.ts', '/element-standalone.js') });
  });
  await open(page);
  expect(await page.evaluate(async () => await document.querySelector('mesh-avatar')!.ready ===
    Reflect.get(window, 'loadedAvatar'))).toBe(true);
  await drawn(page);
});

test('unknown expression warns once without throwing or changing the expression', async ({ page }) => {
  const warnings: string[] = [], errors: string[] = [];
  page.on('console', message => { if (message.type() === 'warning' && message.text().includes('<mesh-avatar>')) warnings.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  await open(page);
  await page.locator('mesh-avatar').evaluate(el => {
    el.setAttribute('expression', 'grin');
    el.setAttribute('expression', 'smile');
    el.setAttribute('expression', 'grin');
  });
  await expect.poll(() => warnings.length).toBe(1);
  // Console events can arrive asynchronously; repeated values must not warn again.
  await page.waitForTimeout(250);
  expect(warnings).toEqual(['<mesh-avatar> ignores expression="grin".']);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.querySelector('mesh-avatar')!.avatar!.getExpression().name)).toBe('smile');
});
