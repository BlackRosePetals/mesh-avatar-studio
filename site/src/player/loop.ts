import type { MeshAvatar } from 'mesh-avatar';

/**
 * Draws the avatar on the animation frames of whichever window currently holds the canvas,
 * so it keeps moving after the canvas moves to a Picture-in-Picture window. Frame times use
 * this page's clock: other windows have a different time origin.
 */
export function runAvatarLoop(avatar: MeshAvatar, canvas: HTMLCanvasElement, beforeFrame: (now: number, dt: number) => void) {
  let host: Window = window, raf = 0, previous = performance.now(), stopped = false;
  const frame = () => {
    const now = performance.now(), dt = Math.min(0.05, Math.max(0.001, (now - previous) / 1000));
    previous = now;
    beforeFrame(now, dt);
    avatar.advance(dt, 1 / dt);
    schedule();
  };
  const schedule = () => {
    if (stopped) return;
    host = canvas.ownerDocument.defaultView ?? window;
    raf = host.requestAnimationFrame(frame);
  };
  schedule();
  return {
    /** Call after moving the canvas to another document. */
    retarget() { host.cancelAnimationFrame(raf); previous = performance.now(); schedule(); },
    stop() { stopped = true; host.cancelAnimationFrame(raf); },
  };
}
