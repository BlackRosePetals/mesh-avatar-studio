import type * as React from 'react';
import type { createRoot } from 'react-dom/client';
import type { MeshAvatar, MeshAvatarProps, MeshAvatarElement } from '../../packages/react/src/index';

export function mount(react: typeof React, create: typeof createRoot, Component: typeof MeshAvatar) {
  const root = create(document.getElementById('root')!);
  const ref = react.createRef<MeshAvatarElement>();
  const log: { version: number; event: string; value: unknown }[] = [];
  let props: MeshAvatarProps = { src: new URLSearchParams(location.search).get('src') ?? undefined, paused: true };
  let version = 0;
  const render = () => {
    const current = version;
    const child = react.createElement(Component, { ...props, ref, style: { width: 300 }, id: 'avatar', 'aria-label': 'Character',
      onLoad: avatar => log.push({ version: current, event: 'load', value: !!avatar }),
      onError: error => log.push({ version: current, event: 'error', value: String(error) }),
      onMotion: id => log.push({ version: current, event: 'motion', value: id }),
    });
    root.render(new URLSearchParams(location.search).has('strict') ? react.createElement(react.StrictMode, null, child) : child);
  };
  Reflect.set(window, 'harness', { ref, log, reactVersion: react.version,
    update(next: MeshAvatarProps) { props = next; version++; render(); },
    unmount() { root.unmount(); },
  });
  render();
}
