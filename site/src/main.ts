import { LIVE_EXPRESSIONS, loadMeshAvatar, type LiveExpression, type MeshAvatar } from 'mesh-avatar';
import { copy } from './messages';
import overviewImage from '../../docs/images/en/01-overview.png';
import handlesImage from '../../docs/images/en/02-edit-handles.png';
import lipSyncImage from '../../docs/images/en/03-lip-sync.png';
import variantsImage from '../../docs/images/en/05-variants.png';
import liveImage from '../../docs/images/en/07-live.png';
import streamImage from '../../docs/images/en/08-stream.png';
import './style.css';

const screenshots: Record<string, string> = {
  overview: overviewImage, handles: handlesImage, lipSync: lipSyncImage,
  variants: variantsImage, live: liveImage, stream: streamImage,
};
for (const image of document.querySelectorAll<HTMLImageElement>('img[data-screenshot]')) {
  image.src = screenshots[image.dataset.screenshot!];
  const link = image.closest('a');
  if (link) link.href = image.src;
}

for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-copy]')) {
  const code = document.getElementById(button.dataset.copy!)!;
  const feedback = document.getElementById(button.getAttribute('aria-describedby')!)!;
  let resetTimer = 0;
  button.disabled = false;
  button.textContent = copy.copy;
  button.addEventListener('click', async () => {
    window.clearTimeout(resetTimer);
    button.disabled = true;
    button.textContent = copy.copy;
    feedback.textContent = '';
    try {
      await navigator.clipboard.writeText(code.textContent ?? '');
      button.textContent = copy.copied;
      feedback.textContent = copy.copySucceeded;
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(code);
      selection?.removeAllRanges();
      selection?.addRange(range);
      feedback.textContent = copy.copyFailed;
    } finally {
      button.disabled = false;
      resetTimer = window.setTimeout(() => { button.textContent = copy.copy; }, 2500);
    }
  });
}

const hero = document.querySelector<HTMLElement>('.hero')!;
const canvas = document.querySelector<HTMLCanvasElement>('#avatar')!;
const stage = document.querySelector<HTMLElement>('.avatar-stage')!;
const status = document.querySelector<HTMLElement>('#avatar-status')!;
const controls = document.querySelector<HTMLFieldSetElement>('#avatar-controls')!;
const expressions = document.querySelector<HTMLElement>('#expressions')!;
const talk = document.querySelector<HTMLButtonElement>('#talk')!;
const hint = document.querySelector<HTMLElement>('#demo-hint')!;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = window.matchMedia('(any-hover: hover) and (any-pointer: fine)');
const shownExpressions: LiveExpression[] = ['neutral', 'smile', 'surprise', 'wink'];

let avatar: MeshAvatar | undefined;
let speaking = false;
let inView = false;
let pageVisible = true;
let disposed = false;
let frameId = 0;
let lastFrame = 0;
let elapsed = 0;
const pointer = { active: false, x: 0, y: 0, smoothX: 0, smoothY: 0, weight: 0 };

for (const name of shownExpressions.filter(name => LIVE_EXPRESSIONS.includes(name))) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = copy.expressions[name];
  button.dataset.expression = name;
  button.setAttribute('aria-pressed', String(name === 'neutral'));
  button.addEventListener('click', () => {
    avatar?.setExpression(name);
    for (const chip of expressions.querySelectorAll('button')) {
      chip.setAttribute('aria-pressed', String(chip === button));
    }
  });
  expressions.append(button);
}

function updateMotionPreference() {
  avatar?.setAutoIdle(!reducedMotion.matches);
  avatar?.setAutoMotion(!reducedMotion.matches);
  avatar?.setSwayGain(reducedMotion.matches ? 0.35 : 1);
  pointer.active = false;
  pointer.weight = 0;
  avatar?.setParameters({});
  hint.textContent = reducedMotion.matches || !finePointer.matches
    ? copy.expressionHint
    : copy.pointerHint;
}
reducedMotion.addEventListener('change', updateMotionPreference);
finePointer.addEventListener('change', updateMotionPreference);
updateMotionPreference();

