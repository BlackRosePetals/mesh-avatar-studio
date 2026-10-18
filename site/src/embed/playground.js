// Kept inline in the standalone example so it can also open directly from disk.
export function setupPlayground(root, { sampleURL }) {
  const el = root.querySelector('mesh-avatar');
  const status = root.querySelector('#status');
  const sourceName = root.querySelector('#source-name');
  const controls = root.querySelector('#avatar-controls');
  const audio = root.querySelector('audio');
  const micButton = root.querySelector('#microphone');
  const notice = root.querySelector('#notice');
  let context;
  let audioAnalyser;
  let audioURL;
  let microphone;
  let microphoneSource;
  let microphoneRequest = 0;
  let voiceFrame = 0;

  function stopVoice() {
    cancelAnimationFrame(voiceFrame);
    voiceFrame = 0;
    el.avatar?.setSpeaking(false);
    el.setVoiceLevel(0);
  }

  function stopMicrophone() {
    microphoneRequest++;
    microphone?.getTracks().forEach(track => track.stop());
    microphone = undefined;
    microphoneSource?.disconnect();
    microphoneSource = undefined;
    micButton.disabled = false;
    micButton.textContent = micButton.dataset.start;
    micButton.setAttribute('aria-pressed', 'false');
    stopVoice();
  }

  function followVolume(analyser) {
    stopVoice();
    el.avatar?.stopLipSync();
    el.avatar?.setSpeaking(true);
    const data = new Float32Array(analyser.fftSize);
    const frame = () => {
      analyser.getFloatTimeDomainData(data);
      const rms = Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
      el.setVoiceLevel(Math.min(1, rms * 5));
      voiceFrame = requestAnimationFrame(frame);
    };
    frame();
  }

  function audioContext() {
    context ??= new AudioContext();
    return context;
  }

  function loading(name) {
    audio.pause();
    stopMicrophone();
    sourceName.textContent = name;
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
  // Also cover callers that initialize controls after the avatar has loaded.
  if (el.avatar) ready();

  for (const button of root.querySelectorAll('[data-expression]')) {
    button.addEventListener('click', () => {
      el.expression = button.dataset.expression;
      for (const chip of root.querySelectorAll('[data-expression]')) {
        chip.setAttribute('aria-pressed', String(chip === button));
      }
    });
  }
  root.querySelector('#emotion').addEventListener('change', event => {
    el.emotion = event.target.value || null;
  });
  root.querySelector('#paused').addEventListener('change', event => {
    el.paused = event.target.checked;
  });
  root.querySelector('#no-idle').addEventListener('change', event => {
    el.toggleAttribute('no-idle', event.target.checked);
  });

  root.querySelector('#speech-form').addEventListener('submit', event => {
    event.preventDefault();
    audio.pause();
    stopMicrophone();
    void el.speak(root.querySelector('#speech-text').value).catch(() => {
      notice.textContent = root.dataset.error;
    });
  });

  root.querySelector('#avatar-file').addEventListener('change', event => {
    const file = event.target.files?.[0];
    if (!file) return;
    loading(file.name);
    void el.load(file).catch(() => {});
    event.target.value = '';
  });
  root.querySelector('#restore-miko').addEventListener('click', () => {
    loading('Miko');
    // Setting an unchanged src or removing an absent attribute would not reload.
    void el.load(sampleURL).catch(() => {});
    root.querySelector('#avatar-file').value = '';
  });

  root.querySelector('#audio-file').addEventListener('change', event => {
    const file = event.target.files?.[0];
    if (!file) return;
    audio.pause();
    stopMicrophone();
    if (audioURL) URL.revokeObjectURL(audioURL);
    audioURL = URL.createObjectURL(file);
    audio.src = audioURL;
    notice.textContent = '';
  });
  audio.addEventListener('play', async () => {
    stopMicrophone();
    try {
      const ctx = audioContext();
      audioAnalyser ??= ctx.createAnalyser();
      if (!audio.dataset.connected) {
        ctx.createMediaElementSource(audio).connect(audioAnalyser);
        audioAnalyser.connect(ctx.destination);
        audio.dataset.connected = 'true';
      }
      await ctx.resume();
      if (!audio.paused && !audio.ended) followVolume(audioAnalyser);
    } catch {
      audio.pause();
      notice.textContent = root.dataset.audioError;
    }
  });
  for (const event of ['pause', 'ended']) audio.addEventListener(event, () => {
    if (!microphone) stopVoice();
  });
  audio.addEventListener('error', () => {
    if (audio.getAttribute('src')) notice.textContent = root.dataset.audioError;
    if (!microphone) stopVoice();
  });

  micButton.addEventListener('click', async () => {
    if (microphone) {
      stopMicrophone();
      return;
    }
    audio.pause();
    stopVoice();
    notice.textContent = '';
    const request = ++microphoneRequest;
    micButton.disabled = true;
    try {
      const ctx = audioContext();
      await ctx.resume();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (request !== microphoneRequest) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      microphone = stream;
      const analyser = ctx.createAnalyser();
      microphoneSource = ctx.createMediaStreamSource(stream);
      microphoneSource.connect(analyser);
      followVolume(analyser);
      micButton.textContent = micButton.dataset.stop;
      micButton.setAttribute('aria-pressed', 'true');
    } catch {
      if (request === microphoneRequest) {
        stopMicrophone();
        notice.textContent = root.dataset.micError;
      }
    } finally {
      if (request === microphoneRequest) micButton.disabled = false;
    }
  });

  root.querySelector('#copy-snippet')?.addEventListener('click', async event => {
    try {
      await navigator.clipboard.writeText(root.querySelector('#embed-code').textContent);
      event.target.textContent = event.target.dataset.copied;
    } catch {
      notice.textContent = root.dataset.copyError;
    }
  });

  window.addEventListener('pagehide', () => {
    audio.pause();
    stopMicrophone();
    if (audioURL) URL.revokeObjectURL(audioURL);
    if (context) void context.close();
  }, { once: true });
}
