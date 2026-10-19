export function setupPlayground(root, { sampleURL }) {
  const el = root.querySelector('mesh-avatar');
  const status = root.querySelector('#status');
  const sourceName = root.querySelector('#source-name');
  const selectedFile = root.querySelector('#selected-file');
  const selectedPrefix = selectedFile.textContent.replace(/Miko$/, '');
  const controls = root.querySelector('#avatar-controls');
  const notice = root.querySelector('#notice');
  const speechText = root.querySelector('#speech-text');
  const fileInput = root.querySelector('#avatar-file');

  function updateCode(id, text) {
    root.querySelector(`#${id}`).textContent = text;
    const copy = root.querySelector(`[data-copy="${id}"]`);
    copy.textContent = copy.dataset.label;
  }

  function loading(name) {
    sourceName.textContent = name;
    selectedFile.textContent = selectedPrefix + name;
    status.textContent = root.dataset.loading;
    status.dataset.state = 'loading';
    controls.disabled = true;
    notice.textContent = '';
  }

  function ready() {
    status.textContent = root.dataset.ready;
    status.dataset.state = 'ready';
    controls.disabled = false;
  }

  el.addEventListener('load', ready);
  el.addEventListener('error', () => {
    status.textContent = root.dataset.error;
    status.dataset.state = 'error';
    controls.disabled = true;
  });
  if (el.avatar) ready();

  for (const button of root.querySelectorAll('[data-expression]')) {
    button.addEventListener('click', () => {
      const expression = button.dataset.expression;
      if (expression === 'neutral') el.removeAttribute('expression');
      else el.expression = expression;
      for (const chip of root.querySelectorAll('[data-expression]')) {
        chip.setAttribute('aria-pressed', String(chip === button));
      }
      updateCode('expression-code', expression === 'neutral'
        ? '<mesh-avatar></mesh-avatar>'
        : `<mesh-avatar expression="${expression}"></mesh-avatar>`);
    });
  }

  function speechCode() {
    // Escape a single-quoted JavaScript string; textContent keeps HTML inert.
    const text = speechText.value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
      .replace(/\r/g, '\\r').replace(/\n/g, '\\n')
      .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
      .replace(/</g, '\\x3c');
    updateCode('speech-code', `const el = document.querySelector('mesh-avatar');\nel.speak('${text}');`);
  }
  speechText.addEventListener('input', speechCode);
  root.querySelector('#speech-form').addEventListener('submit', event => {
    event.preventDefault();
    speechCode();
    void el.speak(speechText.value).catch(() => {
      notice.textContent = root.dataset.error;
    });
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    loading(file.name);
    updateCode('file-code', '<mesh-avatar src="/path/to/your-avatar.mavatar"></mesh-avatar>');
    void el.load(file).catch(() => {});
    fileInput.value = '';
  });
  root.querySelector('#restore-miko').addEventListener('click', () => {
    loading('Miko');
    updateCode('file-code', '<mesh-avatar></mesh-avatar>');
    // load() reloads even when the src attribute is already absent.
    void el.load(sampleURL).catch(() => {});
    fileInput.value = '';
  });

  for (const button of root.querySelectorAll('[data-copy], #copy-snippet')) {
    button.dataset.label = button.textContent;
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(root.querySelector(`#${button.dataset.copy ?? 'embed-code'}`).textContent);
        button.textContent = button.dataset.copied;
      } catch {
        notice.textContent = root.dataset.copyError;
      }
    });
  }
}