hero.addEventListener('pointermove', event => {
  if (event.pointerType === 'touch' || reducedMotion.matches || !finePointer.matches) return;
  const rect = hero.getBoundingClientRect();
  pointer.x = Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1));
  pointer.y = Math.max(-1, Math.min(1, 1 - (event.clientY - rect.top) / rect.height * 2));
  pointer.active = true;
});
const releasePointer = () => { pointer.active = false; };
hero.addEventListener('pointerleave', releasePointer);
hero.addEventListener('pointercancel', releasePointer);
window.addEventListener('blur', releasePointer);

talk.addEventListener('click', () => {
  speaking = !speaking;
  talk.setAttribute('aria-pressed', String(speaking));
  avatar?.setSpeaking(speaking);
  if (!speaking) avatar?.setVoiceLevel(0);
});

function frame(now: number) {
  if (!avatar) return;
  const dt = Math.min(0.05, Math.max(0.001, (now - lastFrame) / 1000));
  lastFrame = now;
  elapsed += dt;
  const ease = 1 - Math.exp(-dt * 9);
  pointer.smoothX += (pointer.x - pointer.smoothX) * ease;
  pointer.smoothY += (pointer.y - pointer.smoothY) * ease;
  pointer.weight += ((pointer.active ? 1 : 0) - pointer.weight) * ease;
  if (pointer.weight > 0.001 && !reducedMotion.matches) {
    avatar.setParameters({
      angleX: pointer.smoothX * 12,
      angleY: pointer.smoothY * 8,
      gazeX: pointer.smoothX * 0.7,
      gazeY: pointer.smoothY * 0.55,
    }, pointer.weight);
  } else {
    avatar.setParameters({});
  }
  if (speaking) {
    const phrase = Math.max(0, Math.sin(elapsed * 2.4));
    const syllable = 0.25 + 0.75 * Math.abs(Math.sin(elapsed * 13) * Math.cos(elapsed * 7));
    avatar.setVoiceLevel(phrase * syllable);
  }
  // One simulation step per visible frame; the renderer also caps devicePixelRatio at 2.
  avatar.advance(dt, 1 / dt);
  frameId = requestAnimationFrame(frame);
}

function updateLoop() {
  const shouldRender = avatar && inView && pageVisible && !document.hidden && !disposed;
  if (shouldRender && !frameId) {
    lastFrame = performance.now();
    frameId = requestAnimationFrame(frame);
  } else if (!shouldRender && frameId) {
    cancelAnimationFrame(frameId);
    frameId = 0;
    pointer.active = false;
  }
}

const visibility = new IntersectionObserver(entries => {
  inView = entries[0].isIntersecting;
  updateLoop();
});
visibility.observe(stage);
document.addEventListener('visibilitychange', updateLoop);
window.addEventListener('pagehide', event => {
  pageVisible = false;
  updateLoop();
  if (!event.persisted) {
    disposed = true;
    visibility.disconnect();
    avatar?.destroy();
  }
});
window.addEventListener('pageshow', () => { pageVisible = true; updateLoop(); });

async function start() {
  status.textContent = copy.loading;
  canvas.dataset.state = 'loading';
  try {
    // Hide the source image's cut top edge while leaving more of the hair visible.
    const loaded = await loadMeshAvatar(canvas, `${import.meta.env.BASE_URL}miko.mavatar`, { manual: true, padTop: -0.04 });
    if (disposed) { loaded.destroy(); return; }
    avatar = loaded;
    avatar.setAutoIdle(true);
    updateMotionPreference();
    avatar.advance(0);
    canvas.dataset.state = 'ready';
    stage.setAttribute('aria-busy', 'false');
    status.hidden = true;
    controls.disabled = false;
    updateLoop();
  } catch {
    canvas.dataset.state = 'error';
    stage.setAttribute('aria-busy', 'false');
    status.textContent = copy.loadFailed;
  }
}

void start();
