import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { expect, test } from 'vitest';
import { MeshAvatar } from '../src/index';

test('server rendering emits HTML attributes without loading an avatar', () => {
  expect(typeof window).toBe('undefined');
  const html = renderToString(createElement(MeshAvatar, {
    src: '/character.mavatar', source: new Uint8Array(), expression: 'smile', noIdle: true,
    className: 'character', style: { width: 320 }, title: 'Character', 'aria-label': 'Avatar',
  }));
  expect(html).toContain('<mesh-avatar');
  expect(html).toContain('class="character"');
  expect(html).toContain('width:320px');
  expect(html).toContain('aria-label="Avatar"');
  expect(html).not.toMatch(/\b(src|source|expression|no-idle)=/);
  expect(html).not.toContain('<canvas');
});
