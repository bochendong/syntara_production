const BAR_SECONDS = 4 * 60 / 112;
const MUSIC_VOLUME = 0.32;
const EFFECTS = {
  hit: { gain: 0.23, interval: 0.12 },
};

export function createGameAudio() {
  let context, output, musicGain, tensionGain;
  let music, phase = 'title', muted = false, hidden = document.hidden;
  const buffers = {};
  let lowHealth = false, tense = false;
  const lastEffect = { hit: -Infinity };

  async function load(file) {
    try {
      const response = await fetch(new URL('./audio/' + file, import.meta.url));
      if (!response.ok) throw new Error('Failed to load ' + file);
      return await context.decodeAudioData(await response.arrayBuffer());
    } catch (error) {
      console.warn('Sandbox Brawl audio:', error);
      return null;
    }
  }

  function unlock() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!context) {
      context = new AudioContext();
      output = context.createGain();
      output.gain.value = muted || hidden ? 0 : 1;
      output.connect(context.destination);
      musicGain = context.createGain();
      musicGain.gain.value = 0;
      musicGain.connect(output);
      tensionGain = context.createGain();
      tensionGain.gain.value = 0;
      tensionGain.connect(musicGain);
      Promise.all([load('music.flac'), load('tension.flac')]).then(([base, tension]) => {
        buffers.music = base;
        buffers.tension = tension;
        if (phase === 'play' || phase === 'levelup') startMusic();
      });
      for (const key of Object.keys(EFFECTS)) {
        load(key + '.wav').then((buffer) => { buffers[key] = buffer; });
      }
    }
    if (context.state !== 'running') context.resume().catch(() => {});
  }

  function ramp(param, value, at, speed) {
    param.cancelScheduledValues(context.currentTime);
    param.setTargetAtTime(value, at, speed);
  }

  function startMusic() {
    if (music || !buffers.music || hidden) return;
    const start = context.currentTime + 0.03;
    const tracks = [track(buffers.music, musicGain, start)];
    if (buffers.tension?.length === buffers.music.length) {
      tracks.push(track(buffers.tension, tensionGain, start));
    }
    music = { start, tracks };
    tensionGain.gain.value = tense ? 1 : 0;
    ramp(musicGain.gain, MUSIC_VOLUME, start, 0.06);
  }

  function track(buffer, gain, start) {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    source.start(start);
    return source;
  }

  function update(state, bossActive, health) {
    const active = state === 'play' || state === 'levelup';
    const inRun = active || state === 'paused';
    lowHealth = inRun && health < (lowHealth ? 0.4 : 0.3);
    const nextTense = inRun && (bossActive || lowHealth);
    const changed = phase !== state;
    phase = state;
    if (music && changed) {
      const now = context.currentTime;
      if (!inRun) {
        for (const source of music.tracks) source.stop(now);
        music = null;
        ramp(musicGain.gain, 0, now, 0.04);
      } else {
        ramp(musicGain.gain, active && !hidden ? MUSIC_VOLUME : 0, now, 0.07);
      }
    }
    if (music && nextTense !== tense) {
      const now = context.currentTime;
      const bar = Math.max(0, Math.ceil((now - music.start) / BAR_SECONDS));
      const boundary = Math.max(now, music.start + bar * BAR_SECONDS);
      ramp(tensionGain.gain, nextTense ? 1 : 0, boundary, 0.14);
    }
    tense = nextTense;
    if (active) startMusic();
  }

  function play(name) {
    if (hidden || muted || context?.state !== 'running' || !buffers[name]) return;
    const now = context.currentTime;
    const { gain, interval } = EFFECTS[name];
    if (now - lastEffect[name] < interval) return;
    lastEffect[name] = now;
    const source = context.createBufferSource();
    const volume = context.createGain();
    volume.gain.value = gain;
    source.buffer = buffers[name];
    source.connect(volume).connect(output);
    source.start(now);
  }

  function toggleMute() {
    muted = !muted;
    if (context) ramp(output.gain, muted || hidden ? 0 : 1, context.currentTime, 0.03);
    return muted;
  }

  function setHidden(value) {
    hidden = value;
    if (!context) return;
    output.gain.cancelScheduledValues(context.currentTime);
    output.gain.setValueAtTime(muted || hidden ? 0 : 1, context.currentTime);
    const active = phase === 'play' || phase === 'levelup';
    if (music) ramp(musicGain.gain, active && !hidden ? MUSIC_VOLUME : 0, context.currentTime, 0.07);
    else if (active) startMusic();
  }

  return { unlock, update, play, toggleMute, setHidden };
}
